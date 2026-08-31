-- 서버 입력 경계, 고유 공유, 호출 제한, 고유 작성자 기반 트렌드, 수정 콘텐츠 재검토.

create table public.post_shares (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index post_shares_user_idx on public.post_shares (user_id, created_at desc);

alter table public.post_shares enable row level security;
revoke all on public.post_shares from anon, authenticated;

create table private.action_rate_events (
  user_id uuid not null references public.profiles(id),
  action text not null,
  created_at timestamptz not null default now()
);

create index action_rate_events_lookup_idx
  on private.action_rate_events (user_id, action, created_at desc);

alter table public.profiles
add column account_status text not null default 'active'
check (account_status in ('active', 'suspended', 'deleted', 'reactivation_pending'));

create function private.is_active_account(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = user_id
      and account_status = 'active'
  );
$$;

create function private.assert_active_account(user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_account(user_id) then
    raise exception 'ACCOUNT_LOCKED';
  end if;
end;
$$;

create function private.enforce_rate_limit(
  p_action text,
  p_max_count integer,
  p_window interval,
  p_cooldown interval default interval '0 seconds'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || p_action, 0));

  if p_cooldown > interval '0 seconds' and exists (
    select 1 from private.action_rate_events
    where user_id = current_user_id
      and action = p_action
      and created_at > now() - p_cooldown
  ) then
    raise exception 'RATE_LIMITED';
  end if;

  if (
    select count(*) from private.action_rate_events
    where user_id = current_user_id
      and action = p_action
      and created_at > now() - p_window
  ) >= p_max_count then
    raise exception 'RATE_LIMITED';
  end if;

  insert into private.action_rate_events (user_id, action)
  values (current_user_id, p_action);
end;
$$;

create function private.canonicalize_hashtag(value text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  normalized text := regexp_replace(normalize(coalesce(value, ''), NFKC), '^#+|\s+', '', 'g');
  key text;
begin
  if normalized = '' then return null; end if;
  key := lower(normalized);
  return case key
    when 'burnaby' then '버나비'
    when 'coquitlam' then '코퀴틀람'
    when '코퀴틀럼' then '코퀴틀람'
    when '커퀴틀람' then '코퀴틀람'
    when 'kitsilano' then '킷실라노'
    when 'langley' then '랭리'
    when 'mississauga' then '미시사가'
    when 'metrotown' then '메트로타운'
    when 'northyork' then '노스욕'
    when 'richmond' then '리치몬드'
    when 'surrey' then '써리'
    when 'downtown' then '다운타운'
    when 'koreatown' then '코리아타운'
    when 'libertyvillage' then '리버티빌리지'
    else normalized
  end;
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

create function public.create_comment(p_post_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  comment_id uuid;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 1000 then raise exception 'INVALID_COMMENT'; end if;
  if not exists (
    select 1 from public.posts
    where id = p_post_id
      and status = 'published'
      and not private.is_blocked_between(current_user_id, author_id)
  ) then raise exception 'POST_NOT_FOUND'; end if;
  perform private.enforce_rate_limit('comment', 20, interval '10 minutes', interval '5 seconds');
  insert into public.comments (post_id, author_id, body)
  values (p_post_id, current_user_id, trim(p_body))
  returning id into comment_id;
  return comment_id;
end;
$$;

revoke insert on public.comments from authenticated;

create or replace function public.record_post_share(p_post_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  next_count integer;
  inserted_count integer;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  if not exists (
    select 1 from public.posts
    where id = p_post_id
      and status = 'published'
      and not private.is_blocked_between(current_user_id, author_id)
  ) then raise exception 'POST_NOT_FOUND'; end if;

  select share_count into next_count from public.posts where id = p_post_id;
  if exists (select 1 from public.post_shares where post_id = p_post_id and user_id = current_user_id) then
    return next_count;
  end if;

  perform private.enforce_rate_limit('share', 60, interval '1 hour', interval '1 second');
  insert into public.post_shares (post_id, user_id)
  values (p_post_id, current_user_id)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    update public.posts set share_count = share_count + 1
    where id = p_post_id
    returning share_count into next_count;
  else
    select share_count into next_count from public.posts where id = p_post_id;
  end if;
  return next_count;
end;
$$;

create or replace function public.start_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  low_user_id uuid;
  high_user_id uuid;
  conversation_id uuid;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  if current_user_id = other_user_id then raise exception 'INVALID_RECIPIENT'; end if;
  if not private.is_active_account(other_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  if private.is_blocked_between(current_user_id, other_user_id) then raise exception 'BLOCKED'; end if;

  low_user_id := least(current_user_id, other_user_id);
  high_user_id := greatest(current_user_id, other_user_id);
  select id into conversation_id from public.conversations
  where user_low_id = low_user_id and user_high_id = high_user_id;
  if conversation_id is not null then return conversation_id; end if;

  if (select count(*) from public.conversations where current_user_id in (user_low_id, user_high_id)) >= 30 then
    raise exception 'CONVERSATION_LIMIT_REACHED';
  end if;
  perform private.enforce_rate_limit('conversation', 5, interval '1 day', interval '30 seconds');

  insert into public.conversations (user_low_id, user_high_id)
  values (low_user_id, high_user_id)
  on conflict (user_low_id, user_high_id) do nothing;
  select id into conversation_id from public.conversations
  where user_low_id = low_user_id and user_high_id = high_user_id;
  return conversation_id;
end;
$$;

create or replace function public.send_message(conversation_id uuid, message_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  conversation public.conversations;
  other_user_id uuid;
  message_id uuid;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  if char_length(trim(coalesce(message_body, ''))) not between 1 and 2000 then raise exception 'INVALID_MESSAGE'; end if;
  select * into conversation from public.conversations
  where id = conversation_id and current_user_id in (user_low_id, user_high_id);
  if conversation is null then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  other_user_id := case when conversation.user_low_id = current_user_id then conversation.user_high_id else conversation.user_low_id end;
  if not private.is_active_account(other_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  if private.is_blocked_between(current_user_id, other_user_id) then raise exception 'BLOCKED'; end if;
  perform private.enforce_rate_limit('message', 30, interval '1 minute', interval '1 second');
  insert into public.messages (conversation_id, sender_id, body)
  values (conversation.id, current_user_id, trim(message_body))
  returning id into message_id;
  return message_id;
end;
$$;

create or replace function public.create_report(
  target_type text,
  target_id uuid,
  reason_code text,
  details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_user_id uuid;
  report_id uuid;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  if reason_code not in ('spam', 'harassment', 'hate', 'sexual', 'privacy', 'other') then raise exception 'INVALID_REASON'; end if;
  if char_length(coalesce(details, '')) > 1000 then raise exception 'INVALID_DETAILS'; end if;

  case target_type
    when 'user' then select id into target_user_id from public.profiles where id = target_id;
    when 'post' then
      select author_id into target_user_id from public.posts
      where id = target_id and (private.is_admin() or (status = 'published' and not private.is_blocked_between(current_user_id, author_id)));
    when 'comment' then
      select comment.author_id into target_user_id
      from public.comments as comment join public.posts as post on post.id = comment.post_id
      where comment.id = target_id and (private.is_admin() or (comment.deleted_at is null and post.status = 'published' and not private.is_blocked_between(current_user_id, comment.author_id)));
    when 'message' then
      select message.sender_id into target_user_id
      from public.messages as message join public.conversations as conversation on conversation.id = message.conversation_id
      where message.id = target_id and (private.is_admin() or current_user_id in (conversation.user_low_id, conversation.user_high_id));
    else raise exception 'INVALID_TARGET_TYPE';
  end case;
  if target_user_id is null then raise exception 'TARGET_NOT_FOUND'; end if;
  if target_user_id = current_user_id then raise exception 'CANNOT_REPORT_SELF'; end if;
  perform private.enforce_rate_limit('report', 20, interval '1 day', interval '5 seconds');
  insert into public.reports (reporter_id, reported_user_id, target_type, target_id, reason_code, details)
  values (current_user_id, target_user_id, target_type, target_id, reason_code, nullif(trim(details), ''))
  returning id into report_id;
  return report_id;
end;
$$;

create function public.get_trending_hashtags(
  p_city_id text,
  p_tag_id smallint default null,
  p_window_days integer default 7,
  p_limit integer default 10
)
returns table (hashtag text, author_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select canonical, count(distinct author_id)::integer
  from (
    select post.author_id, private.canonicalize_hashtag(raw_hashtag) as canonical
    from public.posts as post
    cross join lateral unnest(post.hashtags) as raw_hashtag
    where post.status = 'published'
      and post.city_id = p_city_id
      and (p_tag_id is null or post.tag_id = p_tag_id)
      and post.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_window_days, 7), 30)))
      and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id))
  ) tags
  where canonical is not null
  group by canonical
  order by count(distinct author_id) desc, max(canonical)
  limit greatest(1, least(coalesce(p_limit, 10), 20));
$$;

-- 콘텐츠가 바뀌면 이전 검토 결과를 폐기하고 다시 분석한다.
alter table public.safety_review_queue
  drop constraint safety_review_queue_status_check,
  add column content_hash text,
  add column risk_score numeric(5,4),
  add column risk_level text check (risk_level is null or risk_level in ('low', 'medium', 'high', 'critical')),
  add column risk_reasons jsonb not null default '[]'::jsonb,
  add column attempts smallint not null default 0 check (attempts between 0 and 10),
  add column last_error text check (char_length(last_error) <= 1000),
  add column next_attempt_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add constraint safety_review_queue_status_check check (status in ('pending', 'processing', 'reviewed', 'failed'));

drop trigger posts_safety_review on public.posts;
drop trigger comments_safety_review on public.comments;
drop trigger messages_safety_review on public.messages;
drop function private.enqueue_safety_review();

create function private.enqueue_safety_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  content text;
  next_hash text;
  kind text := case tg_table_name when 'posts' then 'post' when 'comments' then 'comment' else 'message' end;
begin
  content := case tg_table_name
    when 'posts' then concat_ws(E'\n', to_jsonb(new) ->> 'title', new.body, (to_jsonb(new) -> 'hashtags')::text)
    else new.body
  end;
  next_hash := encode(extensions.digest(convert_to(content, 'UTF8'), 'sha256'), 'hex');
  insert into public.safety_review_queue (target_type, target_id, content_hash)
  values (kind, new.id, next_hash)
  on conflict (target_type, target_id) do update
  set status = 'pending',
      content_hash = excluded.content_hash,
      risk_score = null,
      risk_level = null,
      risk_reasons = '[]'::jsonb,
      attempts = 0,
      last_error = null,
      next_attempt_at = null,
      reviewed_at = null,
      updated_at = now()
  where public.safety_review_queue.content_hash is distinct from excluded.content_hash;
  return new;
end;
$$;

create trigger posts_safety_review
after insert or update of title, body, hashtags on public.posts
for each row execute function private.enqueue_safety_review();
create trigger comments_safety_review
after insert or update of body on public.comments
for each row execute function private.enqueue_safety_review();
create trigger messages_safety_review
after insert or update of body on public.messages
for each row execute function private.enqueue_safety_review();

update public.safety_review_queue as queue
set content_hash = encode(extensions.digest(convert_to(case queue.target_type
  when 'post' then (select concat_ws(E'\n', title, body, array_to_string(hashtags, ' ')) from public.posts where id = queue.target_id)
  when 'comment' then (select body from public.comments where id = queue.target_id)
  else (select body from public.messages where id = queue.target_id)
end, 'UTF8'), 'sha256'), 'hex')
where content_hash is null;

create function public.claim_safety_reviews(p_limit integer default 20)
returns table (id bigint, target_type text, target_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  return query
  with candidates as (
    select queue.id from public.safety_review_queue as queue
    where queue.status in ('pending', 'failed')
      and coalesce(queue.next_attempt_at, now()) <= now()
      and queue.attempts < 5
    order by queue.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  )
  update public.safety_review_queue as queue
  set status = 'processing', attempts = attempts + 1, updated_at = now()
  from candidates
  where queue.id = candidates.id
  returning queue.id, queue.target_type, queue.target_id;
end;
$$;

create function public.complete_safety_review(
  p_queue_id bigint,
  p_risk_score numeric,
  p_risk_level text,
  p_risk_reasons jsonb,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_error is null and (p_risk_score not between 0 and 1 or p_risk_level not in ('low', 'medium', 'high', 'critical')) then
    raise exception 'INVALID_REVIEW_RESULT';
  end if;
  update public.safety_review_queue
  set status = case when p_error is null then 'reviewed' when attempts >= 5 then 'failed' else 'failed' end,
      risk_score = case when p_error is null then p_risk_score else null end,
      risk_level = case when p_error is null then p_risk_level else null end,
      risk_reasons = case when p_error is null then coalesce(p_risk_reasons, '[]'::jsonb) else '[]'::jsonb end,
      last_error = left(p_error, 1000),
      next_attempt_at = case when p_error is null or attempts >= 5 then null else now() + make_interval(mins => (2 ^ attempts)::integer) end,
      reviewed_at = case when p_error is null then now() else null end,
      updated_at = now()
  where id = p_queue_id and status = 'processing';
  if not found then raise exception 'REVIEW_NOT_CLAIMED'; end if;
end;
$$;

revoke execute on function private.is_active_account(uuid) from public, anon, authenticated;
revoke execute on function private.assert_active_account(uuid) from public, anon, authenticated;
revoke execute on function private.enforce_rate_limit(text, integer, interval, interval) from public, anon, authenticated;
revoke execute on function private.canonicalize_hashtag(text) from public, anon, authenticated;
grant execute on function private.is_active_account(uuid) to authenticated;
grant execute on function private.assert_active_account(uuid) to authenticated;

revoke execute on function public.create_comment(uuid, text) from public, anon, authenticated;
revoke execute on function public.record_post_share(uuid) from public, anon, authenticated;
revoke execute on function public.get_trending_hashtags(text, smallint, integer, integer) from public, anon, authenticated;
revoke execute on function public.claim_safety_reviews(integer) from public, anon, authenticated;
revoke execute on function public.complete_safety_review(bigint, numeric, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_comment(uuid, text) to authenticated;
grant execute on function public.record_post_share(uuid) to authenticated;
grant execute on function public.get_trending_hashtags(text, smallint, integer, integer) to anon, authenticated;
grant execute on function public.claim_safety_reviews(integer) to service_role;
grant execute on function public.complete_safety_review(bigint, numeric, text, jsonb, text) to service_role;
