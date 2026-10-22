-- Derived text only: original posts/comments and ADR-0001 safety processing are unchanged.
create table private.content_translations (
  kind text not null check (kind in ('post','comment')),
  content_id uuid not null,
  language text not null check (language in ('ko','en')),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  translation jsonb,
  lease_token uuid,
  lease_until timestamptz,
  primary key (kind,content_id,language)
);
create table private.content_translation_usage (
  bucket text not null,
  usage_day date not null,
  requests integer not null default 0 check (requests >= 0),
  characters integer not null default 0 check (characters >= 0),
  primary key (bucket,usage_day)
);
alter table private.content_translations enable row level security;
alter table private.content_translation_usage enable row level security;
revoke all on private.content_translations, private.content_translation_usage from public, anon, authenticated;

create function public.claim_content_translation(
  p_kind text,p_content_id uuid,p_language text,p_source_hash text,p_user_id uuid,p_characters integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cached private.content_translations;
  budget private.content_translation_usage;
  reader_budget private.content_translation_usage;
  today date := (now() at time zone 'UTC')::date;
  token uuid;
begin
  if p_kind is null or p_kind not in ('post','comment') or p_content_id is null
    or p_language is null or p_language not in ('ko','en') or p_source_hash is null
    or p_source_hash !~ '^[0-9a-f]{64}$' or p_user_id is null
    or p_characters is null or p_characters not between 1 and 16000 then
    raise exception 'INVALID_TRANSLATION_CLAIM';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('translation:'||p_kind||':'||p_content_id||':'||p_language,0));
  select * into cached from private.content_translations
    where kind=p_kind and content_id=p_content_id and language=p_language;
  if cached.source_hash=p_source_hash then
    if cached.translation is not null then
      return jsonb_build_object('state','cached','translation',cached.translation);
    end if;
    if cached.lease_until > now() then return '{"state":"pending"}'::jsonb; end if;
  end if;
  -- Initial conservative budgets apply only to model calls, never to shared cache hits.
  insert into private.content_translation_usage(bucket,usage_day) values('project',today),(p_user_id::text,today)
    on conflict do nothing;
  select * into budget from private.content_translation_usage where bucket='project' and usage_day=today for update;
  select * into reader_budget from private.content_translation_usage where bucket=p_user_id::text and usage_day=today for update;
  if budget.characters+p_characters > 100000 or reader_budget.requests >= 200 then
    return '{"state":"limited"}'::jsonb;
  end if;
  update private.content_translation_usage set requests=requests+1,characters=characters+p_characters
    where bucket in ('project',p_user_id::text) and usage_day=today;
  delete from private.content_translation_usage where usage_day < today-7;
  token := gen_random_uuid();
  insert into private.content_translations(kind,content_id,language,source_hash,lease_token,lease_until)
    values(p_kind,p_content_id,p_language,p_source_hash,token,now()+interval '45 seconds')
    on conflict(kind,content_id,language) do update set source_hash=excluded.source_hash,
      translation=null,lease_token=excluded.lease_token,lease_until=excluded.lease_until;
  return jsonb_build_object('state','claimed','token',token);
end $$;

create function public.finish_content_translation(
  p_kind text,p_content_id uuid,p_language text,p_source_hash text,p_token uuid,p_translation jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  if p_translation is null or jsonb_typeof(p_translation)<>'object'
    or jsonb_typeof(p_translation->'body') is distinct from 'string'
    or char_length(p_translation->>'body') > 12000
    or (p_kind='post' and (jsonb_typeof(p_translation->'title') is distinct from 'string'
      or char_length(trim(p_translation->>'title')) not between 1 and 400))
    or (p_kind='comment' and p_translation->'title' is distinct from 'null'::jsonb) then
    raise exception 'INVALID_TRANSLATION';
  end if;
  update private.content_translations set translation=p_translation,lease_token=null,lease_until=null
    where kind=p_kind and content_id=p_content_id and language=p_language
      and source_hash=p_source_hash and lease_token=p_token and lease_until > now() and translation is null;
  get diagnostics changed = row_count;
  return changed=1;
end $$;

create function public.fail_content_translation(
  p_kind text,p_content_id uuid,p_language text,p_source_hash text,p_token uuid
) returns void language sql security definer set search_path='' as $$
  update private.content_translations set lease_until=now()+interval '60 seconds'
    where kind=p_kind and content_id=p_content_id and language=p_language
      and source_hash=p_source_hash and lease_token=p_token and translation is null;
$$;

-- Only the authenticated Edge Function may touch a shared cache. It reads the source
-- with the viewer's JWT both before the cache and before returning any derived text.
revoke all on function public.claim_content_translation(text,uuid,text,text,uuid,integer) from public,anon,authenticated;
revoke all on function public.finish_content_translation(text,uuid,text,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.fail_content_translation(text,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_content_translation(text,uuid,text,text,uuid,integer) to service_role;
grant execute on function public.finish_content_translation(text,uuid,text,text,uuid,jsonb) to service_role;
grant execute on function public.fail_content_translation(text,uuid,text,text,uuid) to service_role;

create function private.invalidate_content_translations()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='posts' then
    delete from private.content_translations where kind='post' and content_id=old.id;
    if tg_op='DELETE' or new.status is distinct from old.status then
      delete from private.content_translations where kind='comment'
        and content_id in(select id from public.comments where post_id=old.id);
    end if;
  else
    delete from private.content_translations where kind='comment' and content_id=old.id;
    if tg_op='DELETE' or new.deleted_at is distinct from old.deleted_at then
      delete from private.content_translations where kind='comment'
        and content_id in(select id from public.comments where parent_id=old.id or reply_to_id=old.id);
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.invalidate_content_translations() from public,anon,authenticated;
create trigger posts_translation_invalidation after update of title,body,status or delete on public.posts
  for each row execute function private.invalidate_content_translations();
create trigger comments_translation_invalidation after update of body,deleted_at or delete on public.comments
  for each row execute function private.invalidate_content_translations();
