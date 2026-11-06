-- The saved card's ··· menu (owner 2026-11-04 "저장함: 사진 넣고 버튼은 ···"); 폴더 정리·저장 해제 keep their own targets inside it.
-- An unknown target rejects the whole analytics batch, so this must reach production before the app build.
insert into private.behavior_targets(id) values
  ('saved.menu')
on conflict (id) do nothing;
notify pgrst,'reload schema';
