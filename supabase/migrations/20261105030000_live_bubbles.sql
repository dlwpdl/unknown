-- 동네 말풍선 지도 (owner 2026-11-05, docs/ideas/live-map-2026-11-05.md): analytics targets for the live-map controls.
-- Additive only; the tables and functions follow in this same migration.
insert into private.behavior_targets(id) values
('livemap.filter'),('livemap.dock'),('livemap.dev'),('livemap.bar'),('livemap.end'),('livemap.extend'),('livemap.far'),('livemap.banner'),
('livemap.compose'),('livemap.compose.next'),('livemap.preview'),('livemap.post'),('livemap.profile'),('livemap.chat'),
('livemap.request'),('livemap.request.send'),('livemap.request.cancel'),('livemap.wave'),('livemap.wave.reply'),
('livemap.received'),('livemap.received.accept'),('livemap.received.decline')
on conflict do nothing;
