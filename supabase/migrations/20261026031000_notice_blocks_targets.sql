-- Notice redesign: folded detail toggles and the member-sharing switch; unregistered targets make the server reject the whole analytics batch.
insert into private.behavior_targets(id) values
 ('meetup-profile.privacy-details'),('meetup-create.timezone-details'),('meetup-profile.share-members.on'),('meetup-profile.share-members.off')
on conflict do nothing;
