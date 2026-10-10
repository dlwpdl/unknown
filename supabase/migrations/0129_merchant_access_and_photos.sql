-- Business capability is server-owned and independent of admin/personal membership.
update auth.users u set raw_app_meta_data=jsonb_set(coalesce(raw_app_meta_data,'{}'),'{merchant_enabled}','true')
where raw_app_meta_data->'merchant_enabled' is null and exists(select 1 from private.merchants m where m.owner_id=u.id);

create function private.assert_merchant_access() returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  perform 1 from auth.users where id=auth.uid() for share;
  if exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role'='admin') then
    if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  elsif not exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->'merchant_enabled'='true'::jsonb) then
    raise exception 'MERCHANT_ACCOUNT_REQUIRED';
  end if;
end;
$$;
revoke all on function private.assert_merchant_access() from public,anon,authenticated;

create function public.get_my_merchant_access() returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  if exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role'='admin') then
    if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
    return true;
  end if;
  return exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->'merchant_enabled'='true'::jsonb);
end;
$$;
create function public.get_admin_merchant_access(p_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('users',p_user_id,null);
  if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  return exists(select 1 from auth.users where id=p_user_id and raw_app_meta_data->'merchant_enabled'='true'::jsonb);
end;
$$;
create function public.set_admin_merchant_access(p_user_id uuid,p_enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_enabled is null or p_user_id is null then raise exception 'INVALID_MERCHANT_ACCESS'; end if;
  if p_enabled and not private.is_active_account(p_user_id) then raise exception 'ACCOUNT_INACTIVE'; end if;
  update auth.users set raw_app_meta_data=jsonb_set(coalesce(raw_app_meta_data,'{}'),'{merchant_enabled}',to_jsonb(p_enabled)) where id=p_user_id;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  perform public.log_admin_access('users',p_user_id,null);
  return p_enabled;
end;
$$;
revoke all on function public.get_my_merchant_access(),public.get_admin_merchant_access(uuid),public.set_admin_merchant_access(uuid,boolean) from public,anon,authenticated;
grant execute on function public.get_my_merchant_access(),public.get_admin_merchant_access(uuid),public.set_admin_merchant_access(uuid,boolean) to authenticated;

create or replace function private.assert_merchant_workspace(p_merchant_id uuid,p_advanced boolean default false)
returns private.merchants language plpgsql security definer set search_path='' as $$
declare m private.merchants; uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(uid);
  perform private.assert_merchant_access();
  if exists(select 1 from auth.users where id=uid and raw_app_meta_data->>'role'='admin') then
    if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
    perform public.log_admin_access('analytics');
  end if;
  select * into m from private.merchants where id=p_merchant_id;
  if m.id is null or (not private.is_admin() and m.owner_id is distinct from uid) then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  if p_advanced and private.merchant_workspace_plan(m.id)='basic' then raise exception 'MERCHANT_PLAN_REQUIRED'; end if;
  return m;
end;
$$;
alter table private.merchant_workspace_drafts add column image_paths text[] not null default '{}';
create function private.assert_merchant_image_paths(paths text[],retained text[] default '{}') returns void
language plpgsql security definer set search_path='' as $$
begin
  if paths is null or cardinality(paths)>6 or array_position(paths,null) is not null
    or (select count(distinct path) from unnest(paths)path)<>cardinality(paths) then raise exception 'INVALID_IMAGE_PATH'; end if;
  if exists(select 1 from unnest(paths) path where path !~ '^[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+\.(webp|jpeg|jpg|png)$'
    or (not path=any(coalesce(retained,'{}')) and (split_part(path,'/',1)<>auth.uid()::text
      or not exists(select 1 from storage.objects o where o.bucket_id='post-images' and o.name=path)))) then raise exception 'INVALID_IMAGE_PATH'; end if;
end;
$$;
revoke all on function private.assert_merchant_image_paths(text[],text[]) from public,anon,authenticated;

create function public.edit_merchant_post(p_merchant_id uuid,p_post_id uuid,p_title text,p_body text,p_image_paths text[] default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare m private.merchants; old_post public.posts;
begin
  m:=private.assert_merchant_workspace(p_merchant_id);
  if m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
  select p.* into old_post from public.posts p join private.merchant_posts mp on mp.post_id=p.id
    where mp.merchant_id=m.id and p.id=p_post_id and p.city_id=m.city_id and p.status='published' and p.room_preview is null for update of p;
  if old_post.id is null then raise exception 'MERCHANT_POST_NOT_FOUND'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 100 or p_body is null or length(btrim(p_body)) not between 1 and 4700 then raise exception 'INVALID_POST_INPUT'; end if;
  if p_image_paths is not null then perform private.assert_merchant_image_paths(p_image_paths,old_post.image_paths); end if;
  perform private.assert_content_allowed(concat_ws(' ',p_title,p_body));
  perform private.enforce_rate_limit('merchant-post-edit',30,interval '1 minute');
  update public.posts set title=btrim(p_title),body=btrim(p_body),image_paths=coalesce(p_image_paths,image_paths) where id=old_post.id;
  return old_post.id;
end;
$$;
create function public.remove_merchant_post(p_merchant_id uuid,p_post_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare m private.merchants; pid uuid;
begin
  m:=private.assert_merchant_workspace(p_merchant_id);
  if m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
  select p.id into pid from public.posts p join private.merchant_posts mp on mp.post_id=p.id
    where mp.merchant_id=m.id and p.id=p_post_id and p.city_id=m.city_id and p.room_preview is null for update of p;
  if pid is null then raise exception 'MERCHANT_POST_NOT_FOUND'; end if;
  update public.posts set status='removed',deleted_at=coalesce(deleted_at,now()) where id=pid;
  return pid;
end;
$$;
revoke all on function public.edit_merchant_post(uuid,uuid,text,text,text[]),public.remove_merchant_post(uuid,uuid) from public,anon,authenticated;
grant execute on function public.edit_merchant_post(uuid,uuid,text,text,text[]),public.remove_merchant_post(uuid,uuid) to authenticated;

drop function public.save_merchant_workspace_draft(uuid,uuid,text,text,text,text,text,text);
create function public.save_merchant_workspace_draft(p_merchant_id uuid,p_id uuid,p_channel text,p_title text,p_body text,p_original_url text,p_tag_slug text,p_kind text,p_image_paths text[] default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_merchant_workspace(p_merchant_id);
  if p_id is null or p_channel is null or p_channel not in ('gling','casmo','hellovancouver')
    or p_title is null or length(btrim(p_title)) not between 1 and 100 or p_body is null or length(btrim(p_body)) not between 1 and 4700
    or p_kind is null or p_kind not in ('story','listing') or not exists(select 1 from public.tags where slug=p_tag_slug and kind='post') then raise exception 'INVALID_MERCHANT_DRAFT'; end if;
  if p_original_url is not null and not private.valid_merchant_original(p_original_url) then raise exception 'INVALID_ORIGINAL_URL'; end if;
  if p_image_paths is not null then perform private.assert_merchant_image_paths(p_image_paths); end if;
  perform private.enforce_rate_limit('merchant-draft-save',60,interval '1 minute');
  perform 1 from private.merchants where id=p_merchant_id for update;
  if not exists(select 1 from private.merchant_workspace_drafts where id=p_id) and
    (select count(*) from private.merchant_workspace_drafts where merchant_id=p_merchant_id)>=100 then raise exception 'MERCHANT_DRAFT_CAP'; end if;
  if exists(select 1 from private.merchant_workspace_drafts where id=p_id and (published_at is not null or external_url is not null)) then raise exception 'MERCHANT_DRAFT_PUBLISHED'; end if;
  insert into private.merchant_workspace_drafts(id,merchant_id,channel,title,body,original_url,tag_slug,kind,image_paths)
    values(p_id,p_merchant_id,p_channel,btrim(p_title),btrim(p_body),p_original_url,p_tag_slug,p_kind,coalesce(p_image_paths,'{}'))
  on conflict(id) do update set channel=excluded.channel,title=excluded.title,body=excluded.body,original_url=excluded.original_url,
    tag_slug=excluded.tag_slug,kind=excluded.kind,image_paths=case when p_image_paths is null then private.merchant_workspace_drafts.image_paths else excluded.image_paths end,approved_at=null,approved_by=null,updated_at=now()
    where private.merchant_workspace_drafts.merchant_id=p_merchant_id and private.merchant_workspace_drafts.published_at is null and private.merchant_workspace_drafts.external_url is null;
  if not found then raise exception 'MERCHANT_DRAFT_NOT_FOUND'; end if;
  return p_id;
end;
$$;
revoke all on function public.save_merchant_workspace_draft(uuid,uuid,text,text,text,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.save_merchant_workspace_draft(uuid,uuid,text,text,text,text,text,text,text[]) to authenticated;

do $$
declare definition text; anchor text;
begin
  foreach anchor in array array['get_my_merchants()','register_my_merchant(uuid,text,text,text)'] loop
    definition:=pg_get_functiondef(('public.'||anchor)::regprocedure);
    if position('perform private.assert_active_account(auth.uid());' in definition)=0 then raise exception 'merchant access anchor changed'; end if;
    execute replace(definition,'perform private.assert_active_account(auth.uid());','perform private.assert_active_account(auth.uid()); perform private.assert_merchant_access();');
  end loop;
  definition:=pg_get_functiondef('public.get_merchant_workspace(uuid)'::regprocedure);
  if position('external_url,archived_at,updated_at from private.merchant_workspace_drafts' in definition)=0 then raise exception 'merchant image readback anchor changed'; end if;
  execute replace(definition,'external_url,archived_at,updated_at from private.merchant_workspace_drafts','external_url,archived_at,updated_at,image_paths from private.merchant_workspace_drafts');
  definition:=pg_get_functiondef('public.publish_merchant_workspace_draft(uuid,uuid,timestamp with time zone)'::regprocedure);
  anchor:='p_kind=>d.kind);';
  if position(anchor in definition)=0 then raise exception 'merchant publishing anchor changed'; end if;
  execute replace(definition,anchor,'p_image_paths=>d.image_paths,p_kind=>d.kind);');
end;
$$;
notify pgrst,'reload schema';
