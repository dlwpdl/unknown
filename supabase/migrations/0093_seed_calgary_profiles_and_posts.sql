-- 2026-09-22 사용자 요청: 캘거리를 열고(0092) 그 도시에 글 5건을 넣는다.
-- 캘거리는 프로필이 0개라 시드 프로필 5개를 함께 만든다. 기존 시드 계정 패턴을 따른다
-- (*@seed.gling.invalid, 비밀번호 없음, consent_version 'synthetic-seed').
-- 프로필 가입 시각은 글보다 앞서야 하므로 2026-09-18~19로 둔다.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, email, '{}'::jsonb, '{"seed":true}'::jsonb
from (values
    ('10000000-0000-0000-0000-000000000128'::uuid, 'u128@seed.gling.invalid'),
    ('10000000-0000-0000-0000-000000000129'::uuid, 'u129@seed.gling.invalid'),
    ('10000000-0000-0000-0000-000000000130'::uuid, 'u130@seed.gling.invalid'),
    ('10000000-0000-0000-0000-000000000131'::uuid, 'u131@seed.gling.invalid'),
    ('10000000-0000-0000-0000-000000000132'::uuid, 'u132@seed.gling.invalid')
) as seed_users(id, email)
on conflict (id) do nothing;

insert into public.profiles (id, nickname, city_id, neighborhood, verification_level, consent_version,
  terms_accepted_at, privacy_accepted_at, ai_safety_consent_at, created_at)
select id, nickname::citext, 'calgary', neighborhood, 1, 'synthetic-seed', now(), now(), now(), created_at
from (values
    ('10000000-0000-0000-0000-000000000128'::uuid, '보우강변산책', '다운타운', '2026-09-18 09:12:00-06'::timestamptz),
    ('10000000-0000-0000-0000-000000000129'::uuid, '17에비뉴커피', '벨트라인', '2026-09-18 14:40:00-06'::timestamptz),
    ('10000000-0000-0000-0000-000000000130'::uuid, 'C트레인통근', '선알타', '2026-09-19 08:05:00-06'::timestamptz),
    ('10000000-0000-0000-0000-000000000131'::uuid, '노스힐장보기', '노스힐', '2026-09-19 12:30:00-06'::timestamptz),
    ('10000000-0000-0000-0000-000000000132'::uuid, '프린스아일랜드', '이스트빌리지', '2026-09-19 17:55:00-06'::timestamptz)
) as seed_profiles(id, nickname, neighborhood, created_at);

insert into public.posts (author_id, city_id, tag_id, title, body, status, view_count, created_at)
select seed.author_id, 'calgary', tag.id, seed.title, seed.body, 'published', seed.view_count, seed.created_at
from (values
  ('10000000-0000-0000-0000-000000000128'::uuid, 'life',
   '캘거리 311은 앱보다 전화가 빠를 때도 있음',
   E'캘거리도 311로 시에 신고하고 물어보는 게 됨. 길, 쓰레기, 나무, 소음 같은 게 다 접수됨.\n앱이나 전화로 되는데 눈 온 날처럼 급할 때는 전화가 빨리 연결될 때도 있음.\n접수되는 항목과 방법은 바뀔 수 있으니 시 안내에서 확인해라.\n311 써서 해결된 일 있음?\n\n출처: https://www.calgary.ca/311.html',
   64, '2026-09-22 08:12:00-06'::timestamptz),
  ('10000000-0000-0000-0000-000000000131'::uuid, 'life',
   '캘거리 수거는 일반, 재활용, 음식물이 다 따로임',
   E'캘거리 수거는 일반쓰레기, 재활용, 음식물이 다 따로임. 집집마다 수거일이 달라서 주소 넣고 일정 확인하는 게 제일 빠름.\n카트를 언제 내놓는지도 정해져 있어서 그 시간을 놓치면 다음 주까지 기다려야 함.\n품목 기준과 수거일은 바뀔 수 있으니 시 안내에서 확인해라.\n수거일 헷갈려서 놓친 적 있음?\n\n출처: https://www.calgary.ca/waste/residential/garbage-schedule.html',
   41, '2026-09-22 11:40:00-06'::timestamptz),
  ('10000000-0000-0000-0000-000000000130'::uuid, 'life',
   '스노우루트 주차 금지 걸리면 차 끌려감',
   E'캘거리는 눈 많이 올 때 스노우루트 주차 금지가 걸림. 표지가 있는 길에 세워두면 안 되고 안 옮기면 견인됨.\n자기 동네 어느 길이 스노우루트인지 미리 봐두면 겨울에 덜 놀람. 지도에서 확인 가능함.\n금지 발령 기준과 구간은 매년 조정될 수 있으니 시 안내에서 확인해라.\n겨울에 차 옮긴 적 있음?\n\n출처: https://www.calgary.ca/roads/conditions/snow-route-parking-bans.html',
   88, '2026-09-22 14:05:00-06'::timestamptz),
  ('10000000-0000-0000-0000-000000000130'::uuid, 'transport',
   '캘거리 교통 요금은 My Fare로도 결제됨',
   E'캘거리 대중교통은 한 번, 하루, 월간처럼 요금 종류가 나뉘어 있음. 교통카드도 되고 앱 결제도 됨.\n요금이 오르기도 하니 타기 전에 안내에서 최신 값 확인해라. CTrain은 승강장에서 표 확인하는 경우도 있음.\n너는 카드 삼, 앱 삼?\n\n출처: https://www.calgarytransit.com/fares---passes.html',
   27, '2026-09-22 17:22:00-06'::timestamptz),
  ('10000000-0000-0000-0000-000000000132'::uuid, 'education',
   '캘거리 도서관 카드는 온라인으로도 만들 수 있음',
   E'캘거리 시립도서관 카드는 무료임. 온라인으로 만들거나 가까운 지점에서 만들 수 있음.\n책만 아니라 전자책이나 프로그램도 같이 쓰게 되니까 정착 초반에 만들어두면 편함.\n필요한 서류와 카드 종류는 바뀔 수 있으니 도서관 안내에서 확인해라.\n도서관에서 제일 자주 빌리는 거 뭐임?\n\n출처: https://www.calgarylibrary.ca/your-library/join',
   53, '2026-09-22 20:31:00-06'::timestamptz)
) as seed(author_id, tag_slug, title, body, view_count, created_at)
join public.tags tag on tag.slug = seed.tag_slug;

insert into private.post_view_pulse (post_id, bucket, views)
select post.id, date_bin(interval '10 minutes', post.created_at, '2000-01-01'::timestamptz), post.view_count
from public.posts post
join public.profiles author on author.id = post.author_id
where post.city_id = 'calgary' and author.consent_version = 'synthetic-seed';
