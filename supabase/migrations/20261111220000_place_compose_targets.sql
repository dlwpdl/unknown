-- 이 장소로 글쓰기 (owner 2026-11-11): the map place card and the place screen open the writer with that place attached. Additive analytics targets only.
insert into private.behavior_targets(id) values
('discovery.compose'),('places.detail.compose')
on conflict do nothing;
