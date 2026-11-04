-- Controls on the new import screen (owner 2026-11-04 G3) and its entry on the saved screen.
-- An unknown target rejects the whole analytics batch, so this must reach production before the app build.
insert into private.behavior_targets(id) values
  ('saved.import'),
  ('import.find'),
  ('import.file'),
  ('import.pick'),
  ('import.pick.back'),
  ('import.branch'),
  ('import.missing.search'),
  ('import.toggle'),
  ('import.add'),
  ('import.ask'),
  ('import.save'),
  ('import.restart'),
  ('import.done')
on conflict (id) do nothing;
notify pgrst,'reload schema';
