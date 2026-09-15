-- Publish only enqueues work. Existing posts are intentionally never backfilled.
create table private.discovery_post_queue (
  post_id uuid primary key references public.posts(id) on delete cascade,
  enqueued_at timestamptz not null default clock_timestamp(),
  after_user_id uuid not null default '00000000-0000-0000-0000-000000000000',
  updated_at timestamptz not null default clock_timestamp()
);
alter table private.discovery_post_queue enable row level security;
revoke all on private.discovery_post_queue from public, anon, authenticated;
create index discovery_post_queue_order_idx on private.discovery_post_queue(updated_at, post_id);

-- Preference changes cannot opt a member into a post already waiting in the queue.
alter table public.notification_preferences add column discovery_updated_at timestamptz not null default '-infinity';
create function private.touch_discovery_preferences()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.discovery_updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger notification_preferences_discovery_insert before insert on public.notification_preferences
  for each row execute function private.touch_discovery_preferences();
create trigger notification_preferences_discovery_update
  before update of interests, nearby, interest_tag_ids, interest_hashtags on public.notification_preferences
  for each row when ((old.interests,old.nearby,old.interest_tag_ids,old.interest_hashtags)
    is distinct from (new.interests,new.nearby,new.interest_tag_ids,new.interest_hashtags))
  execute function private.touch_discovery_preferences();
create index notification_preferences_discovery_idx on public.notification_preferences(user_id) where interests or nearby;
create unique index notifications_discovery_once_idx on public.notifications(user_id,target_id)
  where kind in ('interest_post','nearby_meetup');

create or replace function private.notify_discovery_post()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and private.is_active_account(new.author_id)
    and not exists (select 1 from auth.users u where u.id = new.author_id
      and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb)) then
    insert into private.discovery_post_queue(post_id) values(new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;

-- At most 500 candidate recipients and 10 posts per call. A row lock, notifications,
-- downstream push enqueue, and cursor commit together; rollback leaves the job retryable.
create function private.process_discovery_posts(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  job private.discovery_post_queue;
  post public.posts;
  recipients uuid[];
  remaining integer := greatest(1,least(coalesce(p_limit,500),500));
  processed integer := 0;
  candidate_count integer;
begin
  for job in select q.* from private.discovery_post_queue q
    order by q.updated_at,q.post_id limit 10 for update skip locked loop
    select p.* into post from public.posts p where p.id=job.post_id and p.status='published'
      and private.is_active_account(p.author_id)
      and not exists (select 1 from auth.users u where u.id=p.author_id
        and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access'='true'::jsonb));
    if not found then
      delete from private.discovery_post_queue where post_id=job.post_id;
      continue;
    end if;
    -- Limit before matching city/tags: even a post with zero matches has bounded work.
    -- ponytail: scan global opt-ins; partition by city if measured queue age requires it.
    select coalesce(array_agg(p.user_id order by p.user_id),'{}') into recipients from (
      select prefs.user_id from public.notification_preferences prefs
      where (prefs.interests or prefs.nearby) and prefs.user_id>job.after_user_id
      order by prefs.user_id limit remaining
    ) p;
    candidate_count:=cardinality(recipients);
    insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route)
    select prefs.user_id,case when match.interested then 'interest_post' else 'nearby_meetup' end,
      post.author_id,'post',post.id,
      case when match.interested then '관심 있는 주제의 새 글이 올라왔어요.' else '내 지역에 새로운 모임이 올라왔어요.' end,
      '/post/'||post.id::text
    from public.notification_preferences prefs
    join public.profiles recipient on recipient.id=prefs.user_id and recipient.city_id=post.city_id and recipient.account_status='active'
    cross join lateral (select prefs.interests and (post.tag_id=any(prefs.interest_tag_ids) or exists (
      select 1 from unnest(post.hashtags) hashtag where lower(private.canonicalize_hashtag(hashtag))=any(prefs.interest_hashtags)
    )) interested) match
    where prefs.user_id=any(recipients) and prefs.discovery_updated_at<=job.enqueued_at
      and (match.interested or (prefs.nearby and post.room_preview is not null and coalesce(post.room_preview->>'closed','false')<>'true'))
    on conflict do nothing;
    -- Existing notification guard rechecks active accounts, block pairs and visibility;
    -- the push trigger still queues delivery only for eligible registered sessions.
    if candidate_count<remaining then
      delete from private.discovery_post_queue where post_id=job.post_id;
    else
      update private.discovery_post_queue set after_user_id=recipients[candidate_count],updated_at=clock_timestamp() where post_id=job.post_id;
    end if;
    processed:=processed+candidate_count;
    remaining:=remaining-candidate_count;
    exit when remaining=0;
  end loop;
  return processed;
end;
$$;
revoke all on function private.touch_discovery_preferences(),private.process_discovery_posts(integer) from public,anon,authenticated;
select cron.schedule('gling-discovery-posts','10 seconds','select private.process_discovery_posts(500)');

-- Rare-category pages otherwise walk the city's full chronological feed.
create index posts_city_tag_feed_idx on public.posts(city_id,tag_id,created_at desc,id desc) where status='published';

-- Index the array as a search prefilter; retain element matching below so phrases
-- cannot accidentally match across two hashtags. No text-search token semantics change.
create function private.hashtag_search_text(text[]) returns text
language sql immutable parallel safe set search_path='' as $$ select array_to_string($1,E'\n') $$;
create index posts_hashtag_search_idx on public.posts using gin(private.hashtag_search_text(hashtags) extensions.gin_trgm_ops) where status='published';

create or replace function public.get_public_feed_page(
  p_city_id text,
  p_tag_id smallint default null,
  p_query text default null,
  p_before_created timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid, city_id text, title text, body text, hashtags text[], image_paths text[],
  room_preview jsonb, created_at timestamptz, like_count integer, view_count integer,
  comment_count integer, save_count integer, share_count integer, liked_by_me boolean,
  saved_by_me boolean, author_id uuid, author_nickname text, author_neighborhood text,
  author_verification_level smallint, tag_id smallint, tag_slug text, tag_label text, tag_kind text
)
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
begin
  if nullif(trim(coalesce(p_query,'')),'') is null then
    return query
  select
    post.id, post.city_id, post.title, post.body, post.hashtags, post.image_paths,
    post.room_preview, post.created_at, post.like_count, post.view_count,
    post.comment_count, post.save_count, post.share_count,
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'like'),
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'save'),
    profile.id, profile.nickname::text, profile.neighborhood, profile.verification_level,
    tag.id, tag.slug, tag.label, tag.kind
  from public.posts as post
  join public.profiles as profile on profile.id = post.author_id and profile.account_status = 'active'
  join public.tags as tag on tag.id = post.tag_id
  where post.status = 'published'
    and post.city_id = p_city_id
    and (p_tag_id is null or post.tag_id = p_tag_id)
    and (p_before_created is null or (post.created_at, post.id) < (p_before_created, p_before_id))
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id))
  order by post.created_at desc, post.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 50));
  else
    return query
  with eligible as not materialized (
    select post.* from public.posts post
    join public.profiles profile on profile.id=post.author_id and profile.account_status='active'
  where post.status = 'published'
    and post.city_id = p_city_id
    and (p_tag_id is null or post.tag_id = p_tag_id)
    and (p_before_created is null or (post.created_at, post.id) < (p_before_created, p_before_id))
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id))
  ), hits as (
    (select post.id from eligible post
      where (post.title || ' ' || post.body) ilike '%'||trim(p_query)||'%'
      order by post.created_at desc,post.id desc limit greatest(1,least(coalesce(p_limit,30),50)))
    union
    (select post.id from eligible post
      where post.author_id in (select matched.id from public.profiles matched
        where matched.nickname ilike '%'||trim(p_query)||'%' or coalesce(matched.neighborhood,'') ilike '%'||trim(p_query)||'%')
      order by post.created_at desc,post.id desc limit greatest(1,least(coalesce(p_limit,30),50)))
    union
    (select post.id from eligible post
      where private.hashtag_search_text(post.hashtags) ilike '%'||trim(p_query)||'%'
        and exists(select 1 from unnest(post.hashtags) hashtag where hashtag ilike '%'||trim(p_query)||'%')
      order by post.created_at desc,post.id desc limit greatest(1,least(coalesce(p_limit,30),50)))
  )
  select
    post.id, post.city_id, post.title, post.body, post.hashtags, post.image_paths,
    post.room_preview, post.created_at, post.like_count, post.view_count,
    post.comment_count, post.save_count, post.share_count,
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'like'),
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'save'),
    profile.id, profile.nickname::text, profile.neighborhood, profile.verification_level,
    tag.id, tag.slug, tag.label, tag.kind
  from public.posts as post
  join hits on hits.id=post.id
  join public.profiles as profile on profile.id = post.author_id and profile.account_status = 'active'
  join public.tags as tag on tag.id = post.tag_id
  where post.status = 'published'
    and post.city_id = p_city_id
    and (p_tag_id is null or post.tag_id = p_tag_id)
    and (p_before_created is null or (post.created_at, post.id) < (p_before_created, p_before_id))
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id))
  order by post.created_at desc, post.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 50));
  end if;
