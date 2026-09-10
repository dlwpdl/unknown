-- RevenueCat snapshots are written only by the verified server integration.
create table private.membership_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  entitlements jsonb not null default '[]' check (jsonb_typeof(entitlements) = 'array'),
  observed_at timestamptz not null,
  synced_at timestamptz not null default now()
);
revoke all on private.membership_accounts from public, anon, authenticated;

create function public.apply_membership_snapshot(p_user_id uuid, p_entitlements jsonb, p_observed_at timestamptz)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_observed_at is null or p_observed_at > clock_timestamp() + interval '1 minute'
    or p_entitlements is null or jsonb_typeof(p_entitlements) <> 'array' then raise exception 'INVALID_MEMBERSHIP'; end if;
  if jsonb_array_length(p_entitlements) > 2 or exists (
    select 1 from jsonb_array_elements(p_entitlements) e
    where coalesce(e->>'tier','') not in ('plus','premium')
      or coalesce(e->>'store','') not in ('app_store','play_store','test_store')
      or coalesce(e->>'product_id','') = ''
      or coalesce(jsonb_typeof(e->'will_renew'),'') <> 'boolean'
      or (e->>'expires_at')::timestamptz is null
  ) or (select count(*) <> count(distinct e->>'tier') from jsonb_array_elements(p_entitlements) e)
    then raise exception 'INVALID_MEMBERSHIP'; end if;
  if not private.is_active_account(p_user_id) then return false; end if;
  insert into private.membership_accounts(user_id, entitlements, observed_at)
    values(p_user_id, p_entitlements, p_observed_at)
  on conflict(user_id) do update set entitlements = excluded.entitlements,
    observed_at = excluded.observed_at, synced_at = clock_timestamp()
    where excluded.observed_at > membership_accounts.observed_at;
  return found;
