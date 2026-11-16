-- Owner 2026-11-13 ("영어 글 페이지, OK 이대로 만들기"): the daily web build asks translate-content for the English copy of
-- business posts it prerenders at /en/posts/:id. The build has no user; it holds the search build token instead
-- (20261030090000_search_exclusions.sql), and the function checks that token here before translating anything.
create or replace function public.is_search_build_token(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_token is not null and exists (select 1 from private.search_build_tokens t
    where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex'));
$$;
revoke all on function public.is_search_build_token(text) from public, anon, authenticated;
grant execute on function public.is_search_build_token(text) to service_role;

-- Build-made translations are saved with no requester, so a null user counts those rows against the build's own daily cap.
-- Two branches keep the member lookup on content_translations_requester_idx.
create or replace function public.get_content_translation(p_kind text, p_id uuid, p_language text, p_hash text, p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'translation', (select jsonb_build_object('title', t.title, 'body', t.body) from private.content_translations t
      where t.kind = p_kind and t.target_id = p_id and t.language = p_language and t.source_hash = p_hash),
    -- Cache misses this user (or the build, when p_user is null) caused in the last 24 hours, to bound AI cost.
    'usage', case when p_user is null
      then (select count(*) from private.content_translations where requested_by is null and created_at > now() - interval '24 hours')
      else (select count(*) from private.content_translations where requested_by = p_user and created_at > now() - interval '24 hours') end);
$$;
revoke all on function public.get_content_translation(text, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.get_content_translation(text, uuid, text, text, uuid) to service_role;
