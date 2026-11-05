-- 공식 SNS 사진 소개 동의 (owner 2026-11-04 "G4 글쓰기·설정에 넣기"). Gling makes official Reels and carousels from members'
-- posts; only a photo post whose author ticked the box becomes a candidate, so the team no longer asks one by one.
-- create_post and create_post_with_poll keep their signatures (older apps still call them): the app saves consent with a
-- second call once the post is up. No row means no consent. The setting is the box's starting value (off by default);
-- turning it off also withdraws every earlier yes, so "설정에서 취소하면 돼요" holds.
-- Withdrawing never needs an active account; giving consent does.

create table private.post_photo_consent (
  post_id uuid primary key references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default clock_timestamp()
);
create index post_photo_consent_user on private.post_photo_consent(user_id);
create index post_photo_consent_granted on private.post_photo_consent(granted_at desc);
alter table private.post_photo_consent enable row level security;
revoke all on private.post_photo_consent from public,anon,authenticated,service_role;
alter table private.post_photo_consent owner to postgres;

-- A row written only for this keeps saved_places_to_friends at its default (true), the same as having no row.
alter table private.profile_sharing add column photo_consent_default boolean not null default false;

-- Live personal photo posts by this author that still carry a yes.
create function private.photo_consent_posts(p_user uuid) returns integer
language sql stable security definer set search_path='' as $$
  select count(*)::integer from private.post_photo_consent c
  join public.posts p on p.id=c.post_id and p.author_id=c.user_id
  where c.user_id=p_user and p.status='published' and p.deleted_at is null
$$;

create function public.get_photo_consent_default() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  return jsonb_build_object('photoConsentDefault',coalesce((select s.photo_consent_default from private.profile_sharing s where s.user_id=uid),false),
    'consentedPosts',private.photo_consent_posts(uid));
end $$;

create function public.set_photo_consent_default(p_on boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_on is null then raise exception 'INVALID_PHOTO_CONSENT'; end if;
  if p_on then perform private.assert_active_account(uid); end if;
  insert into private.profile_sharing(user_id,photo_consent_default) values(uid,p_on)
    on conflict(user_id) do update set photo_consent_default=excluded.photo_consent_default,updated_at=clock_timestamp();
  -- Off withdraws every earlier yes; on never reaches back to old posts.
  if not p_on then delete from private.post_photo_consent where user_id=uid; end if;
  return jsonb_build_object('photoConsentDefault',p_on,'consentedPosts',private.photo_consent_posts(uid));
end $$;

-- Only the author, only their own published personal post with at least one photo.
create function public.set_post_photo_consent(p_post_id uuid,p_consent boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_post_id is null or p_consent is null then raise exception 'INVALID_PHOTO_CONSENT'; end if;
  if p_consent then
    perform private.assert_active_account(uid);
    if not exists(select 1 from public.posts p where p.id=p_post_id and p.author_id=uid and p.business_author_id is null
      and p.status='published' and p.deleted_at is null and cardinality(p.image_paths)>0) then raise exception 'POST_NOT_FOUND'; end if;
    insert into private.post_photo_consent(post_id,user_id) values(p_post_id,uid) on conflict(post_id) do nothing;
  else
    delete from private.post_photo_consent where post_id=p_post_id and user_id=uid;
  end if;
  return jsonb_build_object('postId',p_post_id,'consent',p_consent);
end $$;

-- What the official SNS team may use: a ticked, still published personal photo post by a real, active member.
-- Operated characters (personas, seed accounts) and suspended accounts never count, whatever their row says.
-- Service role or an AAL2 admin only; an admin read is logged like other post reads.
create function public.get_photo_consent_candidates(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then perform public.log_admin_access('posts'); end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('postId',x.id,'authorId',x.author_id,'cityId',x.city_id,'title',x.title,
      'imagePaths',x.image_paths,'grantedAt',x.granted_at) order by x.granted_at desc,x.id),'[]'::jsonb)
    from (select p.id,p.author_id,p.city_id,p.title,p.image_paths,c.granted_at from private.post_photo_consent c
      join public.posts p on p.id=c.post_id and p.author_id=c.user_id
      where p.status='published' and p.deleted_at is null and p.business_author_id is null and cardinality(p.image_paths)>0
        and private.is_active_account(c.user_id) and not private.is_operated_character(c.user_id)
      order by c.granted_at desc,p.id limit least(greatest(coalesce(p_limit,50),1),200)) x);
end $$;

do $$ declare signature text; begin
 foreach signature in array array['private.photo_consent_posts(uuid)','public.get_photo_consent_default()',
  'public.set_photo_consent_default(boolean)','public.set_post_photo_consent(uuid,boolean)','public.get_photo_consent_candidates(integer)'] loop
  execute 'alter function '||signature||' owner to postgres';
  execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
 end loop;
end $$;
grant execute on function public.get_photo_consent_default(),public.set_photo_consent_default(boolean),
  public.set_post_photo_consent(uuid,boolean) to authenticated;
grant execute on function public.get_photo_consent_candidates(integer) to authenticated,service_role;

-- An unknown target rejects the whole analytics batch, so these must reach production before the app build.
insert into private.behavior_targets(id) values
  ('compose.photo-consent'),
  ('profile.settings.photo-consent.on'),
  ('profile.settings.photo-consent.off'),
  ('profile.settings.photo-consent.withdraw')
on conflict (id) do nothing;
notify pgrst,'reload schema';
