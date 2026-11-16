begin;
set local search_path=public,extensions;
select no_plan();

-- 1 host, 2..4 waiting people, 5 outsider.
insert into public.cities(id,name,province,timezone) values('wait-test','Waiting test','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31994,'wait-test','Waiting test','meetup') on conflict do nothing;
insert into auth.users(id,email,raw_app_meta_data) select ('f0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'wait-'||n||'@example.invalid','{}' from generate_series(1,5)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version,created_at)
select id,'Wait'||right(id::text,2),'wait-test',now(),now(),now(),'test',now()-interval '200 days' from auth.users where id::text like 'f0000000-%';
create temporary table ids as select
  'f0000000-0000-4000-8000-000000000001'::uuid h, 'f0000000-0000-4000-8000-000000000002'::uuid w1, 'f0000000-0000-4000-8000-000000000003'::uuid w2,
  'f0000000-0000-4000-8000-000000000004'::uuid w3, 'f0000000-0000-4000-8000-000000000005'::uuid o;
grant select on ids to authenticated;
create function pg_temp.as_user(p uuid) returns void language sql as $$ select set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated')::text,true) $$;
alter table public.posts disable trigger posts_meetup_abuse;

-- Link reading.
select is(private.meetup_event_ref(E'Come along\n\n행사 ID: TM-9_x'),'TM-9_x','An event line links the event');
select is(private.meetup_event_ref(E'행사 ID: A1\n행사 ID: B2'),null,'Two event lines link nothing');
select is(private.meetup_place_ref(E'Coffee\n\n장소: Cafe\n장소 정보: https://www.openstreetmap.org/node/12345'),'osm:node:12345','A place tail links the place');
select is(private.meetup_event_ref(E'Coffee\n\n장소: Cafe\n장소 정보: https://www.openstreetmap.org/node/12345'),null,'A place meetup is not an event meetup');

-- No open meetup yet: count only.
select pg_temp.as_user(w1) from ids; set local role authenticated;
select is(public.get_meetup_waiting('event','EVT1','wait-test'),'{"open": false, "count": 0, "mine": false}'::jsonb,'Nobody waiting, no open meetup');
select is(public.set_meetup_waiting('event','EVT1','wait-test',true),'{"open": false, "count": 1, "mine": true}'::jsonb,'Asking marks mine and counts');
select is(public.set_meetup_waiting('event','EVT1','wait-test',true)->>'count','1','Asking twice counts once');
reset role; select pg_temp.as_user(w2) from ids; set local role authenticated;
select public.set_meetup_waiting('event','EVT1','wait-test',true);
select public.set_meetup_waiting('place','osm:node:12345','wait-test',true);
reset role; select pg_temp.as_user(w3) from ids; set local role authenticated;
select public.set_meetup_waiting('event','EVT1','wait-test',true);
select is(public.set_meetup_waiting('event','EVT1','wait-test',false),'{"open": false, "count": 2, "mine": false}'::jsonb,'Cancelling leaves the others');
reset role; select pg_temp.as_user(o) from ids; set local role authenticated;
select is(public.get_meetup_waiting('event','EVT1','wait-test'),'{"open": false, "count": 2, "mine": false}'::jsonb,'An outsider sees the count and not who');
select throws_ok($$select public.get_meetup_waiting('event','bad id','wait-test')$$,'P0001','INVALID_WAITING_TARGET','A bad id is refused');
select throws_ok($$select public.get_meetup_waiting('place','EVT1','wait-test')$$,'P0001','INVALID_WAITING_TARGET','A place needs an OSM id');
reset role;
select is((select count(*)::int from information_schema.table_privileges where table_schema='private' and table_name='meetup_waiting' and grantee in('anon','authenticated')),0,'The waiting table is not readable by apps');
set local role anon;
select throws_ok($$select public.get_meetup_waiting('event','EVT1','wait-test')$$,'42501',null,'Anonymous callers cannot ask');
reset role;

-- An invite-only meetup linked to the event does not count, and does not notify.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select 'f0100000-0000-4000-8000-000000000001',h,'wait-test',31994,'Private','Hi'||E'\n\n행사 ID: EVT1',current_date,
  jsonb_build_object('eventKind','once','access','invite','startsAt',now()+interval '5 days','endsAt',now()+interval '5 days 2 hours','timezone','America/Vancouver','capacity',6,'memberCount',1) from ids;
select is((select count(*)::int from public.notifications where kind='meetup_changed' and target_id='f0100000-0000-4000-8000-000000000001'),0,'Invite-only meetups tell nobody');
select is(private.meetup_waiting_state((select o from ids),'event','EVT1','wait-test')->>'open','false','An invite-only meetup is not an open public meetup');

-- A public meetup linked to the event tells the waiting people once and ends their request.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select 'f0100000-0000-4000-8000-000000000002',h,'wait-test',31994,'Concert together','Hi'||E'\n\n행사 ID: EVT1',current_date,
  jsonb_build_object('eventKind','once','startsAt',now()+interval '5 days','endsAt',now()+interval '5 days 2 hours','timezone','America/Vancouver','capacity',6,'memberCount',1) from ids;
select is((select count(*)::int from public.notifications where kind='meetup_changed' and target_id='f0100000-0000-4000-8000-000000000002' and body like '기다리던 모임이 열렸어요.%' and route='/post/f0100000-0000-4000-8000-000000000002'),2,'Two people were waiting, so two notifications');
select is((select array_agg(user_id order by user_id) from public.notifications where kind='meetup_changed' and target_id='f0100000-0000-4000-8000-000000000002'),(select array[w1,w2] from ids),'They went to the two still waiting, not the one who cancelled');
select is((select count(*)::int from private.meetup_waiting where kind='event' and ref='EVT1'),0,'Their request ended');
select is((select count(*)::int from private.meetup_waiting where kind='place'),1,'Other requests stay');
select is((select count(*)::int from private.meetup_waiting where kind='event' and user_id=(select w3 from ids)),0,'The cancelled one stayed cancelled');
update public.posts set room_preview=room_preview||'{"memberCount":2}' where id='f0100000-0000-4000-8000-000000000002';
select is((select count(*)::int from public.notifications where kind='meetup_changed' and target_id='f0100000-0000-4000-8000-000000000002'),2,'Later edits do not notify again');
select pg_temp.as_user(o) from ids; set local role authenticated;
select is(public.get_meetup_waiting('event','EVT1','wait-test')->>'open','true','Now an open meetup exists');
select throws_ok($$select public.set_meetup_waiting('event','EVT1','wait-test',true)$$,'P0001','MEETUP_ALREADY_OPEN','Nobody can wait for an event that has one');
reset role;

-- A place meetup, with its host also waiting (not told about their own meetup).
insert into private.meetup_waiting(user_id,kind,ref,city_id) select h,'place','osm:node:12345','wait-test' from ids;
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select 'f0100000-0000-4000-8000-000000000003',h,'wait-test',31994,'Cafe time',E'Hi\n\n장소: Cafe\n장소 정보: https://www.openstreetmap.org/node/12345',current_date,
  jsonb_build_object('eventKind','once','startsAt',now()+interval '5 days','endsAt',now()+interval '5 days 2 hours','timezone','America/Vancouver','capacity',6,'memberCount',1) from ids;
select is((select user_id from public.notifications where kind='meetup_changed' and target_id='f0100000-0000-4000-8000-000000000003'),(select w2 from ids),'The place meetup tells the person waiting for that place');
select is((select count(*)::int from private.meetup_waiting where kind='place'),1,'The host own request is kept, not notified');

-- Account deletion removes waiting requests.
insert into private.meetup_waiting(user_id,kind,ref,city_id) select w3,'event','EVT9','wait-test' from ids;
select ok(strpos(pg_get_functiondef('private.purge_account_data(text)'::regprocedure),'purge_meetup_waiting_account_data(current_user_id)')>0,'Account deletion runs the waiting purge');
select private.purge_meetup_waiting_account_data((select w3 from ids));
select is((select count(*)::int from private.meetup_waiting where user_id=(select w3 from ids)),0,'Deleting the account deletes its waiting requests');
select * from finish();
rollback;
