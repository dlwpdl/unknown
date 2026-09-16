-- 비로그인 조회 집계와 "지금 뜨는 글" 알림.
-- 알림은 기존 notification_preferences/카테고리 기계를 그대로 타고, 점수 값만 어드민이 조정한다.

-- 1. 비로그인 조회 ---------------------------------------------------------
-- 방문자 식별자(기기·IP)를 만들지 않는다. 글 단위 시간 버킷 상한만으로 조작 폭을 묶는다.
create table private.post_view_pulse (
  post_id uuid not null references public.posts(id) on delete cascade,
  bucket timestamptz not null,
  views integer not null default 0,
  primary key (post_id, bucket)
);
revoke all on private.post_view_pulse from public, anon, authenticated;

create or replace function public.record_post_view(post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  slot timestamptz := date_bin(interval '10 minutes', now(), '2000-01-01'::timestamptz);
  -- ponytail: 10분당 60회 상한. 익명 조회가 과열되면 이 값을 낮춘다.
  cap integer := 60;
begin
  if current_user_id is null then
    -- 로그인 없이 읽는 사람이 초기 트래픽의 대부분이라 이 조회도 센다.
    if not exists (select 1 from public.posts where id = post_id and status = 'published') then
      raise exception 'POST_NOT_FOUND';
    end if;
    -- 충돌 대상을 제약 이름으로 적어 파라미터 post_id 와의 이름 충돌을 피한다.
    insert into private.post_view_pulse as pulse (post_id, bucket, views)
    values (record_post_view.post_id, slot, 1)
    on conflict on constraint post_view_pulse_pkey do update set views = pulse.views + 1
      where pulse.views < cap;
    if found then
      update public.posts set view_count = view_count + 1 where id = record_post_view.post_id;
    end if;
    return;
  end if;

  if not exists (
    select 1 from public.posts
    where id = record_post_view.post_id
      and (
        private.is_admin()
        or author_id = current_user_id
        or (
          status = 'published'
          and not private.is_blocked_between(current_user_id, author_id)
        )
      )
  ) then
    raise exception 'POST_NOT_FOUND';
  end if;

  insert into public.post_views (post_id, user_id)
  values (record_post_view.post_id, current_user_id)
  on conflict do nothing;

  if found then
    update public.posts
    set view_count = view_count + 1
    where id = record_post_view.post_id;
  end if;
end;
$$;

grant execute on function public.record_post_view(uuid) to anon;

-- 2. 알림 종류 추가 --------------------------------------------------------
alter table public.notification_preferences add column trending boolean not null default true;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'comment','reply','post_like','comment_like','message','meetup_request','meetup_approved','meetup_rejected',
  'interest_post','nearby_meetup','moderation_warning','moderation_blocked','safety_alert','trending_post'));

alter table public.notifications drop constraint notifications_category_check;
alter table public.notifications add constraint notifications_category_check check (category in (
  'post_likes','comment_likes','replies','direct_requests','messages','meetups','interests','nearby','trending','system'));

