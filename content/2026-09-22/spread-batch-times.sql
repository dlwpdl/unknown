-- 2026-09-22 사용자 요청: 9/21 일괄 등록한 40개 글의 등록 시각이 도시별로 전부 같아서
-- 사람이 몰아 쓴 것처럼 보였다. 시각만 흩뜨린다. 본문·작성자·조회수는 건드리지 않는다.
--
-- 대상 식별: auth.users.raw_user_meta_data->>'batch' = 'city-info-2026-09-21' (40개)
-- 시각: 9/19~9/21 각 도시 현지 시간 07:00~23:59 사이의 분 단위. 해시 기반이라 재실행해도 같은 값.
-- 프로필 가입 시각: 글보다 앞서야 하므로 9/17~9/18로 당긴다.
begin;

create temporary table gling_batch_fix on commit drop as
select p.id                            as post_id,
       p.author_id,
       c.timezone,
       (abs(hashtext(p.id::text)::bigint) % 3)::int             as day_offset,
       (abs(hashtext(p.id::text || '-t')::bigint) % 1020)::int  as minute_of_day
from public.posts p
join public.cities c on c.id = p.city_id
join auth.users u on u.id = p.author_id
where p.status = 'published'
  and u.raw_user_meta_data->>'batch' = 'city-info-2026-09-21';

-- 글 시각과 posted_on을 같은 현지 시각으로 맞춘다.
update public.posts p
set created_at = (((date '2026-09-19' + f.day_offset)::timestamp
                   + make_interval(mins => f.minute_of_day + 420)) at time zone f.timezone),
    posted_on  = date '2026-09-19' + f.day_offset
from gling_batch_fix f
where p.id = f.post_id;

-- 주간 랭킹이 참조하는 조회 pulse 버킷을 새 등록 시각 기준으로 다시 맞춘다.
update private.post_view_pulse pulse
set bucket = date_bin(interval '10 minutes', p.created_at, '2000-01-01'::timestamptz)
from public.posts p
where p.id = pulse.post_id
  and p.id in (select post_id from gling_batch_fix)
  and pulse.bucket <> date_bin(interval '10 minutes', p.created_at, '2000-01-01'::timestamptz);

-- 합성 프로필의 가입 시각이 자기 글보다 뒤에 있으면 계정보다 글이 먼저 생긴 셈이 된다. 앞으로 당긴다.
update public.profiles profile
set created_at = (((date '2026-09-17' + (abs(hashtext(profile.id::text)::bigint) % 2)::int)::timestamp
                   + make_interval(mins => (abs(hashtext(profile.id::text || '-p')::bigint) % 600)::int + 480))
                  at time zone city.timezone)
from public.cities city
where city.id = profile.city_id
  and profile.id in (select author_id from gling_batch_fix);

commit;
