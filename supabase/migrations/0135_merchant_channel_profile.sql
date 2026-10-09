-- Channel images reuse the registered company and its existing public details.
alter table private.merchants
  add column avatar_path text constraint merchants_avatar_path_check check(avatar_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$' and split_part(split_part(avatar_path,'/',2),'_',1)=id::text),
  add column banner_path text constraint merchants_banner_path_check check(banner_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$' and split_part(split_part(banner_path,'/',2),'_',1)=id::text);
create index merchants_avatar_path_idx on private.merchants(avatar_path) where avatar_path is not null;
create index merchants_banner_path_idx on private.merchants(banner_path) where banner_path is not null;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('merchant-profile-images','merchant-profile-images',false,2097152,array['image/webp']);

create function public.get_merchant_profile(p_merchant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',m.id,'name',m.name,'city_id',m.city_id,'city_name',c.name,
    'industry',m.industry,'services',m.services,'address',m.address,
    'avatar_path',m.avatar_path,'banner_path',m.banner_path,'review_post_id',visible.post_id)
  from private.merchants m join public.cities c on c.id=m.city_id
  join lateral (
    select mp.post_id from private.merchant_posts mp join public.posts p on p.id=mp.post_id
    where mp.merchant_id=m.id and private.merchant_review_merchant(mp.post_id,auth.uid())=m.id
    order by p.created_at desc,p.id desc limit 1
  ) visible on true where m.id=p_merchant_id;
$$;
create function public.get_my_merchant_profile(p_merchant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants; uid uuid:=auth.uid();
begin
  m:=private.assert_merchant_workspace(p_merchant_id);
  return jsonb_build_object('id',m.id,'name',m.name,'city_id',m.city_id,
    'city_name',(select name from public.cities where id=m.city_id),
    'industry',m.industry,'services',m.services,'address',m.address,
    'avatar_path',m.avatar_path,'banner_path',m.banner_path,
    'review_post_id',public.get_merchant_profile(m.id)->'review_post_id',
    'updated_at',m.updated_at,'can_edit',coalesce(m.owner_id=uid and m.owner_verified_at is not null
      and exists(select 1 from auth.users where id=uid and raw_app_meta_data->'merchant_enabled'='true'::jsonb),false));
end;
$$;
revoke all on function public.get_merchant_profile(uuid),public.get_my_merchant_profile(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_merchant_profile(uuid) to anon,authenticated;
grant execute on function public.get_my_merchant_profile(uuid) to authenticated;

-- All mutations take account -> current capability -> company -> image locks.
create function private.lock_merchant_profile_owner(p_merchant_id uuid,p_write boolean default false) returns private.merchants
language plpgsql security definer set search_path='' as $$
declare m private.merchants; uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=uid and account_status='active' for share;
  if not found then raise exception 'ACCOUNT_LOCKED'; end if;
  perform 1 from auth.users where id=uid for share;
  if p_write then select * into m from private.merchants where id=p_merchant_id for update;
  else select * into m from private.merchants where id=p_merchant_id for share; end if;
  perform private.assert_merchant_workspace(p_merchant_id);
  if m.owner_id is distinct from uid then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  if m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
  if not exists(select 1 from auth.users where id=uid and raw_app_meta_data->'merchant_enabled'='true'::jsonb) then raise exception 'MERCHANT_ACCOUNT_REQUIRED'; end if;
  return m;
end;
$$;
create function private.assert_merchant_profile_image(p_path text,p_merchant_id uuid,p_retained text) returns void
language plpgsql security definer set search_path='' as $$
declare uploader uuid;
begin
  if p_path is null then return; end if;
  if p_path !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$'
    or split_part(split_part(p_path,'/',2),'_',1)<>p_merchant_id::text
    or (p_path is distinct from p_retained and split_part(p_path,'/',1)<>auth.uid()::text)
    then raise exception 'INVALID_MERCHANT_PROFILE_IMAGE'; end if;
  uploader:=split_part(p_path,'/',1)::uuid;
  perform pg_advisory_xact_lock(hashtextextended(p_path,1314));
  perform 1 from storage.objects o where o.bucket_id='merchant-profile-images' and o.name=p_path
    and (o.owner_id=uploader::text or o.owner=uploader) and o.metadata->>'mimetype'='image/webp'
    and case when o.metadata->>'size' ~ '^[0-9]{1,10}$' then (o.metadata->>'size')::bigint between 1 and 2097152 else false end
    for share;
  if not found then raise exception 'INVALID_MERCHANT_PROFILE_IMAGE'; end if;
end;
$$;
create function public.save_my_merchant_profile(p_merchant_id uuid,p_avatar_path text,p_banner_path text,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants;
begin
  m:=private.lock_merchant_profile_owner(p_merchant_id,true);
  if m.avatar_path is not distinct from p_avatar_path and m.banner_path is not distinct from p_banner_path then
    return public.get_my_merchant_profile(m.id);
  end if;
  if p_expected_updated_at is distinct from m.updated_at then raise exception 'MERCHANT_PROFILE_CHANGED'; end if;
  perform private.assert_merchant_profile_image(p_avatar_path,m.id,m.avatar_path);
  perform private.assert_merchant_profile_image(p_banner_path,m.id,m.banner_path);
  update private.merchants set avatar_path=p_avatar_path,banner_path=p_banner_path,updated_at=clock_timestamp() where id=m.id;
  return public.get_my_merchant_profile(m.id);
end;
$$;
create function private.can_upload_merchant_profile_image(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or split_part(p_path,'/',1)<>auth.uid()::text
    or p_path !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$' then return false; end if;
  perform private.lock_merchant_profile_owner(split_part(split_part(p_path,'/',2),'_',1)::uuid);
  return true;
exception when sqlstate 'P0001' then return false;
end;
$$;
create function private.can_read_merchant_profile_image(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare mid uuid;
begin
  select id into mid from private.merchants where avatar_path=p_path or banner_path=p_path limit 1;
  if mid is null then return private.can_upload_merchant_profile_image(p_path); end if;
  if public.get_merchant_profile(mid) is not null then return true; end if;
  -- Private saved-image preview follows the existing audited workspace reader.
  perform private.assert_merchant_workspace(mid);
  return true;
exception when sqlstate 'P0001' then return false;
end;
$$;
create function private.can_delete_merchant_profile_image(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if not private.can_upload_merchant_profile_image(p_path) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_path,1314));
  return not exists(select 1 from private.merchants where avatar_path=p_path or banner_path=p_path);
end;
$$;
revoke all on function private.lock_merchant_profile_owner(uuid,boolean),private.assert_merchant_profile_image(text,uuid,text),
  private.can_upload_merchant_profile_image(text),private.can_read_merchant_profile_image(text),private.can_delete_merchant_profile_image(text),
  public.save_my_merchant_profile(uuid,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.save_my_merchant_profile(uuid,text,text,timestamptz),private.can_upload_merchant_profile_image(text),
  private.can_delete_merchant_profile_image(text) to authenticated;
grant execute on function private.can_read_merchant_profile_image(text) to anon,authenticated;
create policy "verified owners upload immutable channel images" on storage.objects for insert to authenticated
  with check(case when bucket_id='merchant-profile-images' then private.can_upload_merchant_profile_image(name) else false end);
create policy "read eligible saved or authorized own channel images" on storage.objects for select to anon,authenticated
  using(case when bucket_id='merchant-profile-images' then private.can_read_merchant_profile_image(name) else false end);
create policy "verified uploaders remove only unbound channel images" on storage.objects for delete to authenticated
  using(case when bucket_id='merchant-profile-images' then private.can_delete_merchant_profile_image(name) else false end);
-- No UPDATE policy: saved images remain immutable.

create function private.erase_deleted_merchant_channel_images() returns trigger
language plpgsql security definer set search_path='' as $$
declare m private.merchants;
begin
  for m in select * from private.merchants
    where (owner_id=new.id and (avatar_path is not null or banner_path is not null))
      or split_part(avatar_path,'/',1)=new.id::text or split_part(banner_path,'/',1)=new.id::text
    order by id for update
  loop
    update private.merchants set
      avatar_path=case when m.owner_id=new.id or split_part(m.avatar_path,'/',1)=new.id::text then null else m.avatar_path end,
      banner_path=case when m.owner_id=new.id or split_part(m.banner_path,'/',1)=new.id::text then null else m.banner_path end,
      updated_at=clock_timestamp() where id=m.id;
  end loop;
  return new;
end;
$$;
revoke all on function private.erase_deleted_merchant_channel_images() from public,anon,authenticated,service_role;
create trigger profiles_erase_merchant_channel_images after update of account_status on public.profiles
  for each row when(new.account_status='deleted' and old.account_status is distinct from new.account_status)
  execute function private.erase_deleted_merchant_channel_images();

notify pgrst,'reload schema';