create or replace function private.notification_category(p_kind text, p_target_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_kind
    when 'post_like' then 'post_likes' when 'comment_like' then 'comment_likes'
    when 'comment' then 'replies' when 'reply' then 'replies'
    when 'message' then case when p_target_type = 'user' then 'direct_requests' else 'messages' end
    when 'meetup_request' then 'meetups' when 'meetup_approved' then 'meetups' when 'meetup_rejected' then 'meetups'
    when 'interest_post' then 'interests' when 'nearby_meetup' then 'nearby'
    when 'trending_post' then 'trending' else 'system' end;
$$;

create or replace function private.can_receive_notification(p_user_id uuid, p_category text, p_actor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and (
    p_category = 'system' or (
      p_category in ('post_likes','comment_likes','replies','direct_requests','messages','meetups','interests','nearby','trending')
      and private.is_active_account(p_user_id)
      and (p_actor_id is null or (p_actor_id <> p_user_id and private.is_active_account(p_actor_id)
        and not private.is_blocked_between(p_user_id, p_actor_id)))
      and coalesce((select (to_jsonb(p)->>p_category)::boolean from public.notification_preferences p where user_id = p_user_id),
        p_category not in ('interests','nearby'))
    )
  );
$$;

-- 3. 점수 설정 (어드민 조정) ----------------------------------------------
create table private.trending_config (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  view_weight numeric not null default 1,        -- 로그인 조회
  anon_view_weight numeric not null default 0.3, -- 비로그인 조회는 낮게 시작한다
  like_weight numeric not null default 5,
  comment_weight numeric not null default 8,
  half_life_hours numeric not null default 12,   -- 점수가 절반이 되는 시간
  min_score numeric not null default 10,         -- 이 아래면 아무것도 보내지 않는다
  max_age_hours integer not null default 48,
  max_per_city_per_day integer not null default 3,
  quiet_start_hour integer not null default 22,
  quiet_end_hour integer not null default 8,
  timezone text not null default 'America/Toronto',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  constraint trending_config_hours check (
    quiet_start_hour between 0 and 23 and quiet_end_hour between 0 and 23
    and half_life_hours > 0 and max_age_hours > 0 and max_per_city_per_day >= 0)
);
revoke all on private.trending_config from public, anon, authenticated;
insert into private.trending_config (id) values (true);

-- 한 글은 평생 한 번만 알린다.
create table private.trending_sent (
  post_id uuid primary key references public.posts(id) on delete cascade,
  city_id text not null,
  score numeric not null,
  recipients integer not null default 0,
  sent_at timestamptz not null default now()
);
revoke all on private.trending_sent from public, anon, authenticated;
create index trending_sent_city_idx on private.trending_sent(city_id, sent_at desc);

-- 후보 목록. 어드민 미리보기와 실제 발송이 같은 식을 쓴다.
create function private.trending_candidates(p_city_id text, p_limit integer default 5)
returns table(post_id uuid, city_id text, author_id uuid, title text, score numeric,
  authed_views bigint, anon_views bigint, like_count integer, comment_count integer, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with cfg as (select * from private.trending_config where id = true)
  select post.id, post.city_id, post.author_id, post.title,
    round((((
      seen.authed * cfg.view_weight
      + greatest(post.view_count - seen.authed, 0) * cfg.anon_view_weight
      + post.like_count * cfg.like_weight
      + post.comment_count * cfg.comment_weight
    ) * exp(-ln(2) * extract(epoch from (now() - post.created_at)) / 3600 / cfg.half_life_hours))::numeric), 2) as score,
    seen.authed, greatest(post.view_count - seen.authed, 0), post.like_count, post.comment_count, post.created_at
  from cfg
  cross join public.posts post
  cross join lateral (select count(*) as authed from public.post_views v where v.post_id = post.id) seen
  where post.status = 'published'
    and (p_city_id is null or post.city_id = p_city_id)
    and post.created_at > now() - make_interval(hours => cfg.max_age_hours)
    and private.is_active_account(post.author_id)
    and not exists (select 1 from private.trending_sent s where s.post_id = post.id)
    and not exists (
      select 1 from auth.users u where u.id = post.author_id
        and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb))
  order by score desc, post.created_at desc
  limit p_limit;
$$;

create function private.trending_quiet_now()
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when cfg.quiet_start_hour = cfg.quiet_end_hour then false
    when cfg.quiet_start_hour < cfg.quiet_end_hour
      then hour >= cfg.quiet_start_hour and hour < cfg.quiet_end_hour
    else hour >= cfg.quiet_start_hour or hour < cfg.quiet_end_hour
  end
  from private.trending_config cfg
  cross join lateral (select extract(hour from (now() at time zone cfg.timezone))::integer as hour) local
  where cfg.id = true;
$$;

create function private.send_trending_notifications()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  cfg private.trending_config;
  city record;
  pick record;
  delivered integer;
  sent integer := 0;
begin
  select * into cfg from private.trending_config where id = true;
  if not found or not cfg.enabled or private.trending_quiet_now() then return 0; end if;

  for city in
    select distinct post.city_id from public.posts post
    where post.status = 'published' and post.created_at > now() - make_interval(hours => cfg.max_age_hours)
  loop
    if (select count(*) from private.trending_sent s
        where s.city_id = city.city_id and s.sent_at > now() - interval '24 hours') >= cfg.max_per_city_per_day then
      continue;
    end if;

    select * into pick from private.trending_candidates(city.city_id, 1);
    if not found or pick.score < cfg.min_score then continue; end if;

    insert into private.trending_sent(post_id, city_id, score) values (pick.post_id, pick.city_id, pick.score)
    on conflict do nothing;
    if not found then continue; end if;

    with recipients as (
      insert into public.notifications(user_id, kind, actor_id, target_type, target_id, body, route)
      select recipient.id, 'trending_post', pick.author_id, 'post', pick.post_id,
        '지금 뜨는 글 · ' || left(pick.title, 80),
        '/post/' || pick.post_id::text
      -- 설정 행은 사용자가 알림 화면을 연 뒤에야 생긴다. 행이 없으면 기본값(켜짐)으로 본다.
      from public.profiles recipient
      left join public.notification_preferences prefs on prefs.user_id = recipient.id
      where recipient.city_id = pick.city_id and recipient.account_status = 'active'
        and coalesce(prefs.trending, true) and recipient.id <> pick.author_id
      on conflict do nothing
      returning 1
    )
    select count(*) into delivered from recipients;

    update private.trending_sent set recipients = delivered where post_id = pick.post_id;
    sent := sent + 1;
  end loop;

  delete from private.post_view_pulse where bucket < now() - interval '7 days';
  return sent;
end;
$$;

select cron.schedule('gling-trending-notifications', '*/15 * * * *',
  'select private.send_trending_notifications()');

-- 4. 어드민 조회·조정 ------------------------------------------------------
create function public.get_admin_trending_config()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('dashboard', null, null);
  select jsonb_build_object(
    'config', to_jsonb(cfg) - 'id',
    'quietNow', private.trending_quiet_now(),
    'preview', coalesce((select jsonb_agg(to_jsonb(c)) from private.trending_candidates(null, 10) c), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object(
        'postId', s.post_id, 'cityId', s.city_id, 'score', s.score,
        'recipients', s.recipients, 'sentAt', s.sent_at, 'title', p.title)
      order by s.sent_at desc)
      from (select * from private.trending_sent order by sent_at desc limit 20) s
      join public.posts p on p.id = s.post_id), '[]'::jsonb)
  ) into result from private.trending_config cfg where cfg.id = true;
  return result;
