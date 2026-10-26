-- Keep the redesigned meetup controls in the existing analytics allowlist.
insert into private.behavior_targets(id) values
 ('meetup-create.assistance'),('meetup-create.advanced'),
 ('meetup.discovery.browse'),('meetup.discovery.mine'),
 ('meetup.mine.policy'),('meetup.join.policy'),
 ('meetup_host_tools.candidates.previous'),('meetup_host_tools.candidates.next')
on conflict do nothing;
