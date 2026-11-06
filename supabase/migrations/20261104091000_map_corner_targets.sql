-- 지도 탭 개편 (owner 2026-11-04 답 6개): 예약하기, 지금 영업 중, 가격, 작은 분류, 목록 시트, 이 지역에서 다시 찾기, 영업시간 펼치기. Additive analytics targets only.
insert into private.behavior_targets(id) values
('place.reserve.link'),('place.reserve.phone'),('place.reserve.message'),
('discovery.open-now'),('discovery.unknown-hours'),('discovery.price'),('discovery.subcategory'),
('discovery.sheet'),('discovery.search-here'),('discovery.hours')
on conflict do nothing;
