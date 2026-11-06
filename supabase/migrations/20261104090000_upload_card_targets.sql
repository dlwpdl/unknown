-- 사진 올리기 위 카드의 실패 버튼 (owner 2026-11-04 ③). Additive analytics targets only:
-- an unknown target rejects the whole analytics batch, so this must reach production before an app build that uses them.
insert into private.behavior_targets(id) values
  ('upload.retry'),
  ('upload.edit')
on conflict do nothing;
