-- Membership redesign: folded comparison and meetup-rules rows, and the "글링 관리" inquiry card; unregistered targets make the server reject the whole analytics batch.
insert into private.behavior_targets(id) values
 ('membership.compare'),('membership.rules'),('membership.business.managed')
on conflict do nothing;
insert into private.behavior_targets(id) values ('membership.business.picker') on conflict do nothing;
