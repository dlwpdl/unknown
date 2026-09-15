-- Listing posts (rent, second-hand, cars): tasks/listing-spec.md, owner decisions 2026-09-14.
-- A post now has a kind. Stories keep the daily limit. Listings ignore it and are capped by
-- how many are alive (5/10/20 by tier), expire after 14 days, can be bumped (24/18/12h cooldown,
-- unlimited), and a duplicate title within 30 days is refused so people bump instead of reposting.
-- Feed order moves to sort_at (= created_at until bumped). Existing store builds keep calling the
-- old feed RPC; new clients call get_public_feed_page_v2. Threads (slot-free chats) come later.

alter table public.posts
  add column kind text not null default 'story' check (kind in ('story','listing')),
  add column listing_status text check (listing_status in ('open','partial','closed')),
  add column price numeric(12,2) check (price is null or price >= 0),
  add column expires_at timestamptz,
  add column bumped_at timestamptz,
  add column bump_count integer not null default 0 check (bump_count >= 0),
  add column sort_at timestamptz not null default now();
update public.posts set sort_at = created_at;
alter table public.posts add constraint posts_listing_shape check (
  (kind = 'story' and listing_status is null and expires_at is null and price is null)
  or (kind = 'listing' and listing_status is not null and expires_at is not null));
create index posts_feed_sort_idx on public.posts (city_id, sort_at desc, id desc) where status = 'published';
create index posts_author_listing_idx on public.posts (author_id) where kind = 'listing' and status = 'published';

