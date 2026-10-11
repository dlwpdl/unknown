begin;
set local search_path=public,extensions;
select no_plan();
create temp table festival_jobs_before as select jobid,jobname,schedule,username,active,command from cron.job;
select ok(to_regclass('private.festival_slot_overrides') is not null,'festival slot assignments exist');
select ok(not has_table_privilege('anon','private.festival_slot_overrides','SELECT'),'anonymous cannot read override configuration');
select ok(not has_table_privilege('authenticated','private.festival_slot_overrides','UPDATE'),'members cannot edit positions directly');
select ok(not has_function_privilege('authenticated','public.claim_ticketmaster_festival_refresh(text)','EXECUTE'),'only the service claims refreshes');
select ok(not has_function_privilege('anon','public.get_ticketmaster_festival_slots(text)','EXECUTE'),'only the service resolves assignments');
select ok(has_function_privilege('authenticated','public.set_admin_festival_slot(text,integer,text,timestamp with time zone)','EXECUTE'),'admin RPC is available through the authenticated boundary');
select ok(not exists(select 1 from festival_jobs_before b full join cron.job j using(jobid)
  where b.jobid is null or j.jobid is null or (b.jobname,b.schedule,b.username,b.active) is distinct from (j.jobname,j.schedule,j.username,j.active)),'all job identities, schedules and owners stay unchanged');
select ok(not exists(select 1 from festival_jobs_before b join cron.job j using(jobid)
  where b.jobname<>'ticketmaster-cache-cleanup' and b.command is distinct from j.command),'all unrelated job commands stay unchanged');
select ok(position('expires_at' in (select command from cron.job where jobname='ticketmaster-cache-cleanup'))>0,'cleanup preserves an unexpired daily snapshot');

delete from public.ticketmaster_event_cache where cache_key='tm-festival:vancouver';
select is(public.claim_ticketmaster_festival_refresh('vancouver'),true,'first caller claims one city refresh');
select is(public.claim_ticketmaster_festival_refresh('vancouver'),false,'a concurrent caller cannot duplicate collection');
update public.ticketmaster_event_cache set refresh_started_at=now()-interval '16 minutes' where cache_key='tm-festival:vancouver';
select is(public.claim_ticketmaster_festival_refresh('vancouver'),true,'failed refresh can recover after its bounded cooldown');
update public.ticketmaster_event_cache set payload='{"events":[]}',expires_at=now()+interval '12 hours',refresh_started_at=null where cache_key='tm-festival:vancouver';
select is(public.claim_ticketmaster_festival_refresh('vancouver'),false,'a successful empty day is cached too');
update public.ticketmaster_event_cache set expires_at=now()-interval '1 second' where cache_key='tm-festival:vancouver';
select is(public.claim_ticketmaster_festival_refresh('vancouver'),true,'expired daily collection can refresh');
select throws_ok($$select public.claim_ticketmaster_festival_refresh('not-a-city')$$,'P0001','INVALID_CITY','unsupported cities cannot create cache keys');
insert into public.ticketmaster_event_cache(cache_key,payload,updated_at,expires_at) values
('tm-festival:edmonton',jsonb_build_object('events',jsonb_build_array(jsonb_build_object('id','long-day-fest','name','Long Day Festival','startsAt',now()+interval '7 days','city','Edmonton','country','CA','status','onsale','timeUnconfirmed',false))),now()-interval '24 hours 15 minutes',now()+interval '45 minutes')
on conflict(cache_key) do update set payload=excluded.payload,updated_at=excluded.updated_at,expires_at=excluded.expires_at;
select ok(private.cached_ticketmaster_event('edmonton','long-day-fest') is not null,'a fresh 25-hour local-day snapshot remains readable without recollection');
select ok(exists(select 1 from private.ticketmaster_notification_events where city_id='edmonton' and event_id='long-day-fest'),'daily discovery remains available during the long local day');

insert into auth.users(id,email,raw_app_meta_data) values
('16100000-0000-0000-0000-000000000001','festival-admin@seed.gling.invalid','{"role":"admin"}'),
('16100000-0000-0000-0000-000000000002','festival-member@seed.gling.invalid','{}');
insert into auth.sessions(id,user_id,aal) values('16160000-0000-0000-0000-000000000001','16100000-0000-0000-0000-000000000001','aal2');
insert into public.profiles(id,nickname,city_id) values
('16100000-0000-0000-0000-000000000001','페스티벌검사관리자','vancouver'),
('16100000-0000-0000-0000-000000000002','페스티벌검사회원','vancouver');
insert into public.ticketmaster_event_cache(cache_key,payload,updated_at,expires_at) values
('tm-event:vancouver:fixture-fest',jsonb_build_object('event',jsonb_build_object('id','fixture-fest','name','Fixture Festival','startsAt',now()+interval '7 days','localDate',to_char(now()+interval '7 days','YYYY-MM-DD'),'city','Vancouver','country','CA','venue','Fixture Park','status','onsale','timeUnconfirmed',false)),now(),now()+interval '15 minutes'),
('tm-event:toronto:other-city',jsonb_build_object('event',jsonb_build_object('id','other-city','name','Other Festival','startsAt',now()+interval '7 days','city','Toronto','country','CA','status','onsale','timeUnconfirmed',false)),now(),now()+interval '15 minutes');
insert into public.ticketmaster_event_cache(cache_key,payload,updated_at,expires_at)
select 'tm-event:vancouver:fixture-day-two',jsonb_set(payload,'{event,id}','"fixture-day-two"'),now(),now()+interval '15 minutes'
from public.ticketmaster_event_cache where cache_key='tm-event:vancouver:fixture-fest';

