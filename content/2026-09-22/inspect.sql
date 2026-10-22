-- 읽기 전용. 시드 배치의 현재 시각 상태와 열린 도시 확인.
select c.id, c.name, c.is_open
from public.cities c
order by c.is_open desc, c.id;

select p.city_id,
       count(*)                                    as posts,
       count(distinct p.author_id)                 as authors,
       min(p.created_at)                           as first_created,
       max(p.created_at)                           as last_created,
       count(distinct p.created_at)                as distinct_stamps,
       sum(p.view_count)                           as views
from public.posts p
join auth.users u on u.id = p.author_id
where p.status = 'published'
  and u.raw_user_meta_data->>'batch' = 'city-info-2026-09-21'
group by p.city_id
order by p.city_id;

select p.city_id,
       p.posted_on,
       to_char(p.created_at at time zone c.timezone, 'YYYY-MM-DD HH24:MI') as local_time,
       count(*) as posts
from public.posts p
join public.cities c on c.id = p.city_id
join auth.users u on u.id = p.author_id
where p.status = 'published'
  and u.raw_user_meta_data->>'batch' = 'city-info-2026-09-21'
group by p.city_id, p.posted_on, local_time
order by p.city_id, local_time;

select count(*) as seeded_view_rows
from public.post_views v
join public.posts p on p.id = v.post_id
join auth.users u on u.id = p.author_id
where u.raw_user_meta_data->>'batch' = 'city-info-2026-09-21';
