-- 글쓰기 장소 고르기 (owner 2026-11-11): the picker opens on the map's place pins and 직접 핀 놓기 switches to the plain pin map. Additive analytics target only.
insert into private.behavior_targets(id) values
('post.location.mode')
on conflict do nothing;
