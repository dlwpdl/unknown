begin;
set local search_path=public,extensions;
select no_plan();
select has_column('public','notifications','title','event notifications keep a separate title');
select has_function('private','festival_notification_body',array['jsonb','text'],'event descriptions reuse verified cached facts');
update private.trending_config set enabled=true,quiet_start_hour=0,quiet_end_hour=0 where id;
-- Timing is covered separately; this suite exercises actual source content and delivery privacy.
create or replace function private.recommendation_time(p_at timestamptz,p_timezone text) returns boolean language sql stable as $$select p_timezone is not null$$;
delete from private.push_delivery_queue;
insert into auth.users(id,email)
select ('f7130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'festival-copy-'||n||'@example.test' from generate_series(1,9)n;
insert into public.profiles(id,nickname,city_id)
select id,'행사소개'||right(id::text,1),case when right(id::text,1)='8' then 'toronto' else 'vancouver' end
from auth.users where email like 'festival-copy-%';
insert into auth.sessions(id,user_id) select id,id from public.profiles where id::text like 'f7130000-%';
insert into public.notification_preferences(user_id,push_enabled,trending,city_places)
select id,true,true,true from public.profiles where id::text like 'f7130000-%';
insert into private.push_devices(user_id,session_id,token,timezone,timezone_updated_at)
select id,id,'ExpoPushToken[festival_copy_fixture_'||right(id::text,1)||']','UTC',now() from public.profiles where id::text like 'f7130000-%';
insert into public.ticketmaster_event_cache(cache_key,payload,expires_at) values
('tm-festival:vancouver',jsonb_build_object('events',jsonb_build_array(
 jsonb_build_object('id','copy-fest','name',E'  Jazz\n Festival  ','description','두 그룹의 공연과 공개 잼 세션이 열려요.'),
 jsonb_build_object('id','rock-fest','name','Rock Festival','description',null,'segment','Music','genre','Rock'),
 jsonb_build_object('id','policy-fest','name','Policy Festival','description','No refunds or exchanges permitted.','segment','Music','genre','Jazz'),
 jsonb_build_object('id','legacy-fest','name','Legacy Festival','description',null),
 jsonb_build_object('id','sports-fest','name','Sports Fixture','description',null,'segment','Sports','genre','Basketball')
)),now()+interval '15 minutes');
update public.ticketmaster_event_cache set payload=jsonb_build_object('events',(
 select jsonb_agg(e||jsonb_build_object('country','CA','city','Vancouver','status','onsale','venue','Fixture Park',
   'startsAt',(now()+interval '30 days')::text,'timeUnconfirmed',false)) from jsonb_array_elements(payload->'events')e)) where cache_key='tm-festival:vancouver';
select private.create_notification(('f7130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'trending_post',null,'ticketmaster_event',
 md5('ticketmaster:vancouver:'||event)::uuid,'이런 행사도 있네요! old','/events/'||event||'?cityId=vancouver')
from (values(1,'copy-fest'),(2,'rock-fest'),(3,'policy-fest'),(4,'legacy-fest'),(5,'sports-fest'),(8,'copy-fest'))v(n,event);
select is((select title from public.notifications where user_id='f7130000-0000-4000-8000-000000000001'),'Jazz Festival','the title is the clean event name');
select ok((select body like '%두 그룹의 공연과 공개 잼 세션이 열려요.' from public.notifications where user_id='f7130000-0000-4000-8000-000000000001'),'the body retains the actual event description');
select ok((select body like '%록 공연이에요.%Fixture Park%' from public.notifications where user_id='f7130000-0000-4000-8000-000000000002'),'missing introductions use official genre and venue');
select ok((select body like '%재즈 공연이에요.%' and body not like '%refund%' from public.notifications where user_id='f7130000-0000-4000-8000-000000000003'),'entry and refund policies are not the event introduction');
select ok((select body like '%행사예요.%Fixture Park%' from public.notifications where user_id='f7130000-0000-4000-8000-000000000004'),'legacy caches do not invent a genre');
select ok((select body like '%농구 경기예요.%' from public.notifications where user_id='f7130000-0000-4000-8000-000000000005'),'official sports classifications describe the actual event type');
select is((select count(*)::int from public.notifications where user_id='f7130000-0000-4000-8000-000000000008'),0,'content formatting preserves the selected-city boundary');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.user_id::text like 'f7130000-%'),5,'copy changes retain one existing queue entry per eligible device');
select ok(private.festival_notification_body('{"description":null,"segment":"Music","genre":"Rock","startsAt":"2026-11-01T04:30:00Z","venue":"Fixture Park"}','vancouver') like '%10월 31일%','the concise fallback date is local across daylight-saving changes');
select ok(char_length(private.festival_notification_body(jsonb_build_object('description',repeat('😀',400)),'vancouver'))<=90,'long Unicode introductions remain within the concise notification budget');
select is(private.festival_notification_body('{"description":"야외 무대에서 밴드 공연과 공개 잼 세션이 열려요. No refunds or exchanges permitted.","segment":"Music","genre":"Rock"}','vancouver'),
 '야외 무대에서 밴드 공연과 공개 잼 세션이 열려요.','useful event details survive a separate boilerplate sentence');

select set_config('request.jwt.claims','{"sub":"f7130000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select title from public.user_notifications where user_id=auth.uid()),'Jazz Festival','the protected personal inbox includes the same event title');
select throws_ok($$select private.festival_notification_body('{}','vancouver')$$,'42501',null,'members cannot call the private content helper');
reset role;

-- A queued alert rechecks the source, rather than forwarding an outdated name or description.
update public.ticketmaster_event_cache set payload=jsonb_build_object('events',(
 select jsonb_agg(case when e->>'id'='copy-fest' then e||'{"name":"Current Jazz Festival","description":"야외 무대에서 두 팀의 재즈 공연이 열려요."}'::jsonb else e end)
 from jsonb_array_elements(payload->'events')e)) where cache_key='tm-festival:vancouver';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update private.push_delivery_queue set next_attempt_at=now();
create temp table event_claims as select * from public.claim_push_notifications('send',100);
select is((select count(*)::int from event_claims),5,'the same five eligible alerts are claimed once');
select is((select to_jsonb(c)->>'event_title' from event_claims c where user_id='f7130000-0000-4000-8000-000000000001'),'Current Jazz Festival','send uses the current verified event name');
select ok((select body like '%야외 무대에서 두 팀의 재즈 공연이 열려요.' from event_claims where user_id='f7130000-0000-4000-8000-000000000001'),'send uses the current explanatory body');
select ok(not exists(select 1 from event_claims where body like '%old%' or body like '%같이 갈 사람!?%'),'superseded queue text cannot reach the provider');
select public.complete_push_notification(id,lease_id,'ticket','f7139000-0000-4000-8000-000000000001') from event_claims;
update private.push_delivery_queue set next_attempt_at=now();
create temp table event_receipts as select * from public.claim_push_notifications('receipt',100);
select is((select count(*)::int from event_receipts),5,'receipts poll the original tickets without a new send');
select ok(not exists(select 1 from event_receipts c where token is not null or body is not null or (to_jsonb(c)->>'event_title') is not null),'receipt polling does not disclose event content or device tokens');
select ok(not has_function_privilege('anon','public.claim_push_notifications(text,integer)','execute')
 and not has_function_privilege('authenticated','public.claim_push_notifications(text,integer)','execute'),'event claims remain service-only');
select is((select count(*)::int from public.notifications where user_id::text like 'f7130000-%' and read_at is not null),0,'claiming and formatting do not mark notifications read');
select * from finish();
rollback;
