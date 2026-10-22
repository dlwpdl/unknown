-- Owner request: synthetic community posts participate in weekly rankings.
-- Ranking stays a seven-day activity snapshot; store the seed counter as initial activity.
do $$
declare definition text := pg_get_functiondef('private.publish_weekly_ranking()'::regprocedure);
  old text := $anchor$where u.id = post.author_id
            and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb)$anchor$;
begin
  if position(old in definition)=0 then raise exception 'Missing weekly author filter anchor'; end if;
  definition := replace(definition,old,$anchor$where u.id = post.author_id
            and u.raw_app_meta_data->'review_access' = 'true'::jsonb$anchor$);
  definition := replace(definition,'ranked.created_at desc','ranked.created_at desc, ranked.id');
  execute replace(definition,'post.created_at desc','post.created_at desc, post.id');
end $$;

-- Fill only activity missing from this batch. Re-running cannot double its view counts.
insert into private.post_view_pulse as pulse(post_id,bucket,views)
select p.id,date_bin(interval '10 minutes',p.created_at,'2000-01-01'::timestamptz),missing.views
from public.posts p join auth.users u on u.id=p.author_id
cross join lateral (select greatest(0,p.view_count
  - (select count(*) from public.post_views v where v.post_id=p.id)
  - (select coalesce(sum(v.views),0) from private.post_view_pulse v where v.post_id=p.id))::integer as views) missing
where u.raw_user_meta_data->>'batch'='city-info-2026-09-21' and missing.views>0
on conflict on constraint post_view_pulse_pkey do update set views=pulse.views+excluded.views;

-- Replace only these cities' current snapshot. Older weeks and notification history stay intact.
-- Use the same score/query as publish_weekly_ranking, without re-sending weekly notifications.
do $$
declare
  week date := date_trunc('week',now() at time zone 'America/Toronto')::date;
  since timestamptz := now()-interval '7 days';
  city record;
begin
  for city in select id as city_id from public.cities where is_open
    and id in ('vancouver','toronto','montreal','edmonton') loop
    delete from public.weekly_rankings r where r.city_id=city.city_id and r.week_start=week;
    insert into public.weekly_rankings (city_id, week_start, rank, post_id, score, views, likes, comments)
    select city.city_id, week, row_number() over (order by ranked.score desc, ranked.created_at desc, ranked.id), ranked.id,
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
            and u.raw_app_meta_data->'review_access' = 'true'::jsonb)
      order by score desc, post.created_at desc, post.id
      limit 10
    ) ranked
    where ranked.score > 0;  -- 아무 반응 없는 주에는 순위를 만들지 않는다

  end loop;
end $$;
