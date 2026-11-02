-- 오늘 화면의 떠 있는 글쓰기 버튼 (owner 2026-11-01 A안: 지도가 아래 탭의 글쓰기 자리로). Additive analytics target only.
insert into private.behavior_targets(id) values('feed.write') on conflict do nothing;