end;
$$;
revoke all on function public.apply_membership_snapshot(uuid,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.apply_membership_snapshot(uuid,jsonb,timestamptz) to service_role;

create function private.membership_details(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with active as (
    select e from private.membership_accounts m, jsonb_array_elements(m.entitlements) e
    where m.user_id = p_user_id and (e->>'expires_at')::timestamptz > now()
    order by case e->>'tier' when 'premium' then 2 else 1 end desc limit 1
  ), selected as (select (select e from active) e)
  select jsonb_build_object(
    'tier', coalesce(e->>'tier','free'), 'expiresAt',e->>'expires_at',
    'store',e->>'store','productId',e->>'product_id','willRenew',e->'will_renew',
    'postLimit',case e->>'tier' when 'premium' then 5 when 'plus' then 2 else 1 end,
    'meetupLimit',case e->>'tier' when 'premium' then 10 when 'plus' then 5 else 3 end,
    'conversationLimit',case e->>'tier' when 'premium' then 10 when 'plus' then 5 else 3 end
  ) from selected;
$$;
revoke all on function private.membership_details(uuid) from public, anon, authenticated;

create function public.get_membership()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  usage_day date;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  select (now() at time zone c.timezone)::date into usage_day
  from public.profiles p join public.cities c on c.id=p.city_id where p.id=current_user_id;
  return private.membership_details(current_user_id) || jsonb_build_object(
    'postsUsed',(select count(*) from public.posts where author_id=current_user_id and posted_on=usage_day),
    'meetupsUsed',(select count(*) from public.posts p where p.room_preview is not null and p.status='published'
      and (p.author_id=current_user_id or exists(select 1 from public.meetup_requests r where r.post_id=p.id and r.requester_id=current_user_id and r.status='approved'))),
    'conversationsUsed',(select count(*) from private.action_rate_events where user_id=current_user_id and action='conversation' and created_at>now()-interval '1 day'),
    'conversationPeriod','day'
  );
end;
$$;
revoke all on function public.get_membership() from public, anon, authenticated;
grant execute on function public.get_membership() to authenticated;

create function public.begin_membership_sync()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  perform private.enforce_rate_limit('membership_sync', 20, interval '1 minute');
end;
$$;
revoke all on function public.begin_membership_sync() from public, anon, authenticated;
grant execute on function public.begin_membership_sync() to authenticated;

create or replace function public.get_post_quota()
returns table(used_count integer, max_count smallint)
language plpgsql stable security definer set search_path = '' as $$
declare membership jsonb;
begin
  membership := public.get_membership();
  used_count := (membership->>'postsUsed')::integer;
  max_count := (membership->>'postLimit')::smallint;
  return next;
end;
$$;

create or replace function public.create_post(
  p_city_id text,
  p_tag_id smallint,
  p_title text,
  p_body text,
  p_hashtags text[] default '{}',
  p_image_paths text[] default '{}',
  p_room_preview jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  profile_timezone text;
  daily_limit smallint;
  usage_day date;
  used_count integer;
  tag_kind text;
  post_id uuid;
  normalized_hashtags text[] := '{}';
  room_preview jsonb;
  room_capacity integer := 8;
  verified_only boolean := false;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);

  select (private.membership_details(profile.id)->>'postLimit')::smallint, city.timezone
  into daily_limit, profile_timezone
  from public.profiles as profile
  join public.cities as city on city.id = profile.city_id
  where profile.id = current_user_id
  for update of profile;

  if daily_limit is null then raise exception 'PROFILE_REQUIRED'; end if;
  if not exists (select 1 from public.cities where id = p_city_id and is_open) then
    raise exception 'CITY_NOT_OPEN';
  end if;

  select kind into tag_kind from public.tags where id = p_tag_id;
  if tag_kind is null then raise exception 'INVALID_TAG'; end if;
  if coalesce(cardinality(p_hashtags), 0) > 5 then raise exception 'TOO_MANY_HASHTAGS'; end if;
  if coalesce(cardinality(p_image_paths), 0) > 4 then raise exception 'TOO_MANY_IMAGES'; end if;
  if exists (
    select 1 from unnest(coalesce(p_image_paths, '{}'::text[])) as path
    where path not like current_user_id::text || '/%'
  ) then raise exception 'INVALID_IMAGE_PATH'; end if;

  select coalesce(array_agg(canonical order by first_position), '{}')
  into normalized_hashtags
  from (
    select distinct on (lower(canonical)) canonical, position as first_position
    from (
      select private.canonicalize_hashtag(raw) as canonical, position
      from unnest(coalesce(p_hashtags, '{}'::text[])) with ordinality as input(raw, position)
    ) normalized
    where canonical is not null
    order by lower(canonical), position
  ) unique_tags;

  if exists (
    select 1 from unnest(normalized_hashtags) as hashtag
    where char_length(hashtag) not between 1 and 30
      or hashtag ~ '[[:cntrl:]]'
  ) then raise exception 'INVALID_HASHTAG'; end if;

  usage_day := (now() at time zone profile_timezone)::date;
  select count(*) into used_count
  from public.posts
  where author_id = current_user_id and posted_on = usage_day;
  if used_count >= daily_limit then raise exception 'DAILY_POST_LIMIT_REACHED'; end if;

  if tag_kind = 'meetup' then
    if p_room_preview is not null and jsonb_typeof(p_room_preview) <> 'object' then
      raise exception 'INVALID_ROOM_PREVIEW';
    end if;
    if p_room_preview ? 'capacity' then
      if jsonb_typeof(p_room_preview -> 'capacity') <> 'number' then raise exception 'INVALID_ROOM_PREVIEW'; end if;
      room_capacity := (p_room_preview ->> 'capacity')::integer;
    end if;
    if p_room_preview ? 'verifiedOnly' then
      if jsonb_typeof(p_room_preview -> 'verifiedOnly') <> 'boolean' then raise exception 'INVALID_ROOM_PREVIEW'; end if;
      verified_only := (p_room_preview ->> 'verifiedOnly')::boolean;
    end if;
    if room_capacity not between 2 and 30 then raise exception 'INVALID_ROOM_PREVIEW'; end if;
    if exists (
      select 1 from public.posts as existing_post
      where existing_post.author_id = current_user_id
        and existing_post.room_preview is not null
        and existing_post.status = 'published'
        and existing_post.created_at > now() - interval '6 hours'
    ) then raise exception 'MEETUP_COOLDOWN'; end if;
    room_preview := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'title', trim(p_title),
      'memberCount', 1,
      'capacity', room_capacity,
      'verifiedOnly', verified_only
    );
  else
    room_preview := null;
  end if;

  insert into public.posts (
    author_id, city_id, tag_id, title, body, hashtags, image_paths,
    room_preview, status, posted_on
  )
  values (
    current_user_id, p_city_id, p_tag_id, trim(p_title), trim(p_body),
    normalized_hashtags, coalesce(p_image_paths, '{}'),
    room_preview, 'published', usage_day
  )
  returning id into post_id;

  return post_id;
end;
$$;
