begin;
select no_plan();
select has_function('public','configure_chilling_event',array['uuid','text','timestamp with time zone','timestamp with time zone','text','text','integer'],'event configuration RPC exists');
select ok(not has_function_privilege('anon','public.configure_chilling_event(uuid,text,timestamptz,timestamptz,text,text,integer)','EXECUTE'),'guests cannot execute configuration RPC');
insert into auth.users(id,email) values
 ('63000000-0000-0000-0000-000000000001','host63@example.test'),
 ('63000000-0000-0000-0000-000000000002','guest63@example.test'),
 ('63000000-0000-0000-0000-000000000003','other63@example.test');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'칠링회원'||right(id::text,1),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '63000000-%';
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values
 ('63000000-0000-0000-0000-000000000011','63000000-0000-0000-0000-000000000001','vancouver',1,'칠링 테스트','함께 걸어요',current_date,'{"id":"room63","capacity":8,"memberCount":1,"verifiedOnly":false}');
select set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_membership()->>'tier','free','configuration tests use free membership');
select lives_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','once',now()+interval '1 day',now()+interval '2 days','America/Vancouver')$$,'free host can configure one-off event');
select is((select room_preview->>'eventKind' from public.posts where id='63000000-0000-0000-0000-000000000011'),'once','one-off kind persisted');
select is((select room_preview->>'id' from public.posts where id='63000000-0000-0000-0000-000000000011'),'room63','existing room identity preserved');
select lives_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','group',p_cadence=>'매주 토요일')$$,'free host can configure ongoing group');
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011',null)$$,'P0001','INVALID_EVENT_KIND','null kind rejected');
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','group',p_cadence=>' ')$$,'P0001','INVALID_EVENT_CADENCE','empty cadence rejected');
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','group',p_cadence=>repeat('a',81))$$,'P0001','INVALID_EVENT_CADENCE','overlong cadence rejected');
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','group',now(),p_cadence=>'weekly')$$,'P0001','INVALID_EVENT_SCHEDULE','group cannot retain one-off timestamps');
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','once',now()+interval '2 days',now()+interval '1 day','America/Vancouver')$$,'P0001','INVALID_EVENT_SCHEDULE','reversed schedule rejected');
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','once',now()-interval '2 days',now()-interval '1 day','America/Vancouver')$$,'P0001','INVALID_EVENT_SCHEDULE','expired schedule rejected');
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','once',now(),now()+interval '1 day','not/a-zone')$$,'P0001','INVALID_EVENT_TIMEZONE','invalid timezone rejected');
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','group',p_cadence=>'weekly',p_capacity=>1)$$,'P0001','INVALID_EVENT_CAPACITY','too-small capacity rejected');
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','group',p_cadence=>'weekly',p_capacity=>51)$$,'P0001','INVALID_EVENT_CAPACITY','too-large capacity rejected');
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','group',p_cadence=>'weekly',p_capacity=>null)$$,'P0001','INVALID_EVENT_CAPACITY','null capacity rejected');
reset role;
select set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','group',p_cadence=>'weekly')$$,'P0001','MEETUP_NOT_FOUND','another account cannot configure host event');
select lives_ok($$select public.request_meetup_join('63000000-0000-0000-0000-000000000011','함께해요')$$,'group request succeeds');
reset role;
select set_config('test.request63',(select id::text from public.meetup_requests where post_id='63000000-0000-0000-0000-000000000011'),true);
select set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.respond_meetup_request(current_setting('test.request63')::uuid,'approved')$$,'group approval succeeds');
select is((select room_preview->>'memberCount' from public.posts where id='63000000-0000-0000-0000-000000000011'),'2','approval still maintains member count');
select lives_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','once',now(),now()+interval '1 day','America/Vancouver',p_capacity=>2)$$,'capacity can equal host plus approved members');
reset role;
-- Service-side direct writes must obey metadata validation too, even though clients have no UPDATE grant.
select throws_ok($$update public.posts set room_preview=jsonb_set(room_preview,'{capacity}','2.5') where id='63000000-0000-0000-0000-000000000011'$$,'P0001','INVALID_EVENT_CAPACITY','direct fractional capacity bypass rejected');
select throws_ok($$update public.posts set room_preview=room_preview-'eventKind' where id='63000000-0000-0000-0000-000000000011'$$,'P0001','INVALID_EVENT_KIND','removing kind cannot bypass event validation');
select throws_ok($$update public.posts set room_preview=jsonb_set(room_preview,'{endsAt}','null') where id='63000000-0000-0000-0000-000000000011'$$,'P0001','INVALID_EVENT_SCHEDULE','direct invalid schedule bypass rejected');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values
 ('63000000-0000-0000-0000-000000000012','63000000-0000-0000-0000-000000000001','vancouver',1,'기존 모임','기존 모임 보존',current_date-1,'{"id":"legacy63","capacity":8,"memberCount":3}');
