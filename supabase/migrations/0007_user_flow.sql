-- 사용자 쓰기 흐름을 원자적 RPC와 공개 읽기 모델에 연결한다.

alter table public.profiles
add column daily_post_limit smallint not null default 1
check (daily_post_limit between 1 and 10);

alter table public.posts
drop constraint posts_author_id_posted_on_key,
add column share_count integer not null default 0 check (share_count >= 0);

create index posts_author_day_idx
  on public.posts (author_id, posted_on, created_at desc);

revoke insert on public.posts from authenticated;

create function public.create_post(
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
  room_preview jsonb := p_room_preview;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;

  select profile.daily_post_limit, city.timezone
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

  usage_day := (now() at time zone profile_timezone)::date;
  select count(*) into used_count
  from public.posts
  where author_id = current_user_id and posted_on = usage_day;
  if used_count >= daily_limit then raise exception 'DAILY_POST_LIMIT_REACHED'; end if;

  if tag_kind = 'meetup' and room_preview is null then
    room_preview := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'title', trim(p_title),
      'memberCount', 1,
      'verifiedOnly', false
    );
  elsif tag_kind <> 'meetup' then
    room_preview := null;
  end if;

  insert into public.posts (
    author_id, city_id, tag_id, title, body, hashtags, image_paths,
    room_preview, status, posted_on
  )
  values (
    current_user_id, p_city_id, p_tag_id, trim(p_title), trim(p_body),
    coalesce(p_hashtags, '{}'), coalesce(p_image_paths, '{}'),
    room_preview, 'published', usage_day
  )
  returning id into post_id;

  return post_id;
end;
$$;

create function public.get_post_quota()
returns table (used_count integer, max_count smallint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  profile_timezone text;
  usage_day date;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;

  select profile.daily_post_limit, city.timezone
  into max_count, profile_timezone
  from public.profiles as profile
  join public.cities as city on city.id = profile.city_id
  where profile.id = current_user_id;
  if max_count is null then raise exception 'PROFILE_REQUIRED'; end if;

  usage_day := (now() at time zone profile_timezone)::date;
  select count(*)::integer into used_count
  from public.posts
  where author_id = current_user_id and posted_on = usage_day;
  return next;
end;
$$;

create function public.record_post_share(p_post_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  next_count integer;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.posts
  set share_count = share_count + 1
  where id = p_post_id
    and status = 'published'
    and not private.is_blocked_between(current_user_id, author_id)
  returning share_count into next_count;
  if next_count is null then raise exception 'POST_NOT_FOUND'; end if;
  return next_count;
end;
$$;

drop function public.get_public_feed(text, integer);
drop function public.get_public_comments(uuid[]);

create function public.get_public_feed(
  p_city_id text default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  city_id text,
  title text,
  body text,
  hashtags text[],
  image_paths text[],
  room_preview jsonb,
  created_at timestamptz,
  like_count integer,
  view_count integer,
  comment_count integer,
  save_count integer,
  share_count integer,
  liked_by_me boolean,
  saved_by_me boolean,
  author_id uuid,
  author_nickname text,
  author_neighborhood text,
  author_verification_level smallint,
  tag_id smallint,
  tag_slug text,
  tag_label text,
  tag_kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    post.id, post.city_id, post.title, post.body, post.hashtags, post.image_paths,
    post.room_preview, post.created_at, post.like_count, post.view_count,
    post.comment_count, post.save_count, post.share_count,
    exists (
      select 1 from public.post_reactions
      where post_id = post.id and user_id = auth.uid() and kind = 'like'
    ),
    exists (
      select 1 from public.post_reactions
      where post_id = post.id and user_id = auth.uid() and kind = 'save'
    ),
    profile.id, profile.nickname::text, profile.neighborhood,
    profile.verification_level, tag.id, tag.slug, tag.label, tag.kind
  from public.posts as post
  join public.profiles as profile on profile.id = post.author_id
  join public.tags as tag on tag.id = post.tag_id
  where post.status = 'published'
    and (p_city_id is null or post.city_id = p_city_id)
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id))
  order by post.created_at desc, post.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create function public.get_public_post(p_post_id uuid)
returns table (
  id uuid,
  city_id text,
  title text,
  body text,
  hashtags text[],
  image_paths text[],
  room_preview jsonb,
  created_at timestamptz,
  like_count integer,
  view_count integer,
  comment_count integer,
  save_count integer,
  share_count integer,
  liked_by_me boolean,
  saved_by_me boolean,
  author_id uuid,
  author_nickname text,
  author_neighborhood text,
  author_verification_level smallint,
  tag_id smallint,
  tag_slug text,
  tag_label text,
  tag_kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    post.id, post.city_id, post.title, post.body, post.hashtags, post.image_paths,
    post.room_preview, post.created_at, post.like_count, post.view_count,
    post.comment_count, post.save_count, post.share_count,
    exists (
      select 1 from public.post_reactions
      where post_id = post.id and user_id = auth.uid() and kind = 'like'
    ),
    exists (
      select 1 from public.post_reactions
      where post_id = post.id and user_id = auth.uid() and kind = 'save'
    ),
    profile.id, profile.nickname::text, profile.neighborhood,
    profile.verification_level, tag.id, tag.slug, tag.label, tag.kind
  from public.posts as post
  join public.profiles as profile on profile.id = post.author_id
  join public.tags as tag on tag.id = post.tag_id
  where post.id = p_post_id
    and post.status = 'published'
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id));
$$;

create function public.get_public_comments(p_post_ids uuid[])
returns table (
  id uuid,
  post_id uuid,
  author_id uuid,
  body text,
  like_count integer,
  liked_by_me boolean,
  created_at timestamptz,
  author_nickname text,
  author_verification_level smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    comment.id, comment.post_id, comment.author_id, comment.body,
    comment.like_count,
    exists (
      select 1 from public.comment_likes
      where comment_id = comment.id and user_id = auth.uid()
    ),
    comment.created_at, profile.nickname::text, profile.verification_level
  from public.comments as comment
  join public.posts as post on post.id = comment.post_id
  join public.profiles as profile on profile.id = comment.author_id
  where coalesce(cardinality(p_post_ids), 0) between 1 and 100
    and comment.post_id = any(p_post_ids)
    and comment.deleted_at is null
    and post.status = 'published'
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(), comment.author_id))
  order by comment.created_at, comment.id;
$$;

revoke all on function public.create_post(text, smallint, text, text, text[], text[], jsonb) from public, anon, authenticated;
revoke all on function public.get_post_quota() from public, anon, authenticated;
revoke all on function public.record_post_share(uuid) from public, anon, authenticated;
revoke all on function public.get_public_feed(text, integer) from public;
revoke all on function public.get_public_post(uuid) from public;
revoke all on function public.get_public_comments(uuid[]) from public;

grant execute on function public.create_post(text, smallint, text, text, text[], text[], jsonb) to authenticated;
grant execute on function public.get_post_quota() to authenticated;
grant execute on function public.record_post_share(uuid) to authenticated;
grant execute on function public.get_public_feed(text, integer) to anon, authenticated;
grant execute on function public.get_public_post(uuid) to anon, authenticated;
grant execute on function public.get_public_comments(uuid[]) to anon, authenticated;
