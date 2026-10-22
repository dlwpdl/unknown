-- 2026-09-22 사용자 지시: 글 하나마다 새 프로필을 만들면 프로필을 눌렀을 때 글이 1개뿐이라
-- 신뢰가 안 간다. 도시별로 유지할 프로필을 줄이고 글을 그 안에서 재배분한다.
--
-- 유지 인원: 밴쿠버 18, 토론토 16, 에드먼턴 10, 몬트리올 5 (프로필당 2~4개)
-- 유지 기준: 이미 쓴 글이 많은 프로필 우선, 동률이면 해시 순서. 해시 기반이라 재실행해도 같은 결과.
-- 프로필 도시는 절대 섞지 않는다. 몬트리올 글은 몬트리올 프로필로만 간다.
-- 프로필 가입 시각은 자기 글 중 가장 이른 글보다 앞으로 당긴다.
begin;

create temporary table gling_target_profiles on commit drop as
with seed_posts as (
  select p.id, p.city_id, p.author_id
  from public.posts p
  left join auth.users u on u.id = p.author_id
  where p.status = 'published' and (u.email like '%@seed.gling.invalid' or u.id is null)
),
counts as (
  select author_id, city_id, count(*) as own_posts from seed_posts group by 1, 2
),
caps(city_id, cap) as (
  values ('vancouver', 18), ('toronto', 16), ('edmonton', 10), ('montreal', 5)
),
ranked as (
  select counts.author_id, counts.city_id,
         row_number() over (
           partition by counts.city_id
           order by counts.own_posts desc, abs(hashtext(counts.author_id::text)::bigint)
         ) as rn
  from counts join caps on caps.city_id = counts.city_id
)
select ranked.author_id, ranked.city_id,
       row_number() over (partition by ranked.city_id order by ranked.rn) as slot,
       count(*) over (partition by ranked.city_id) as cap
from ranked
where ranked.rn <= (select cap from caps where caps.city_id = ranked.city_id);

create temporary table gling_post_slot on commit drop as
select p.id as post_id, p.city_id,
       row_number() over (partition by p.city_id order by p.created_at, p.id) as prn
from public.posts p
left join auth.users u on u.id = p.author_id
where p.status = 'published' and (u.email like '%@seed.gling.invalid' or u.id is null);

update public.posts p
set author_id = target.author_id
from gling_post_slot slot
join gling_target_profiles target
  on target.city_id = slot.city_id
 and target.slot = ((slot.prn - 1) % target.cap) + 1
where p.id = slot.post_id;

-- 남은 프로필(글이 0개가 된 쪽)은 그대로 둔다. 화면에서 이름이 노출되지 않는다.
update public.profiles profile
set created_at = (((date '2026-08-18' + (abs(hashtext(profile.id::text)::bigint) % 5)::int)::timestamp
                   + make_interval(mins => (abs(hashtext(profile.id::text || '-c')::bigint) % 600)::int + 420))
                  at time zone city.timezone)
from public.cities city
where city.id = profile.city_id
  and profile.id in (select author_id from gling_target_profiles);

commit;
