-- Fixed analytics ids the app already sends (1.5.1 included) but no migration registered. Additive only: one unknown target rejects the whole batch with INVALID_BEHAVIOR.
insert into private.behavior_targets(id) values
  ('chat.album.photo'),
  ('components_chat-room.pressable.heart'),
  ('chat.photo.previous'),
  ('chat.photo.next'),
  ('merchant.primary'),
  ('event.language.en'),
  ('event.language.ko'),
  ('event.retry'),
  ('event.apply.follow'),
  ('event.apply.allergy.none'),
  ('event.apply.language.en'),
  ('event.apply.language.ko'),
  ('event.apply.submit'),
  ('event.partner.check'),
  ('event.partner.undo')
on conflict do nothing;