select set_config('request.jwt.claims','{"sub":"16100000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","session_id":"16160000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.set_admin_festival_slot('vancouver',2,'fixture-fest',null)$$,'P0001','ADMIN_REQUIRED','first-factor administrator cannot assign festivals');
select throws_ok($$select public.get_admin_festival_slots('vancouver')$$,'P0001','ADMIN_REQUIRED','first-factor administrator cannot read position settings');
reset role;
select set_config('request.jwt.claims','{"sub":"16100000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2","app_metadata":{}}',true);
set local role authenticated;
select throws_ok($$select public.set_admin_festival_slot('vancouver',2,'fixture-fest',null)$$,'P0001','ADMIN_REQUIRED','ordinary members cannot assign festivals');
select throws_ok($$select public.get_admin_festival_slots('vancouver')$$,'P0001','ADMIN_REQUIRED','ordinary members cannot read position settings');
reset role;
select set_config('request.jwt.claims','{"sub":"16100000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"16160000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.set_admin_festival_slot('vancouver',2,'fixture-fest',null)$$,'verified admin can assign any position');
select throws_ok($$select public.set_admin_festival_slot('vancouver',8,'fixture-fest',null)$$,'P0001','INVALID_FESTIVAL_SLOT','position range is enforced');
select throws_ok($$select public.set_admin_festival_slot('vancouver',3,'other-city',null)$$,'P0001','FESTIVAL_UNAVAILABLE','a festival from another city cannot be assigned');
select throws_ok($$select public.set_admin_festival_slot('vancouver',3,'fixture-fest',now()-interval '1 minute')$$,'P0001','INVALID_FESTIVAL_SLOT','past exposure expiry is rejected');
select lives_ok($$select public.set_admin_festival_slot('vancouver',3,'fixture-day-two',null)$$,'a different ticket for the same festival can move its assigned position');
reset role;
create extension if not exists pgrowlocks with schema extensions;
select ok(exists(select 1 from extensions.pgrowlocks('public.cities') l join public.cities c on c.ctid=l.locked_row
  where c.id='vancouver' and 'For Update'=any(l.modes)),'admin assignments hold an exclusive city row lock until transaction end');
select is((select count(*)::integer from private.festival_slot_overrides where city_id='vancouver'),1,'day-ticket aliases cannot occupy two assigned positions');
select is((select slot from private.festival_slot_overrides where city_id='vancouver' and event_id='fixture-day-two'),3,'the requested day-ticket position is actually the saved assignment');
set local role authenticated;
select lives_ok($$select public.set_admin_festival_slot('vancouver',5,'fixture-fest',null)$$,'an existing assignment moves without duplicate positions');
reset role;
select is((select count(*)::integer from private.festival_slot_overrides where city_id='vancouver'),1,'one event occupies only one assigned position');
select is((select slot from private.festival_slot_overrides where city_id='vancouver'),5,'the requested position was saved');
select is((select count(*)::integer from public.get_ticketmaster_festival_slots('vancouver')),1,'service reads the saved active assignment');
select ok(exists(select 1 from public.admin_access_logs where actor_id='16100000-0000-0000-0000-000000000001' and scope='analytics'),'changes use the existing administrator audit');
update public.ticketmaster_event_cache set payload=jsonb_set(payload,'{event,startsAt}','null') where cache_key='tm-event:vancouver:fixture-fest';
set local role authenticated;
select throws_ok($$select public.set_admin_festival_slot('vancouver',3,'fixture-fest',null)$$,'P0001','FESTIVAL_UNAVAILABLE','missing start time is rejected before storage');
reset role;
update private.festival_slot_overrides set ends_at=now()-interval '1 second' where city_id='vancouver';
select is((select count(*)::integer from public.get_ticketmaster_festival_slots('vancouver')),0,'expired exposure returns the position to automatic selection');
set local role authenticated;
select lives_ok($$select public.set_admin_festival_slot('vancouver',5,null,null)$$,'clearing a position needs no upstream API call');
reset role;
select is((select count(*)::integer from private.festival_slot_overrides where city_id='vancouver'),0,'clear removes the assignment');
select * from finish();
rollback;
