-- Accept events from the new nearby-place and room-settings controls.
insert into private.behavior_targets(id) values
 ('today.places.locate'),('places.nearby.locate'),
 ('chat.settings.open'),('chat.settings.dismiss')
on conflict do nothing;
