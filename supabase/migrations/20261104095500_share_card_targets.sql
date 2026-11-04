-- 장소·목록 공유 카드 시트(owner 2026-11-04 G6). Additive analytics targets only: an unknown id makes the server reject the whole batch.
insert into private.behavior_targets(id) values
  ('share.card.scroll'), ('share.card.tone'), ('share.card.sender.on'), ('share.card.sender.off'), ('share.card.export'),
  -- Entry buttons the place detail and saved-list screens add when the sheet is wired in.
  ('places.detail.share'), ('saved.folder.share')
on conflict do nothing;
