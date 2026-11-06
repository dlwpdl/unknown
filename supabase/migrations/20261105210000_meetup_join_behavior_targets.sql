-- Controls on the one-screen meetup application; an unknown target rejects the whole analytics batch.
insert into private.behavior_targets(id) values
 ('meetup.join.city'),('meetup.join.intro-examples'),('meetup.join.intro-example'),('meetup.join.fill-profile')
on conflict do nothing;
