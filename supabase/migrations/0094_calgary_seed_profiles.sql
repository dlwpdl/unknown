-- 2026-09-22: 캘거리 자동 등록이 도시별 5건을 돌리려면 프로필이 5개보다 많아야 한다.
-- 0093에서 만든 5개에 10개를 더해 15개로 둔다. 기존 시드 패턴 그대로.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, email, '{}'::jsonb, '{"seed":true}'::jsonb
from (values
    ('10000000-0000-0000-0000-000000000133'::uuid, 'u133@seed.gling.invalid'),
    ('10000000-0000-0000-0000-000000000134'::uuid, 'u134@seed.gling.invalid'),
    ('10000000-0000-0000-0000-000000000135'::uuid, 'u135@seed.gling.invalid'),
    ('10000000-0000-0000-0000-000000000136'::uuid, 'u136@seed.gling.invalid'),
    ('10000000-0000-0000-0000-000000000137'::uuid, 'u137@seed.gling.invalid'),
    ('10000000-0000-0000-0000-000000000138'::uuid, 'u138@seed.gling.invalid'),
    ('10000000-0000-0000-0000-000000000139'::uuid, 'u139@seed.gling.invalid'),
    ('10000000-0000-0000-0000-000000000140'::uuid, 'u140@seed.gling.invalid'),
    ('10000000-0000-0000-0000-000000000141'::uuid, 'u141@seed.gling.invalid'),
    ('10000000-0000-0000-0000-000000000142'::uuid, 'u142@seed.gling.invalid')
) as seed_users(id, email)
on conflict (id) do nothing;

insert into public.profiles (id, nickname, city_id, neighborhood, verification_level, consent_version,
  terms_accepted_at, privacy_accepted_at, ai_safety_consent_at, created_at)
select id, nickname::citext, 'calgary', neighborhood, 1, 'synthetic-seed', now(), now(), now(), created_at
from (values
    ('10000000-0000-0000-0000-000000000133'::uuid, '글렌모어공원', '커럽', '2026-09-19 09:20:00-06'::timestamptz),
    ('10000000-0000-0000-0000-000000000134'::uuid, '스탬피드준비', '다운타운', '2026-09-19 13:05:00-06'::timestamptz),
    ('10000000-0000-0000-0000-000000000135'::uuid, '피쉬크릭주말', '사우스이스트', '2026-09-19 16:40:00-06'::timestamptz),
    ('10000000-0000-0000-0000-000000000136'::uuid, '처치일요일', '미션', '2026-09-20 10:15:00-06'::timestamptz),
    ('10000000-0000-0000-0000-000000000137'::uuid, '메이랜드저녁', '커럽', '2026-09-20 12:50:00-06'::timestamptz),
    ('10000000-0000-0000-0000-000000000138'::uuid, '브라이들우드도서관', '노스웨스트', '2026-09-20 15:30:00-06'::timestamptz),
    ('10000000-0000-0000-0000-000000000139'::uuid, '셰퍼드장보기', '노스이스트', '2026-09-20 18:10:00-06'::timestamptz),
    ('10000000-0000-0000-0000-000000000140'::uuid, '어클랜드겨울', '사우스웨스트', '2026-09-21 08:35:00-06'::timestamptz),
    ('10000000-0000-0000-0000-000000000141'::uuid, '컨페더레이션공원', '노스이스트', '2026-09-21 11:25:00-06'::timestamptz),
    ('10000000-0000-0000-0000-000000000142'::uuid, '이글리지산책', '사우스웨스트', '2026-09-21 14:45:00-06'::timestamptz)
) as seed_profiles(id, nickname, neighborhood, created_at);