end;
$$;

-- Keep the existing JSON RPC shape; the queue cutoff is internal metadata.
create or replace function public.get_notification_preferences()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return coalesce((select to_jsonb(p)-'user_id'-'discovery_updated_at' from public.notification_preferences p where user_id=auth.uid()),
    '{"post_likes":true,"comment_likes":true,"replies":true,"direct_requests":true,"messages":true,"meetups":true,"interests":false,"nearby":false,"push_enabled":false,"interest_tag_ids":[],"interest_hashtags":[]}'::jsonb);
end;
$$;

-- Canonicalize each author/raw-tag pair once, rather than every occurrence.
create or replace function public.get_trending_hashtags(
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
  with raw_tags as (
    select distinct post.author_id, raw_hashtag
    from public.posts post cross join lateral unnest(post.hashtags) raw_hashtag
    where post.status = 'published'
      and post.city_id = p_city_id
      and (p_tag_id is null or post.tag_id = p_tag_id)
      and post.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_window_days, 7), 30)))
      and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id))
  ), tags as materialized (
    select author_id,private.canonicalize_hashtag(raw_hashtag) canonical from raw_tags
  )
  select canonical,count(distinct author_id)::integer from tags
  where canonical is not null
  group by canonical
  order by count(distinct author_id) desc,max(canonical)
  limit greatest(1,least(coalesce(p_limit,10),20));
$$;

-- Without expression statistics PostgreSQL estimates a common substring as rare,
-- chooses the trigram bitmap, and sorts all matching posts instead of a short feed scan.
create statistics posts_search_expression_stats on (title || ' ' || body) from public.posts;
analyze public.posts;
