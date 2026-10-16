insert into private.behavior_targets(id) values
 ('places.reviews.refresh'),
 ('places.reviews.write'),
 ('places.reviews.publish'),
 ('places.reviews.cancel'),
 ('places.reviews.more')
on conflict do nothing;
