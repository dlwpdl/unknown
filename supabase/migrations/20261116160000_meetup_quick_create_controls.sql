-- Controls on the one-screen 칠링, the kind cards and the topic start template (owner 2026-11-16).
-- Unregistered ids are stored only as 'unregistered' (20261111130000), so each one is listed. No table or function changes.
insert into private.behavior_targets(id) values
  ('meetup.create.entry.once'),('meetup.create.entry.group'),
  ('meetup.create.quick.when'),('meetup.create.quick.rest'),('meetup.create.quick.full'),('meetup.create.quick.submit'),
  ('meetup.create.topic_start'),('meetup.create.topic_start.replace'),('meetup.create.topic_start.keep'),
  ('meetup.create.info_cell')
on conflict (id) do nothing;
