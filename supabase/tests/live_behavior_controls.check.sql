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
do $$ begin
  begin
    perform public.record_behavior_events('qa-live-controls-20261016','web',
      '[{"seq":7,"screen":"feed","kind":"press","target":"arbitrary-private-text","value":1}]');
    raise exception 'Unknown analytics target was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'INVALID_BEHAVIOR' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  if (select count(*) from private.behavior_events where session_id='qa-live-controls-20261016') <> 6 then
    raise exception 'Fixed targets must be accepted once and unknown targets rejected';
  end if;
end $$;
rollback;