-- Tier rules live next to the other membership numbers.
create function private.listing_limit(p_user_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case private.membership_details(p_user_id)->>'tier' when 'premium' then 20 when 'plus' then 10 else 5 end;
$$;
create function private.bump_cooldown(p_user_id uuid) returns interval
language sql stable security definer set search_path = '' as $$
  select case private.membership_details(p_user_id)->>'tier' when 'premium' then interval '12 hours' when 'plus' then interval '18 hours' else interval '24 hours' end;
$$;
create function private.listing_alive(p_kind text, p_status text, p_listing_status text, p_expires_at timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select p_status = 'published' and (p_kind = 'story' or (p_listing_status in ('open','partial') and p_expires_at > now()));
$$;
create function private.active_listing_count(p_user_id uuid, p_except uuid default null) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.posts
  where author_id = p_user_id and kind = 'listing' and status = 'published'
    and listing_status in ('open','partial') and expires_at > now() and (p_except is null or id <> p_except);
$$;
create function private.normalize_listing_title(p_title text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(regexp_replace(coalesce(p_title,''), '[^[:alnum:]가-힣]+', '', 'g'));
$$;
revoke all on function private.listing_limit(uuid), private.bump_cooldown(uuid),
  private.listing_alive(text,text,text,timestamptz), private.active_listing_count(uuid,uuid),
  private.normalize_listing_title(text) from public, anon, authenticated;

-- create_post gains p_kind/p_price. Old clients keep sending the seven original arguments.
drop function public.create_post(text, smallint, text, text, text[], text[], jsonb);
create function public.create_post(
  p_city_id text, p_tag_id smallint, p_title text, p_body text,
  p_hashtags text[] default '{}'::text[], p_image_paths text[] default '{}'::text[], p_room_preview jsonb default null,
  p_kind text default 'story', p_price numeric default null
) returns uuid language plpgsql security definer set search_path = '' as $function$
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
  is_listing boolean := p_kind = 'listing';
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_kind is null or p_kind not in ('story','listing') then raise exception 'INVALID_POST_KIND'; end if;
  perform private.assert_active_account(current_user_id); perform private.lock_relationships();

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
  if is_listing and tag_kind <> 'post' then raise exception 'INVALID_POST_KIND'; end if;
  if not is_listing and p_price is not null then raise exception 'INVALID_POST_KIND'; end if;
  if p_price is not null and (p_price < 0 or p_price > 99999999) then raise exception 'INVALID_PRICE'; end if;
  if coalesce(cardinality(p_hashtags), 0) > 5 then raise exception 'TOO_MANY_HASHTAGS'; end if;
  if coalesce(cardinality(p_image_paths), 0) > (case when is_listing then 8 else 4 end) then raise exception 'TOO_MANY_IMAGES'; end if;
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
  if is_listing then
    -- Alive count instead of a daily quota; a same-title listing within 30 days must be bumped or reopened.
    if private.active_listing_count(current_user_id) >= private.listing_limit(current_user_id) then
      raise exception 'LISTING_LIMIT_REACHED';
    end if;
    if exists (
      select 1 from public.posts existing
      where existing.author_id = current_user_id and existing.kind = 'listing' and existing.status = 'published'
        and private.normalize_listing_title(existing.title) = private.normalize_listing_title(p_title)
        and (private.listing_alive(existing.kind, existing.status, existing.listing_status, existing.expires_at)
          or coalesce(existing.updated_at, existing.created_at) > now() - interval '30 days')
    ) then raise exception 'DUPLICATE_LISTING'; end if;
  else
    select count(*) into used_count
    from public.posts
    where author_id = current_user_id and posted_on = usage_day and kind = 'story';
    if used_count >= daily_limit then raise exception 'DAILY_POST_LIMIT_REACHED'; end if;
  end if;

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
    room_preview, status, posted_on, kind, listing_status, price, expires_at
  )
  values (
    current_user_id, p_city_id, p_tag_id, trim(p_title), trim(p_body),
    normalized_hashtags, coalesce(p_image_paths, '{}'),
    room_preview, 'published', usage_day, p_kind,
    case when is_listing then 'open' end, case when is_listing then p_price end,
    case when is_listing then now() + interval '14 days' end
  )
  returning id into post_id;

  return post_id;
end;
$function$;
revoke all on function public.create_post(text, smallint, text, text, text[], text[], jsonb, text, numeric) from public, anon;
grant execute on function public.create_post(text, smallint, text, text, text[], text[], jsonb, text, numeric) to authenticated;

-- Bump: unlimited, server-enforced cooldown by tier, refreshes the 14-day life. Never touches created_at.
create function public.bump_post(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); p public.posts; cooldown interval; next_at timestamptz;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select * into p from public.posts where id = p_post_id for update;
  if p.id is null or p.author_id <> u then raise exception 'POST_NOT_FOUND'; end if;
  if p.kind <> 'listing' or not private.listing_alive(p.kind, p.status, p.listing_status, p.expires_at) then raise exception 'LISTING_NOT_OPEN'; end if;
  cooldown := private.bump_cooldown(u);
  next_at := greatest(p.created_at, coalesce(p.bumped_at, p.created_at)) + cooldown;
  if next_at > now() then raise exception 'BUMP_COOLDOWN'; end if;
  update public.posts set sort_at = now(), bumped_at = now(), bump_count = bump_count + 1,
    expires_at = now() + interval '14 days' where id = p.id;
  return jsonb_build_object('bumpedAt', now(), 'nextBumpAt', now() + cooldown, 'expiresAt', now() + interval '14 days');
end;
$$;

-- open/partial/closed by the author. Reopening takes an alive slot again and resets bump history.
create function public.set_listing_status(p_post_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); p public.posts; reopening boolean;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_status is null or p_status not in ('open','partial','closed') then raise exception 'INVALID_LISTING_STATUS'; end if;
  select * into p from public.posts where id = p_post_id for update;
  if p.id is null or p.author_id <> u then raise exception 'POST_NOT_FOUND'; end if;
  if p.kind <> 'listing' or p.status <> 'published' then raise exception 'LISTING_NOT_OPEN'; end if;
  reopening := p_status <> 'closed' and not private.listing_alive(p.kind, p.status, p.listing_status, p.expires_at);
  if reopening then
    perform private.lock_relationships();
    if private.active_listing_count(u, p.id) >= private.listing_limit(u) then raise exception 'LISTING_LIMIT_REACHED'; end if;
    update public.posts set listing_status = p_status, expires_at = now() + interval '14 days',
      bumped_at = null, bump_count = 0, sort_at = now() where id = p.id;
  else
    update public.posts set listing_status = p_status where id = p.id;
  end if;
  return jsonb_build_object('status', p_status, 'expiresAt', (select expires_at from public.posts where id = p.id));
end;
$$;

create function public.get_listing_quota() returns table (used_count integer, max_count integer)
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  used_count := private.active_listing_count(u); max_count := private.listing_limit(u);
  return next;
end;
$$;
revoke all on function public.bump_post(uuid), public.set_listing_status(uuid, text), public.get_listing_quota() from public, anon;
grant execute on function public.bump_post(uuid), public.set_listing_status(uuid, text), public.get_listing_quota() to authenticated;

-- Daily quota shown in the composer counts stories only.
create or replace function public.get_membership() returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare u uuid:=auth.uid(); day date; details jsonb; groups integer; directs integer; gl integer; dl integer;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select (now() at time zone c.timezone)::date into day from public.profiles p join public.cities c on c.id=p.city_id where p.id=u;
  details:=private.membership_details(u); groups:=private.membership_meetup_count(u); directs:=private.direct_slot_count(u);
  gl:=private.relationship_locked_count(u,'group'); dl:=private.relationship_locked_count(u,'direct');
  return details||jsonb_build_object('postsUsed',(select count(*) from public.posts where author_id=u and posted_on=day and kind='story'),
    'meetupsUsed',groups,'conversationsUsed',directs,'conversationPeriod','active',
    'meetupSlotsLocked',gl,'meetupSlotsAvailable',greatest(0,(details->>'meetupLimit')::integer-groups-gl),
    'conversationSlotsLocked',dl,'conversationSlotsAvailable',greatest(0,(details->>'conversationLimit')::integer-directs-dl),
    'meetupUnlocksAt',coalesce((select jsonb_agg(unlocks_at order by unlocks_at) from private.relationship_cooldowns where user_id=u and pool='group' and unlocks_at>now()),'[]'::jsonb),
    'conversationUnlocksAt',coalesce((select jsonb_agg(unlocks_at order by unlocks_at) from private.relationship_cooldowns where user_id=u and pool='direct' and unlocks_at>now()),'[]'::jsonb),
    'listingsUsed',private.active_listing_count(u),'listingLimit',private.listing_limit(u));
end;
$function$;

-- Feed for new clients: sort_at order, closed/expired listings hidden, listing columns appended.
create function public.get_public_feed_page_v2(
  p_city_id text,
  p_tag_id smallint default null,
  p_query text default null,
  p_before_sort timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid, city_id text, title text, body text, hashtags text[], image_paths text[],
  room_preview jsonb, created_at timestamptz, like_count integer, view_count integer,
  comment_count integer, save_count integer, share_count integer, liked_by_me boolean,
  saved_by_me boolean, author_id uuid, author_nickname text, author_neighborhood text,
  author_verification_level smallint, tag_id smallint, tag_slug text, tag_label text, tag_kind text,
  kind text, listing_status text, price numeric, expires_at timestamptz, bumped_at timestamptz, sort_at timestamptz
)
language plpgsql stable security definer set search_path = '' set plan_cache_mode = force_custom_plan as $$
#variable_conflict use_column
declare page_size integer := greatest(1, least(coalesce(p_limit, 30), 50)); q text := nullif(trim(coalesce(p_query,'')),'');
begin
  return query
  with eligible as not materialized (
    select post.* from public.posts post
    join public.profiles profile on profile.id = post.author_id and profile.account_status = 'active'
    where private.listing_alive(post.kind, post.status, post.listing_status, post.expires_at)
      and post.city_id = p_city_id
      and (p_tag_id is null or post.tag_id = p_tag_id)
      and (p_before_sort is null or (post.sort_at, post.id) < (p_before_sort, p_before_id))
      and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id))
  ), hits as (
    (select post.id from eligible post where q is null order by post.sort_at desc, post.id desc limit page_size)
    union
    (select post.id from eligible post where q is not null and (post.title || ' ' || post.body) ilike '%'||q||'%'
      order by post.sort_at desc, post.id desc limit page_size)
    union
    (select post.id from eligible post where q is not null and post.author_id in (select matched.id from public.profiles matched
        where matched.nickname ilike '%'||q||'%' or coalesce(matched.neighborhood,'') ilike '%'||q||'%')
      order by post.sort_at desc, post.id desc limit page_size)
    union
    (select post.id from eligible post where q is not null
        and exists(select 1 from unnest(post.hashtags) hashtag where hashtag ilike '%'||q||'%')
      order by post.sort_at desc, post.id desc limit page_size)
  )
  select
    post.id, post.city_id, post.title, post.body, post.hashtags, post.image_paths,
    post.room_preview, post.created_at, post.like_count, post.view_count,
    post.comment_count, post.save_count, post.share_count,
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'like'),
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'save'),
    profile.id, profile.nickname::text, profile.neighborhood, profile.verification_level,
    tag.id, tag.slug, tag.label, tag.kind,
    post.kind, post.listing_status, post.price, post.expires_at, post.bumped_at, post.sort_at
  from public.posts post
  join hits on hits.id = post.id
  join public.profiles profile on profile.id = post.author_id
  join public.tags tag on tag.id = post.tag_id
  order by post.sort_at desc, post.id desc
  limit page_size;
