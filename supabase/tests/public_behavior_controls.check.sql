begin;
set local role anon;
select public.record_behavior_events('qa-public-web-controls-20261015','web',
  '[{"seq":1,"screen":"feed","kind":"press","target":"web_control_21","value":1},{"seq":2,"screen":"feed","kind":"press","target":"web_control_22","value":1}]');
select public.record_behavior_events('qa-public-web-controls-20261015','web',
  '[{"seq":1,"screen":"feed","kind":"press","target":"web_control_21","value":1},{"seq":2,"screen":"feed","kind":"press","target":"web_control_22","value":1}]');
do $$ begin
  begin
    perform public.record_behavior_events('qa-public-web-controls-20261015','web',
      '[{"seq":3,"screen":"feed","kind":"press","target":"private-user-text","value":1}]');
    raise exception 'Unknown analytics target was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'INVALID_BEHAVIOR' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  if (select count(*) from private.behavior_events where session_id='qa-public-web-controls-20261015') <> 2 then
    raise exception 'Analytics retry must store each event once';
  end if;
end $$;
rollback;
