-- 순위를 누적이 아니라 구간으로 계산한다.
--
-- 지금까지는 posts.view_count(평생 누적)에 시간 감쇠를 곱했다. 그러면 오래 전에 크게 터진 글이
-- 계속 위에 남고, 지금 막 반응이 오는 글이 밀린다. 바꾼 방식은 "최근 N시간 안에 생긴 조회·공감·
-- 저장·댓글"만 센다. 구간이 지나면 그 활동은 점수에서 저절로 빠지므로 누적은 의미를 잃고,
-- 매번 모든 글이 같은 출발선에서 다시 겨룬다.
--
-- 한 번 알린 글도 repeat_after_hours 가 지나면 후보로 돌아온다. 그래야 "일정 기간 후 초기화"가 된다.

alter table private.trending_config
  add column window_hours integer not null default 48,
  add column repeat_after_hours integer not null default 168;
alter table private.trending_config
  add constraint trending_config_window check (window_hours > 0 and repeat_after_hours >= 0);

-- 구간 안의 활동만 센다. 조회는 로그인(post_views)과 비로그인(post_view_pulse)을 따로 세어
-- 가중치를 달리 줄 수 있게 남긴다.
create or replace function private.trending_candidates(p_city_id text, p_limit integer default 5)
returns table(post_id uuid, city_id text, author_id uuid, title text, score numeric,
  authed_views bigint, anon_views bigint, like_count integer, comment_count integer, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with cfg as (select * from private.trending_config where id = true),
  span as (select now() - make_interval(hours => (select window_hours from cfg)) as since)
  select post.id, post.city_id, post.author_id, post.title,
    round((
      recent.authed * cfg.view_weight
      + recent.anon * cfg.anon_view_weight
      + recent.likes * cfg.like_weight
      + recent.comments * cfg.comment_weight
    )::numeric, 2) as score,
    recent.authed, recent.anon, recent.likes::integer, recent.comments::integer, post.created_at
  from cfg
  cross join span
  cross join public.posts post
  cross join lateral (
    select
      (select count(*) from public.post_views v
        where v.post_id = post.id and v.created_at > span.since) as authed,
      (select coalesce(sum(p.views), 0) from private.post_view_pulse p
        where p.post_id = post.id and p.bucket > span.since) as anon,
      (select count(*) from public.post_reactions r
        where r.post_id = post.id and r.kind = 'like' and r.created_at > span.since) as likes,
      (select count(*) from public.comments c
        where c.post_id = post.id and c.deleted_at is null and c.created_at > span.since) as comments
  ) recent
  where post.status = 'published'
    and (p_city_id is null or post.city_id = p_city_id)
    and private.is_active_account(post.author_id)
    -- 같은 글을 연달아 알리지 않되, 대기 시간이 지나면 다시 겨룬다.
    and not exists (
      select 1 from private.trending_sent s
      where s.post_id = post.id
        and s.sent_at > now() - make_interval(hours => cfg.repeat_after_hours))
    and not exists (
      select 1 from auth.users u where u.id = post.author_id
        and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb))
  order by score desc, post.created_at desc
  limit p_limit;
$$;
revoke all on function private.trending_candidates(text, integer) from public, anon, authenticated;

-- 도시 순회도 같은 구간을 본다. 오래된 글이라도 지금 활동이 있으면 그 도시를 돌아야 한다.
create or replace function private.send_trending_notifications()
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

  for city in select distinct city_id from public.posts where status = 'published' loop
    if (select count(*) from private.trending_sent s
        where s.city_id = city.city_id and s.sent_at > now() - interval '24 hours') >= cfg.max_per_city_per_day then
      continue;
    end if;

    select * into pick from private.trending_candidates(city.city_id, 1);
    if not found or pick.score < cfg.min_score then continue; end if;

    -- 대기 시간이 지나 다시 뽑힌 글은 보낸 기록을 새로 쓴다.
    insert into private.trending_sent(post_id, city_id, score) values (pick.post_id, pick.city_id, pick.score)
    on conflict (post_id) do update set city_id = excluded.city_id, score = excluded.score, sent_at = now();

    with recipients as (
      insert into public.notifications(user_id, kind, actor_id, target_type, target_id, body, route)
      -- 설정 행은 사용자가 알림 화면을 연 뒤에야 생긴다. 행이 없으면 기본값(켜짐)으로 본다.
      select recipient.id, 'trending_post', pick.author_id, 'post', pick.post_id,
        '지금 뜨는 글 · ' || left(pick.title, 80),
        '/post/' || pick.post_id::text
      from public.profiles recipient
      left join public.notification_preferences prefs on prefs.user_id = recipient.id
      where recipient.city_id = pick.city_id and recipient.account_status = 'active'
        and coalesce(prefs.trending, true) and recipient.id <> pick.author_id
        and not exists (
          select 1 from auth.users u where u.id = recipient.id
            and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb))
      on conflict do nothing
      returning 1
    )
    select count(*) into delivered from recipients;

    update private.trending_sent set recipients = delivered where post_id = pick.post_id;
    sent := sent + 1;
  end loop;

  -- 집계 구간보다 넉넉히 남겨 두고 지운다.
  delete from private.post_view_pulse
  where bucket < now() - make_interval(hours => greatest(cfg.window_hours * 2, 168));
  return sent;
end;
$$;
revoke all on function private.send_trending_notifications() from public, anon, authenticated;

-- 설정 화면에서 새 값도 조정한다. 반감기는 더 이상 점수에 쓰이지 않는다(구간이 그 역할을 한다).
create or replace function public.set_admin_trending_config(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID_CONFIG'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) key where key not in (
    'enabled','view_weight','anon_view_weight','like_weight','comment_weight','window_hours',
    'repeat_after_hours','min_score','max_age_hours','max_per_city_per_day','quiet_start_hour',
    'quiet_end_hour','timezone'))
  then raise exception 'INVALID_CONFIG'; end if;
  perform public.log_admin_access('dashboard', null, null);

  update private.trending_config cfg set
    enabled = coalesce((p_patch->>'enabled')::boolean, cfg.enabled),
    view_weight = coalesce((p_patch->>'view_weight')::numeric, cfg.view_weight),
    anon_view_weight = coalesce((p_patch->>'anon_view_weight')::numeric, cfg.anon_view_weight),
    like_weight = coalesce((p_patch->>'like_weight')::numeric, cfg.like_weight),
    comment_weight = coalesce((p_patch->>'comment_weight')::numeric, cfg.comment_weight),
    window_hours = coalesce((p_patch->>'window_hours')::integer, cfg.window_hours),
    repeat_after_hours = coalesce((p_patch->>'repeat_after_hours')::integer, cfg.repeat_after_hours),
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
revoke all on function public.set_admin_trending_config(jsonb) from public, anon, authenticated;
grant execute on function public.set_admin_trending_config(jsonb) to authenticated;
