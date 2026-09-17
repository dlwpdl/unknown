-- 어드민이 올린 조회수가 다시 점수에 반영되게 한다.
--
-- 0056 에서 점수를 "구간 안에 실제로 생긴 조회"로 바꾸면서, posts.view_count 는 점수와
-- 무관해졌다. 그래서 어드민이 조회수를 8000 으로 올려도 점수는 그대로였고 알림도 나가지
-- 않았다. 0054 에서 약속한 "바뀐 조회수의 글도 알림 후보가 된다"가 깨진 것이다.
--
-- 고치는 방법: 어드민이 조회수를 올리면 그 증가분을 "지금 생긴 조회"로 기록한다.
-- 편집자가 끌어올린다는 뜻이 그것이고, 구간이 지나면 다른 조회와 똑같이 빠진다.

create or replace function public.set_admin_post_fields(p_post_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  before_views integer;
  updated public.posts;
  counter text;
  added integer;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID_POST_PATCH'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) key
             where key not in ('view_count','like_count','save_count','sort_at','hashtags','status'))
  then raise exception 'INVALID_POST_PATCH'; end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('published','removed') then
    raise exception 'INVALID_POST_STATUS';
  end if;
  foreach counter in array array['view_count','like_count','save_count'] loop
    if p_patch ? counter and ((p_patch->>counter)::bigint < 0 or (p_patch->>counter)::bigint > 100000000) then
      raise exception 'INVALID_POST_COUNTER';
    end if;
  end loop;
  if p_patch ? 'hashtags' and (jsonb_typeof(p_patch->'hashtags') <> 'array' or jsonb_array_length(p_patch->'hashtags') > 20) then
    raise exception 'INVALID_POST_HASHTAGS';
  end if;
  perform public.log_admin_access('posts', null, null);

  select view_count into before_views from public.posts where id = p_post_id;

  update public.posts p set
    view_count = coalesce((p_patch->>'view_count')::integer, p.view_count),
    like_count = coalesce((p_patch->>'like_count')::integer, p.like_count),
    save_count = coalesce((p_patch->>'save_count')::integer, p.save_count),
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

  -- 늘어난 만큼을 지금 시각의 조회로 남긴다. 줄인 경우는 되돌리지 않는다(본 것을 안 본 것으로 만들 수 없다).
  added := greatest(coalesce(updated.view_count, 0) - coalesce(before_views, 0), 0);
  if added > 0 then
    insert into private.post_view_pulse as pulse (post_id, bucket, views)
    values (p_post_id, date_bin(interval '10 minutes', now(), '2000-01-01'::timestamptz), added)
    on conflict on constraint post_view_pulse_pkey do update set views = pulse.views + added;
  end if;

  if p_patch ?| array['view_count','like_count','save_count','sort_at'] then
    delete from private.trending_sent where post_id = p_post_id;
  end if;

  return jsonb_build_object('id', updated.id, 'status', updated.status, 'viewCount', updated.view_count,
    'likeCount', updated.like_count, 'saveCount', updated.save_count,
    'sortAt', updated.sort_at, 'hashtags', to_jsonb(updated.hashtags), 'deletedAt', updated.deleted_at);
end;
$$;
revoke all on function public.set_admin_post_fields(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_admin_post_fields(uuid, jsonb) to authenticated;

-- 공감·저장도 같은 이유로 점수에 들어가야 한다. 지금은 post_reactions 의 행만 세므로
-- 어드민이 올린 숫자가 반영되지 않는다. 구간 안 반응 수와 어드민이 적어둔 수 중 큰 쪽을 쓴다.
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
