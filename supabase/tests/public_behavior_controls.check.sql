begin;
set local role anon;
select public.record_behavior_events('qa-public-web-controls-20261015','web',
  '[{"seq":1,"screen":"feed","kind":"press","target":"web_control_21","value":1},{"seq":2,"screen":"feed","kind":"press","target":"web_control_22","value":1}]');
select public.record_behavior_events('qa-public-web-controls-20261015','web',
  '[{"seq":1,"screen":"feed","kind":"press","target":"web_control_21","value":1},{"seq":2,"screen":"feed","kind":"press","target":"web_control_22","value":1}]');
select public.record_behavior_events('qa-public-web-controls-20261015','web',
  '[{"seq":3,"screen":"feed","kind":"press","target":"private-user-text","value":1}]');
reset role;
do $$ begin
  if (select count(*) from private.behavior_events where session_id='qa-public-web-controls-20261015') <> 3
    or (select target from private.behavior_events where session_id='qa-public-web-controls-20261015' and seq=3) <> 'unregistered'
    or exists(select 1 from private.behavior_events where session_id='qa-public-web-controls-20261015' and seq<3 and target='unregistered')
    or exists(select 1 from private.behavior_events where target='private-user-text') then
    raise exception 'Analytics retry must store each event once and unknown targets only as unregistered';
  end if;
end $$;
rollback;
