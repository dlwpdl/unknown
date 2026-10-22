-- 2026-09-22 사용자 요청: 있는 글들의 등록 시각을 같은 날 안에서 흩뜨리고, 우리가 쓴 글의
-- 조회수를 1~300 사이 임의값으로 다시 준다. 본문·작성자·날짜는 건드리지 않는다.
--
-- 대상: 시드 계정(@seed.gling.invalid)이 쓴 글 + 인증 계정이 없는 예시 글.
-- 제외: 실제 계정(eun530k@gmail.com) 글 1건. 사용자가 쓴 글이므로 손대지 않는다.
-- 시각: 글의 현지 날짜는 유지하고 시각만 07:00~23:59 사이 분 단위로 다시 배정. 해시 기반이라 재실행해도 같은 값.
-- 조회수: 최근 7일 글은 1~300, 그보다 오래된 글은 20~300. 둘 다 요청 범위 안이다.
begin;

create temporary table gling_time_view_fix on commit drop as
select p.id,
       c.timezone,
       (p.created_at at time zone c.timezone)::date as local_day,
       (abs(hashtext(p.id::text || '-m')::bigint) % 1020)::int as minute_of_day,
       case when p.created_at > now() - interval '7 days'
            then (abs(hashtext(p.id::text || '-v')::bigint) % 300)::int + 1
            else (abs(hashtext(p.id::text || '-v')::bigint) % 281)::int + 20
       end as new_views,
       (select count(*) from public.post_views v where v.post_id = p.id) as recorded_views,
       p.created_at as old_created_at,
       p.view_count as old_view_count
from public.posts p
join public.cities c on c.id = p.city_id
left join auth.users u on u.id = p.author_id
where p.status = 'published'
  and (u.email like '%@seed.gling.invalid' or u.id is null);

update public.posts p
set created_at = ((f.local_day::timestamp + make_interval(mins => f.minute_of_day + 420)) at time zone f.timezone),
    view_count = f.new_views,
    posted_on  = f.local_day
from gling_time_view_fix f
where p.id = f.id;

-- 주간 랭킹이 읽는 조회 pulse를 새 시각·조회수에 맞춰 다시 만든다. 글당 1행만 남긴다.
delete from private.post_view_pulse pulse
using gling_time_view_fix f
where pulse.post_id = f.id;

insert into private.post_view_pulse (post_id, bucket, views)
select f.id,
       date_bin(interval '10 minutes', p.created_at, '2000-01-01'::timestamptz),
       greatest(0, p.view_count - f.recorded_views)
from gling_time_view_fix f
join public.posts p on p.id = f.id
where greatest(0, p.view_count - f.recorded_views) > 0;

commit;