end;
$$;

create function public.set_admin_trending_config(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID_CONFIG'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) key where key not in (
    'enabled','view_weight','anon_view_weight','like_weight','comment_weight','half_life_hours',
    'min_score','max_age_hours','max_per_city_per_day','quiet_start_hour','quiet_end_hour','timezone'))
  then raise exception 'INVALID_CONFIG'; end if;
  perform public.log_admin_access('dashboard', null, null);

  update private.trending_config cfg set
    enabled = coalesce((p_patch->>'enabled')::boolean, cfg.enabled),
    view_weight = coalesce((p_patch->>'view_weight')::numeric, cfg.view_weight),
    anon_view_weight = coalesce((p_patch->>'anon_view_weight')::numeric, cfg.anon_view_weight),
    like_weight = coalesce((p_patch->>'like_weight')::numeric, cfg.like_weight),
    comment_weight = coalesce((p_patch->>'comment_weight')::numeric, cfg.comment_weight),
    half_life_hours = coalesce((p_patch->>'half_life_hours')::numeric, cfg.half_life_hours),
    min_score = coalesce((p_patch->>'min_score')::numeric, cfg.min_score),
    max_age_hours = coalesce((p_patch->>'max_age_hours')::integer, cfg.max_age_hours),
    max_per_city_per_day = coalesce((p_patch->>'max_per_city_per_day')::integer, cfg.max_per_city_per_day),
    quiet_start_hour = coalesce((p_patch->>'quiet_start_hour')::integer, cfg.quiet_start_hour),
    quiet_end_hour = coalesce((p_patch->>'quiet_end_hour')::integer, cfg.quiet_end_hour),
    timezone = coalesce(p_patch->>'timezone', cfg.timezone),
    updated_at = now(), updated_by = auth.uid()
  where cfg.id = true;

  return public.get_admin_trending_config();
end;
$$;

revoke all on function public.get_admin_trending_config(), public.set_admin_trending_config(jsonb),
  private.trending_candidates(text, integer), private.trending_quiet_now(),
  private.send_trending_notifications() from public, anon, authenticated;
grant execute on function public.get_admin_trending_config(), public.set_admin_trending_config(jsonb) to authenticated;
