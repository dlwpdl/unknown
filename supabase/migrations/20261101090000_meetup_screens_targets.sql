-- Controls added by the remaining meetup screens. Additive: an unknown target rejects the whole analytics batch,
-- so this must reach production before an app build that uses them.
insert into private.behavior_targets(id) values
  ('meetup-create.profile-preview'),
  ('meetup.detail.my-request'),
  ('meetup-profile.edit-item'),
  ('meetup-profile.preview'),
  ('meetup-profile.move-photo'),
  ('meetup.application.decide'),
  ('meetup.application.next'),
  ('meetup.application.inbox')
on conflict (id) do nothing;
