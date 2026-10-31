-- Meetup create screen: named controls and field focus so the signed-out drop-off can be read step by step.
-- Fixed identifiers only; no user text. Older app versions keep sending the previous generic ids, which stay registered.
do $$
begin
  if to_regclass('private.behavior_targets') is null then raise exception 'BEHAVIOR_TARGETS_MISSING'; end if;
end;
$$;

insert into private.behavior_targets(id) values
('meetup.create.back'),('meetup.create.scroll'),('meetup.create.kind'),('meetup.create.category'),
('meetup.create.submit'),('meetup.create.membership'),('meetup.create.place.map'),
('meetup.create.cover'),('meetup.create.cover.remove'),
('meetup.create.schedule.start'),('meetup.create.schedule.end'),
('meetup.create.title'),('meetup.create.body'),('meetup.create.topic'),('meetup.create.question'),
('meetup.create.cadence'),('meetup.create.capacity'),('meetup.create.age'),
('meetup.create.login'),('meetup.create.login_prompt'),('meetup.create.event_login')
on conflict do nothing;

-- The allowlist stays server-only.
revoke all on private.behavior_targets from public, anon, authenticated;
