-- 요즘 뜨는 해시태그·모임 알림을 추가한다.
-- 모임은 posts 가 아니라 meetup_requests.post_id 로 글에 묶여 있어서,
-- 기존 반응 점수(조회·공감·댓글)에 신청 수를 더해 순위를 만든다.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'comment','reply','post_like','comment_like','message',
  'meetup_request','meetup_approved','meetup_rejected',
  'interest_post','nearby_meetup','moderation_warning','moderation_blocked',
  'safety_alert','trending_post','weekly_ranking','trending_hashtag','trending_meetup',
  'admin_security','admin_multiacct','admin_error_spike'
));
alter table public.notifications drop constraint notifications_target_type_check;
alter table public.notifications add constraint notifications_target_type_check check (target_type in (
  'post','comment','message','meetup_request','user','listing_review','chilling_profile','chilling_application',
  'ip','client_error','tag'
));

create or replace function private.notification_category(p_kind text, p_target_type text)
returns text language sql immutable set search_path='' as $$
  select case p_kind
    when 'post_like' then 'post_likes' when 'comment_like' then 'comment_likes'
    when 'comment' then 'replies' when 'reply' then 'replies'
    when 'message' then case when p_target_type = 'user' then 'direct_requests' else 'messages' end
    when 'meetup_request' then 'meetups' when 'meetup_approved' then 'meetups' when 'meetup_rejected' then 'meetups'
    when 'interest_post' then 'interests' when 'nearby_meetup' then 'nearby'
    when 'trending_post' then 'trending' when 'weekly_ranking' then 'weekly_ranking'
    when 'trending_hashtag' then 'trending' when 'trending_meetup' then 'meetups'
    else 'system' end;
$$;

-- 같은 도시에 같은 주제를 반복 발송하지 않기 위한 기록.
create table if not exists private.trending_topic_sent (
  city_id text not null,
  kind text not null,
  topic_key text not null,
  sent_at timestamptz not null default now(),
  recipients integer not null default 0,
  primary key (city_id, kind, topic_key)
);
alter table private.trending_topic_sent enable row level security;
revoke all on private.trending_topic_sent from public,anon,authenticated,service_role;

create or replace function public.send_trending_topic_notifications()
returns integer language plpgsql security definer set search_path='' as $$
declare
  cfg private.trending_config;
  city record;
  hashtag record;
  meetup record;
  delivered integer;
  sent integer := 0;
begin
  select * into cfg from private.trending_config;
  if not cfg.enabled or private.trending_quiet_now() then return 0; end if;

  for city in select distinct city_id from public.posts where status = 'published' loop
    -- 1) 요즘 뜨는 해시태그 · 같은 태그는 7일 뒤에 다시 알린다.
    select th.hashtag into hashtag from public.get_trending_hashtags(city.city_id, null, 7, 1) th limit 1;
    if hashtag.hashtag is not null and not exists (
      select 1 from private.trending_topic_sent s where s.city_id = city.city_id and s.kind = 'trending_hashtag'
        and s.topic_key = hashtag.hashtag and s.sent_at > now() - interval '7 days') then
      insert into private.trending_topic_sent(city_id, kind, topic_key) values (city.city_id, 'trending_hashtag', hashtag.hashtag)
        on conflict (city_id, kind, topic_key) do update set sent_at = now();
      with recipients as (
        insert into public.notifications(user_id, kind, actor_id, target_type, target_id, body, route)
        select r.id, 'trending_hashtag', null, 'tag', null,
          '요즘 뜨는 해시태그 · #' || regexp_replace(hashtag.hashtag, '^#', ''),
          '/notifications'
        from public.profiles r
        left join public.notification_preferences prefs on prefs.user_id = r.id
        where r.city_id = city.city_id and r.account_status = 'active' and coalesce(prefs.trending, true)
          and not exists (select 1 from auth.users u where u.id = r.id
            and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb))
        returning 1)
      select count(*) into delivered from recipients;
      update private.trending_topic_sent set recipients = delivered
        where city_id = city.city_id and kind = 'trending_hashtag' and topic_key = hashtag.hashtag;
      sent := sent + 1;
    end if;

    -- 2) 요즘 뜨는 모임 · 반응 점수 + 신청 수(48시간) 로 고르고, 같은 모임은 3일 쉰다.
    select c.post_id, c.title, c.score + 4 * j.joins as total
      into meetup
      from private.trending_candidates(city.city_id, 50) c
      join lateral (select count(*) as joins from public.meetup_requests r
        where r.post_id = c.post_id and r.created_at > now() - interval '48 hours') j on true
      where j.joins > 0
      order by total desc, c.created_at desc limit 1;

    if meetup.post_id is not null and not exists (
      select 1 from private.trending_topic_sent s where s.city_id = city.city_id and s.kind = 'trending_meetup'
        and s.topic_key = meetup.post_id::text and s.sent_at > now() - interval '3 days') then
      insert into private.trending_topic_sent(city_id, kind, topic_key) values (city.city_id, 'trending_meetup', meetup.post_id::text)
        on conflict (city_id, kind, topic_key) do update set sent_at = now();
      with recipients as (
        insert into public.notifications(user_id, kind, actor_id, target_type, target_id, body, route)
        select r.id, 'trending_meetup', null, 'post', meetup.post_id,
          '요즘 뜨는 모임 · ' || left(coalesce(meetup.title, ''), 80),
          '/post/' || meetup.post_id::text
        from public.profiles r
        left join public.notification_preferences prefs on prefs.user_id = r.id
        where r.city_id = city.city_id and r.account_status = 'active' and coalesce(prefs.meetups, true)
          and not exists (select 1 from auth.users u where u.id = r.id
            and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb))
        returning 1)
      select count(*) into delivered from recipients;
      update private.trending_topic_sent set recipients = delivered
        where city_id = city.city_id and kind = 'trending_meetup' and topic_key = meetup.post_id::text;
      sent := sent + 1;
    end if;
  end loop;

  return sent;
end;
$$;
revoke all on function public.send_trending_topic_notifications() from public,anon,authenticated;
grant execute on function public.send_trending_topic_notifications() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'gling-trending-topics';
select cron.schedule('gling-trending-topics', '*/30 * * * *', $job$ select public.send_trending_topic_notifications(); $job$);

notify pgrst, 'reload schema';
