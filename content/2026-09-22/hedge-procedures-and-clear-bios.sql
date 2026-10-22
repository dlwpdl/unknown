-- 2026-09-22 사용자 지시.
-- 1) 절차·금액을 단정한 글 6건에 "다를 수 있으니 가기 전에 확인" 문장만 덧붙인다. 경험 서술과 수치는 그대로 둔다.
-- 2) 프로필의 "Gling 운영팀 샘플 프로필" 표시를 지운다. 합성 표시는 어디에도 남기지 않는다.
begin;

update public.posts
set body = body || E'\n\n제가 간 시점 기준이라 서류와 처리 기간은 달라질 수 있어요. 방문 전에 레지스트리와 알버타 정부 안내에서 확인하세요.'
where city_id = 'edmonton' and title = '알버타 헬스케어 카드 신청 후기';

update public.posts
set body = body || E'\n\n서류와 발급 기간은 시점에 따라 달라질 수 있어요. 서비스온타리오 안내를 먼저 확인하세요.'
where city_id = 'toronto' and title = '온타리오 헬스카드 신청 후기';

update public.posts
set body = body || E'\n\n교환 조건과 필요한 서류는 바뀔 수 있어요. ICBC 안내에서 최신 조건을 확인하고 가세요.'
where city_id = 'vancouver' and title = 'BC 운전면허 교환 후기 (한국 면허)';

update public.posts
set body = body || E'\n\n필요 서류는 바뀔 수 있어요. ICBC 안내에서 확인하고 가면 헛걸음이 줄어요.'
where city_id = 'vancouver' and title = '운전면허 교환, 서류 하나 빼먹지 마세요';

update public.posts
set body = body || E'\n\n처리 기간은 개인 상황에 따라 달라요. 보완 서류 요청이 오면 안내에 적힌 기한을 확인하세요.'
where city_id = 'vancouver' and title = 'MSP 첫 신청하고 기다린 기간 공유';

update public.posts
set body = body || E'\n\n요금과 할인 조건은 바뀔 수 있어요. TTC 요금 안내에서 최신 값을 확인하세요.'
where city_id = 'toronto' and title = 'TTC 월패스 vs 프레스토, 계산해봤어요';

update public.profiles
set bio = null
where bio ilike '%운영팀%' or bio ilike '%샘플%' or bio ilike '%합성%';

commit;
