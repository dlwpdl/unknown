-- Listing management uses the same live AAL2 admin boundary as edit/delete.
create or replace function public.bump_post(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); p public.posts; mid uuid; cooldown interval; next_at timestamptz; last_at timestamptz; legacy boolean;
  admin_action boolean:=private.is_admin();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select merchant_id into mid from private.merchant_posts where post_id=p_post_id;
  if mid is not null then perform private.assert_merchant_content_access(mid,false,true);
  else perform 1 from public.profiles where id=u for update; end if;
  select * into p from public.posts where id=p_post_id for update;
  if p.id is null or (mid is null and p.author_id<>u and not admin_action) then raise exception 'POST_NOT_FOUND'; end if;
  if not private.listing_alive(p.kind,p.status,p.listing_status,p.expires_at) or p.room_preview is not null
    or exists(select 1 from public.tags where id=p.tag_id and kind='meetup') then raise exception 'LISTING_NOT_OPEN'; end if;
  if admin_action then cooldown:=interval '0 hours';
  elsif mid is not null then
    cooldown:=make_interval(hours=>(private.business_membership_details(mid)->>'bumpCooldownHours')::int);
  else
    cooldown:=private.bump_cooldown(u);
    legacy:=(private.membership_details(u)->>'planVersion')::int=1;
    select last_bumped_at into last_at from private.personal_bump_state where user_id=u;
    if not legacy and last_at+cooldown>now() then raise exception 'BUMP_COOLDOWN'; end if;
  end if;
  next_at:=greatest(p.created_at,coalesce(p.bumped_at,p.created_at))+cooldown;
  if not admin_action and next_at>now() then raise exception using message=case when mid is not null then 'BUSINESS_BUMP_COOLDOWN' else 'BUMP_COOLDOWN' end; end if;
  if not admin_action then
    if mid is not null then perform private.consume_business_usage(mid,'bump',p.id);
    else insert into private.personal_bump_state(user_id,last_bumped_at) values(u,now()) on conflict(user_id) do update set last_bumped_at=excluded.last_bumped_at; end if;
  end if;
  update public.posts set sort_at=now(),bumped_at=now(),bump_count=bump_count+1,
    expires_at=case when kind='listing' then now()+interval '14 days' else expires_at end where id=p.id;
  if admin_action then perform public.log_admin_access('posts',p.author_id,p.id); end if;
  return jsonb_build_object('bumpedAt',now(),'nextBumpAt',now()+cooldown,'expiresAt',case when p.kind='listing' then now()+interval '14 days' else p.expires_at end);
end;
$$;

-- Preserve the existing merchant, reopening quota, expiry and locking checks.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.set_listing_status(uuid,text)'::regprocedure);
  anchor:='if p.id is null or p.author_id <> u then raise exception ''POST_NOT_FOUND''; end if;';
  if position(anchor in definition)=0 then raise exception 'listing owner authorization anchor changed'; end if;
  definition:=replace(definition,anchor,
    'if p.id is null or (p.author_id <> u and not private.is_admin()) then raise exception ''POST_NOT_FOUND''; end if;');
  anchor:='return jsonb_build_object(''status'', p_status, ''expiresAt'', (select expires_at from public.posts where id = p.id));';
  if position(anchor in definition)=0 then raise exception 'listing audit anchor changed'; end if;
  execute replace(definition,anchor,
    'if private.is_admin() then perform public.log_admin_access(''posts'',p.author_id,p.id); end if;'||chr(10)||'  '||anchor);
end;
$$;
