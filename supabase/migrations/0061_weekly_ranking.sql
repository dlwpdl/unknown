-- 주간 인기 글 순위.
--
-- 실시간으로 계산하지 않고 매주 한 번 찍어서 고정한다. 계속 바뀌는 순위는 "이번 주 1위"라는
-- 말이 성립하지 않아 재미도 이야깃거리도 안 된다. 얼어붙은 한 주가 있어야 다음 주와 비교된다.
--
-- 집계 구간은 7일 고정이다. 알림용 구간(trending_config.window_hours)과는 목적이 달라
-- 같은 값을 공유하지 않는다.

create table public.weekly_rankings (
  id bigint generated always as identity primary key,
  city_id text not null,
  week_start date not null,
  rank smallint not null check (rank between 1 and 10),
  post_id uuid not null references public.posts(id) on delete cascade,
  score numeric not null,
  views integer not null default 0,
  likes integer not null default 0,
  comments integer not null default 0,
  created_at timestamptz not null default now(),
  unique (city_id, week_start, rank),
  unique (city_id, week_start, post_id)
);
create index weekly_rankings_lookup_idx on public.weekly_rankings(city_id, week_start desc, rank);

alter table public.weekly_rankings enable row level security;
-- 순위는 공개다. 내려간 글은 조회 함수에서 걸러낸다.
create policy "anyone reads rankings" on public.weekly_rankings for select using (true);
revoke insert, update, delete on public.weekly_rankings from anon, authenticated;
grant select on public.weekly_rankings to anon, authenticated;

-- 이번 주 순위를 찍는다. 이미 찍었으면 아무것도 하지 않는다.
create function private.publish_weekly_ranking()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  week date := (date_trunc('week', now() at time zone 'America/Toronto'))::date;
  since timestamptz := now() - interval '7 days';
  city record;
  top record;
  published integer := 0;
begin
  for city in select distinct city_id from public.posts where status = 'published' loop
    if exists (select 1 from public.weekly_rankings r where r.city_id = city.city_id and r.week_start = week) then
      continue;
    end if;

    insert into public.weekly_rankings (city_id, week_start, rank, post_id, score, views, likes, comments)
    select city.city_id, week, row_number() over (order by ranked.score desc, ranked.created_at desc), ranked.id,
      ranked.score, ranked.views, ranked.likes, ranked.comments
    from (
      select post.id, post.created_at,
        (recent.views + recent.likes * 5 + recent.comments * 8)::numeric as score,
        recent.views, recent.likes, recent.comments
      from public.posts post
      cross join lateral (
        select
          ((select count(*) from public.post_views v where v.post_id = post.id and v.created_at > since)
           + (select coalesce(sum(p.views), 0) from private.post_view_pulse p where p.post_id = post.id and p.bucket > since))::integer as views,
          (select count(*) from public.post_reactions r where r.post_id = post.id and r.kind = 'like' and r.created_at > since)::integer as likes,
          (select count(*) from public.comments c where c.post_id = post.id and c.deleted_at is null and c.created_at > since)::integer as comments
      ) recent
      where post.city_id = city.city_id
        and post.status = 'published'
        and private.is_active_account(post.author_id)
        and not exists (
          select 1 from auth.users u where u.id = post.author_id
            and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb))
      order by score desc, post.created_at desc
      limit 10
    ) ranked
    where ranked.score > 0;  -- 아무 반응 없는 주에는 순위를 만들지 않는다

    if not found then continue; end if;
    published := published + 1;

    -- 알림은 "지금 뜨는 글"과 같은 분류를 쓴다. 그걸 끈 사람에게는 이것도 가지 않는다.
    insert into public.notifications (user_id, kind, actor_id, target_type, target_id, body, route)
    select recipient.id, 'trending_post', null, 'post', first.post_id,
      '이번 주 인기 글이 나왔어요 · 1위 ' || left(first.title, 60),
      '/ranking?city=' || city.city_id
    from public.weekly_rankings r
    join lateral (select r.post_id, p.title from public.posts p where p.id = r.post_id) first on true
    join public.profiles recipient on recipient.city_id = city.city_id and recipient.account_status = 'active'
    left join public.notification_preferences prefs on prefs.user_id = recipient.id
    where r.city_id = city.city_id and r.week_start = week and r.rank = 1
      and coalesce(prefs.trending, true)
      and not exists (
        select 1 from auth.users u where u.id = recipient.id
          and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb))
    on conflict do nothing;
  end loop;
  return published;
end;
$$;
revoke all on function private.publish_weekly_ranking() from public, anon, authenticated;

-- 피드 상단이 읽는다. 내려간 글은 빼고 최신 주차를 돌려준다.
create function public.get_weekly_ranking(p_city_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with latest as (
    select max(week_start) as week from public.weekly_rankings where city_id = p_city_id
  )
  select case when (select week from latest) is null then '{}'::jsonb else jsonb_build_object(
    'weekStart', (select week from latest),
    'cityId', p_city_id,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', r.rank, 'postId', r.post_id, 'title', p.title,
        'nickname', author.nickname, 'views', r.views, 'likes', r.likes, 'comments', r.comments)
        order by r.rank)
      from public.weekly_rankings r
      join public.posts p on p.id = r.post_id and p.status = 'published'
      join public.profiles author on author.id = p.author_id and author.account_status = 'active'
      where r.city_id = p_city_id and r.week_start = (select week from latest)
        and not private.is_blocked_between((select auth.uid()), p.author_id)), '[]'::jsonb))
  end;
$$;
revoke all on function public.get_weekly_ranking(text) from public, anon, authenticated;
grant execute on function public.get_weekly_ranking(text) to anon, authenticated;

-- 월요일 아침에 찍는다. 주말 활동까지 담기고, 한 주의 시작에 이야깃거리가 생긴다.
select cron.schedule('gling-weekly-ranking', '0 13 * * 1',
  'select private.publish_weekly_ranking()');