end;
$$;
grant execute on function public.get_public_feed_page_v2(text, smallint, text, timestamptz, uuid, integer) to anon, authenticated;

-- Detail keeps working for closed listings (read-only) and now carries the listing columns.
drop function public.get_public_post(uuid);
create function public.get_public_post(p_post_id uuid)
returns table (
  id uuid, city_id text, title text, body text, hashtags text[], image_paths text[],
  room_preview jsonb, created_at timestamptz, like_count integer, view_count integer,
  comment_count integer, save_count integer, share_count integer, liked_by_me boolean,
  saved_by_me boolean, author_id uuid, author_nickname text, author_neighborhood text,
  author_verification_level smallint, tag_id smallint, tag_slug text, tag_label text, tag_kind text,
  kind text, listing_status text, price numeric, expires_at timestamptz, bumped_at timestamptz, sort_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select
    post.id, post.city_id, post.title, post.body, post.hashtags, post.image_paths,
    post.room_preview, post.created_at, post.like_count, post.view_count,
    post.comment_count, post.save_count, post.share_count,
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'like'),
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'save'),
    profile.id, profile.nickname::text, profile.neighborhood,
    profile.verification_level, tag.id, tag.slug, tag.label, tag.kind,
    post.kind, post.listing_status, post.price, post.expires_at, post.bumped_at, post.sort_at
  from public.posts as post
  join public.profiles as profile on profile.id = post.author_id
  join public.tags as tag on tag.id = post.tag_id
  where post.id = p_post_id
    and post.status = 'published'
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id));
$$;
grant execute on function public.get_public_post(uuid) to anon, authenticated;
