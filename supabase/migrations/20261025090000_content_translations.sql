-- One server translation per visible source text and target language, shared by every viewer.
-- Only the translate-content Edge Function (service role) reads or writes this cache.
create table private.content_translations (
  kind text not null check (kind in ('post', 'comment')),
  target_id uuid not null,
  language text not null check (language in ('ko', 'en')),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  title text check (char_length(title) <= 400),
  body text not null check (char_length(body) <= 12000),
  model text not null,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (kind, target_id, language, source_hash)
);
create index content_translations_requester_idx on private.content_translations (requested_by, created_at);
alter table private.content_translations enable row level security;
revoke all on private.content_translations from public, anon, authenticated;

-- Removed or edited content must not keep a translated copy around.
create function private.drop_content_translations() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.content_translations
  where kind = tg_argv[0] and target_id = old.id;
  return null;
end $$;
revoke all on function private.drop_content_translations() from public;

create trigger posts_drop_translations after delete or update of title, body, status on public.posts
for each row execute function private.drop_content_translations('post');
create trigger comments_drop_translations after delete or update of body, deleted_at on public.comments
for each row execute function private.drop_content_translations('comment');

-- The private schema is not exposed over the API, so the Edge Function goes through these.
create function public.get_content_translation(p_kind text, p_id uuid, p_language text, p_hash text, p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'translation', (select jsonb_build_object('title', t.title, 'body', t.body) from private.content_translations t
      where t.kind = p_kind and t.target_id = p_id and t.language = p_language and t.source_hash = p_hash),
    -- Cache misses this user caused in the last 24 hours, to bound AI cost.
    'usage', (select count(*) from private.content_translations
      where requested_by = p_user and created_at > now() - interval '24 hours'));
$$;

create function public.put_content_translation(p_kind text, p_id uuid, p_language text, p_hash text, p_title text, p_body text, p_model text, p_user uuid)
returns void language sql security definer set search_path = '' as $$
  insert into private.content_translations (kind, target_id, language, source_hash, title, body, model, requested_by)
  values (p_kind, p_id, p_language, p_hash, p_title, p_body, p_model, p_user)
  on conflict do nothing;
$$;

revoke all on function public.get_content_translation(text, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.put_content_translation(text, uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.get_content_translation(text, uuid, text, text, uuid) to service_role;
grant execute on function public.put_content_translation(text, uuid, text, text, text, text, text, uuid) to service_role;
