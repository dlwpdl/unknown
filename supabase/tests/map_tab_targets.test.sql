begin;
select plan(4);
select is((select count(*) from private.behavior_targets where id in ('place.reserve.link','place.reserve.phone','place.reserve.message',
  'discovery.open-now','discovery.unknown-hours','discovery.price','discovery.subcategory','discovery.sheet','discovery.search-here','discovery.hours')),
  10::bigint,'map tab controls have fixed analytics targets');
set local role anon;
select lives_ok($$select public.record_behavior_events('qa-map-tab-session-12345','ios','[{"seq":1,"screen":"feed","kind":"press","target":"place.reserve.phone","value":1},{"seq":2,"screen":"feed","kind":"press","target":"discovery.open-now","value":1}]')$$,'map tab presses are accepted');
select lives_ok($$select public.record_behavior_events('qa-map-tab-session-12345','ios','[{"seq":3,"screen":"feed","kind":"press","target":"place.reserve.anything","value":1}]')$$,'an unknown target does not reject its batch');
reset role;
select is((select target from private.behavior_events where session_id='qa-map-tab-session-12345' and seq=3),'unregistered','an unknown target is stored only as unregistered');
select * from finish();
rollback;