select throws_ok($$update public.posts set room_preview=room_preview||'{"startsAt":null}'::jsonb where id='63000000-0000-0000-0000-000000000012'$$,'P0001','INVALID_EVENT_KIND','partial new metadata cannot masquerade as legacy group');
insert into public.meetup_requests(post_id,host_id,requester_id,status) values
 ('63000000-0000-0000-0000-000000000012','63000000-0000-0000-0000-000000000001','63000000-0000-0000-0000-000000000002','approved'),
 ('63000000-0000-0000-0000-000000000012','63000000-0000-0000-0000-000000000001','63000000-0000-0000-0000-000000000003','approved');
select set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.request_meetup_join('63000000-0000-0000-0000-000000000012')$$,'legacy group request stays compatible');
reset role;
select set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000012','group',p_cadence=>'weekly',p_capacity=>2)$$,'P0001','EVENT_CAPACITY_BELOW_MEMBERS','cannot shrink below approved participants plus host');
select is((select room_preview->>'memberCount' from public.posts where id='63000000-0000-0000-0000-000000000012'),'3','rejected configuration preserves counts');
reset role;
-- Simulate the passage of time without waiting or changing existing participants.
alter table public.posts disable trigger posts_chilling_event_details;
update public.posts set room_preview=room_preview||jsonb_build_object('startsAt',now()-interval '2 days','endsAt',now()-interval '1 day') where id='63000000-0000-0000-0000-000000000011';
alter table public.posts enable trigger posts_chilling_event_details;
select set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.request_meetup_join('63000000-0000-0000-0000-000000000011','참여')$$,'P0001','MEETUP_EXPIRED','new requests reject expired one-off event before capacity check');
reset role;
-- Pending request made before expiration; insertion bypass is fixture-only.
alter table public.meetup_requests disable trigger meetup_requests_chilling_expiry;
insert into public.meetup_requests(id,post_id,host_id,requester_id,message) values
 ('63000000-0000-0000-0000-000000000021','63000000-0000-0000-0000-000000000011','63000000-0000-0000-0000-000000000001','63000000-0000-0000-0000-000000000003','earlier request');
alter table public.meetup_requests enable trigger meetup_requests_chilling_expiry;
select throws_ok($$update public.meetup_requests set status='approved' where id='63000000-0000-0000-0000-000000000021'$$,'P0001','MEETUP_EXPIRED','direct approval also rejects expired event');
select set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.respond_meetup_request('63000000-0000-0000-0000-000000000021','approved')$$,'P0001','MEETUP_EXPIRED','RPC approval rejects expired event before capacity check');
select lives_ok($$select public.respond_meetup_request('63000000-0000-0000-0000-000000000021','rejected')$$,'expired requests may still be rejected');
reset role;
select set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.leave_meetup('63000000-0000-0000-0000-000000000011')$$,'approved member can leave expired event');
reset role;
select set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.leave_meetup('63000000-0000-0000-0000-000000000011')$$,'host can close expired event');
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000011','group',p_cadence=>'weekly')$$,'P0001','MEETUP_CLOSED','closed event cannot be reconfigured');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000012','group',p_cadence=>'weekly')$$,'P0001','AUTH_REQUIRED','configuration requires an authenticated identity');
reset role;
update public.profiles set account_status='suspended' where id='63000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.configure_chilling_event('63000000-0000-0000-0000-000000000012','group',p_cadence=>'weekly')$$,'P0001','ACCOUNT_LOCKED','inactive accounts cannot configure events');
reset role;
select * from finish();
rollback;
