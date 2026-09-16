-- 어드민이 조회수나 노출 순서를 바꾼 글은 "지금 뜨는 글" 후보로 다시 들어온다.
-- 그러지 않으면 이미 한 번 나간 글이나 오래된 글은 값을 올려도 영원히 후보 밖에 머문다.

-- 후보의 기준 시각을 created_at 에서 sort_at 으로 옮긴다.
-- sort_at 은 이미 "피드가 이 글을 몇 시 글로 취급하는가"이고, 끌어올린 매물과
-- 어드민이 올린 글이 같은 규칙으로 신선해진다. 손대지 않은 글은 sort_at = created_at 이라 그대로다.
create or replace function private.trending_candidates(p_city_id text, p_limit integer default 5)
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
    ) * exp(-ln(2) * extract(epoch from (now() - least(post.sort_at, now()))) / 3600 / cfg.half_life_hours))::numeric), 2) as score,
    seen.authed, greatest(post.view_count - seen.authed, 0), post.like_count, post.comment_count, post.created_at
  from cfg
  cross join public.posts post
  cross join lateral (select count(*) as authed from public.post_views v where v.post_id = post.id) seen
  where post.status = 'published'
    and (p_city_id is null or post.city_id = p_city_id)
    and post.sort_at > now() - make_interval(hours => cfg.max_age_hours)
    and private.is_active_account(post.author_id)
    and not exists (select 1 from private.trending_sent s where s.post_id = post.id)
    and not exists (
      select 1 from auth.users u where u.id = post.author_id
        and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb))
  order by score desc, post.created_at desc
  limit p_limit;
$$;
revoke all on function private.trending_candidates(text, integer) from public, anon, authenticated;

-- 순위에 영향을 주는 값(조회수·노출 순서)을 바꾸면 이미 보낸 기록을 지워 다시 후보가 되게 한다.
-- 해시태그나 상태만 고치는 경우에는 건드리지 않는다.
create or replace function public.set_admin_post_fields(p_post_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  updated public.posts;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID_POST_PATCH'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) key
             where key not in ('view_count','sort_at','hashtags','status'))
  then raise exception 'INVALID_POST_PATCH'; end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('published','removed') then
    raise exception 'INVALID_POST_STATUS';
  end if;
  if p_patch ? 'view_count' and ((p_patch->>'view_count')::bigint < 0 or (p_patch->>'view_count')::bigint > 100000000) then
    raise exception 'INVALID_POST_VIEW_COUNT';
  end if;
  if p_patch ? 'hashtags' and (jsonb_typeof(p_patch->'hashtags') <> 'array' or jsonb_array_length(p_patch->'hashtags') > 20) then
    raise exception 'INVALID_POST_HASHTAGS';
  end if;
  perform public.log_admin_access('posts', null, null);

  update public.posts p set
    view_count = coalesce((p_patch->>'view_count')::integer, p.view_count),
    sort_at = coalesce((p_patch->>'sort_at')::timestamptz, p.sort_at),
    hashtags = coalesce((select array_agg(value) from jsonb_array_elements_text(p_patch->'hashtags')), p.hashtags),
    status = coalesce(p_patch->>'status', p.status),
    deleted_at = case
      when p_patch->>'status' = 'removed' then now()
      when p_patch->>'status' = 'published' then null
      else p.deleted_at end
  where p.id = p_post_id
  returning p.* into updated;
  if not found then raise exception 'POST_NOT_FOUND'; end if;

  if p_patch ? 'view_count' or p_patch ? 'sort_at' then
    delete from private.trending_sent where post_id = p_post_id;
  end if;

  return jsonb_build_object('id', updated.id, 'status', updated.status, 'viewCount', updated.view_count,
    'sortAt', updated.sort_at, 'hashtags', to_jsonb(updated.hashtags), 'deletedAt', updated.deleted_at);
end;
$$;
revoke all on function public.set_admin_post_fields(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_admin_post_fields(uuid, jsonb) to authenticated;

-- 후보를 sort_at 으로 고른 이상, 도시 목록도 같은 기준이어야 한다.
-- 그러지 않으면 어드민이 올린 오래된 글이 있는 도시가 아예 순회에서 빠진다.
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

  for city in
    select distinct post.city_id from public.posts post
    where post.status = 'published' and post.sort_at > now() - make_interval(hours => cfg.max_age_hours)
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

  delete from private.post_view_pulse where bucket < now() - interval '7 days';
  return sent;
end;
$$;
revoke all on function private.send_trending_notifications() from public, anon, authenticated;
