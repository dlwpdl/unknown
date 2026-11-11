begin;
set local role anon;
select public.record_behavior_events('qa-live-controls-20261016','web',
  '[{"seq":1,"screen":"feed","kind":"press","target":"web_control_21","value":1},
    {"seq":2,"screen":"feed","kind":"press","target":"web_control_22","value":1},
    {"seq":3,"screen":"meetups","kind":"press","target":"meetups.discovery.open","value":1},
    {"seq":4,"screen":"chat","kind":"press","target":"chat.discovery.open","value":1},
    {"seq":5,"screen":"post","kind":"press","target":"content_translation.toggle","value":1},
    {"seq":6,"screen":"post","kind":"press","target":"post.share.external","value":1}]');
select public.record_behavior_events('qa-live-controls-20261016','web',
  '[{"seq":1,"screen":"feed","kind":"press","target":"web_control_21","value":1}]');
select public.record_behavior_events('qa-live-controls-20261016','web',
  '[{"seq":7,"screen":"feed","kind":"press","target":"arbitrary-private-text","value":1}]');
reset role;
do $$ begin
  if (select count(*) from private.behavior_events where session_id='qa-live-controls-20261016') <> 7
    or (select target from private.behavior_events where session_id='qa-live-controls-20261016' and seq=7) <> 'unregistered'
    or exists(select 1 from private.behavior_events where target='arbitrary-private-text') then
    raise exception 'Fixed targets must be accepted once and unknown targets kept only as unregistered';
  end if;
end $$;
rollback;
