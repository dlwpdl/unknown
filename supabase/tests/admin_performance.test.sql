begin;
select no_plan();

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select throws_ok($$select public.get_admin_performance()$$,'42501',null,'anonymous users cannot read performance');
reset role;

insert into public.cities(id,name,province,timezone,is_open) values ('performance-test','분석검사','BC','UTC',true);
insert into auth.users(id,email,raw_app_meta_data) values
('88888888-1111-1111-1111-111111111111','performance-a@example.invalid','{}'),
('88888888-2222-2222-2222-222222222222','performance-b@example.invalid','{}'),
('88888888-3333-3333-3333-333333333333','performance-c@example.invalid','{}'),
('88888888-4444-4444-4444-444444444444','performance-d@example.invalid','{}'),
('88888888-5555-5555-5555-555555555555','performance@seed.gling.invalid','{}'),
('88888888-6666-6666-6666-666666666666','performance-review@example.invalid','{"review_access":true}'),
('88888888-7777-7777-7777-777777777777','performance-admin@example.invalid','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id,created_at) values
('88888888-1111-1111-1111-111111111111','분석검사1','performance-test',now()-interval '32 days'),
('88888888-2222-2222-2222-222222222222','분석검사2','performance-test',now()-interval '8 days'),
('88888888-3333-3333-3333-333333333333','분석검사3','performance-test',now()-interval '2 days'),
('88888888-4444-4444-4444-444444444444','분석검사4','performance-test',now()),
('88888888-5555-5555-5555-555555555555','분석목검사','performance-test',now()),
('88888888-6666-6666-6666-666666666666','분석심사검사','performance-test',now()),
('88888888-7777-7777-7777-777777777777','분석관리검사','performance-test',now());
update private.analytics_config set started_at=now()-interval '60 days';
insert into private.analytics_visits(user_id,platform,bucket,first_at,last_at,screen,app_version) values
('88888888-1111-1111-1111-111111111111','ios',date_trunc('day',now()-interval '2 days'),now()-interval '2 days',now()-interval '2 days','feed','1.2.0'),
('88888888-2222-2222-2222-222222222222','android',date_trunc('day',now()-interval '1 day'),now()-interval '1 day',now()-interval '1 day','feed','1.2.0'),
('88888888-3333-3333-3333-333333333333','ios',date_trunc('day',now()-interval '1 day'),now()-interval '1 day',now()-interval '1 day','feed','1.2.0'),
('88888888-4444-4444-4444-444444444444','web',date_trunc('day',now()),now(),now(),'feed','1.2.0'),
('88888888-5555-5555-5555-555555555555','ios',date_trunc('day',now()),now(),now(),'feed','1.2.0');

select set_config('request.jwt.claims','{"sub":"88888888-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_performance()$$,'P0001','ADMIN_REQUIRED','members cannot read aggregates');
select throws_ok($$select * from private.product_events$$,'42501',null,'product action records stay private');
select throws_ok($$select public.record_product_event('arbitrary_text',null,null,'ios')$$,'P0001','INVALID_PRODUCT_EVENT','untrusted action names are rejected');
reset role;

-- The transaction uses the current is_admin definition and a local elevated-session fixture.
insert into auth.sessions(id,user_id,aal) values ('88888888-aaaa-aaaa-aaaa-aaaaaaaaaaaa','88888888-7777-7777-7777-777777777777','aal2');
select set_config('request.jwt.claims','{"sub":"88888888-7777-7777-7777-777777777777","role":"authenticated","aal":"aal1","session_id":"88888888-aaaa-aaaa-aaaa-aaaaaaaaaaaa","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_performance()$$,'P0001','ADMIN_REQUIRED','admin role without MFA cannot read performance');
reset role;
select set_config('request.jwt.claims','{"sub":"88888888-7777-7777-7777-777777777777","role":"authenticated","aal":"aal2","session_id":"88888888-aaaa-aaaa-aaaa-aaaaaaaaaaaa","app_metadata":{"role":"admin"}}',true);

create function pg_temp.performance() returns jsonb language plpgsql as $$ begin
  return public.get_admin_performance(90,'performance-test','all',false,'all');
exception when undefined_function then return null; end $$;
set local role authenticated;
select is((pg_temp.performance()->'growth'->>'newMembers')::int,4,'seed review and admin accounts are excluded');
select is((pg_temp.performance()->'activity'->>'dau')::int,1,'today uses UTC and distinct members');
select is((pg_temp.performance()->'activity'->>'wau')::int,4,'weekly active users are not summed across days');
select is((pg_temp.performance()->'activity'->>'mau')::int,4,'monthly users come from visits not signups');
select is((pg_temp.performance()->'retention'->0->>'eligible')::int,3,'D1 excludes an incomplete target day');
select is((pg_temp.performance()->'retention'->1->>'eligible')::int,2,'D7 excludes young cohorts');
select is((pg_temp.performance()->'retention'->1->>'returned')::int,1,'D7 checks the exact return day');
select is((pg_temp.performance()->'retention'->2->>'eligible')::int,1,'only mature D30 cohorts enter the denominator');
select is((pg_temp.performance()->'retention'->2->>'returned')::int,1,'D30 does not count an arbitrary later visit');
select is((pg_temp.performance()->'notifications'->>'pushOpens')::int,null,'uncollected push opens are not zero');
select is((pg_temp.performance()->'growth'->>'sourceStartedAt')::timestamptz,null,'source attribution remains pending before a tracked batch');
select throws_ok($$select public.get_admin_performance(100000)$$,'P0001','INVALID_ANALYTICS_FILTER','query windows are bounded');
select throws_ok($$select public.get_admin_performance(7,null,'all',false,'untrusted')$$,'P0001','INVALID_ANALYTICS_FILTER','platforms are whitelisted');
reset role;

insert into private.performance_targets(kind,city_id,target_id,name)
values('place','performance-test','osm:node:987654321','검증 장소');
insert into public.ticketmaster_event_cache(cache_key,payload,expires_at) values
('tm-event:toronto:performance-event','{"event":{"id":"performance-event","name":"검증 행사","country":"CA","city":"Toronto"}}',now()+interval '15 minutes'),
('tm-event:toronto:performance-wrong-city','{"event":{"id":"performance-wrong-city","name":"다른 도시 행사","country":"CA","city":"Vancouver"}}',now()+interval '15 minutes');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on)
values('88888888-bbbb-bbbb-bbbb-bbbbbbbbbbbb','88888888-2222-2222-2222-222222222222','performance-test',
  (select id from public.tags order by id limit 1),'검증 글','로컬 검사에만 쓰는 글',(now() at time zone 'UTC')::date);
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on)
select ('88888888-bbbb-bbbb-bbbb-bbbbbbbbbbb'||n)::uuid,'88888888-2222-2222-2222-222222222222','performance-test',
  (select id from public.tags order by id limit 1),'검증 글','로컬 검사에만 쓰는 글',(now() at time zone 'UTC')::date-n
from generate_series(2,4) n;
insert into public.notifications(id,user_id,kind,actor_id,target_type,target_id,body,created_at) values
('88888888-0001-0000-0000-000000000001','88888888-1111-1111-1111-111111111111','post_like','88888888-2222-2222-2222-222222222222','post','88888888-bbbb-bbbb-bbbb-bbbbbbbbbbbb','검증 알림',now()-interval '2 hours'),
('88888888-0002-0000-0000-000000000002','88888888-1111-1111-1111-111111111111','post_like','88888888-2222-2222-2222-222222222222','post','88888888-bbbb-bbbb-bbbb-bbbbbbbbbbb2','검증 알림',now()-interval '1 hour'),
('88888888-0003-0000-0000-000000000003','88888888-1111-1111-1111-111111111111','post_like','88888888-2222-2222-2222-222222222222','post','88888888-bbbb-bbbb-bbbb-bbbbbbbbbbb3','수집 전 알림',now()-interval '4 hours'),
('88888888-0004-0000-0000-000000000004','88888888-1111-1111-1111-111111111111','post_like','88888888-2222-2222-2222-222222222222','post','88888888-bbbb-bbbb-bbbb-bbbbbbbbbbb4','실패 알림',now()-interval '1 hour'),
('88888888-0005-0000-0000-000000000005','88888888-3333-3333-3333-333333333333','post_like','88888888-2222-2222-2222-222222222222','post','88888888-bbbb-bbbb-bbbb-bbbbbbbbbbbb','다른 회원 알림',now());

select set_config('request.jwt.claims','{"sub":"88888888-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select is(public.record_product_event('place_view','osm:node:987654321','performance-test','ios'),true,'a registered place is recorded');
select is(public.record_product_event('place_view','osm:node:987654321','performance-test','ios'),false,'repeat daily place views do not inflate counts');
select throws_ok($$select public.record_product_event('place_view','osm:node:0','performance-test','ios')$$,'P0001','PLACE_NOT_FOUND','unknown places are rejected');
select throws_ok($$select public.record_product_event('place_view','a private search','performance-test','ios')$$,'P0001','INVALID_PRODUCT_EVENT','arbitrary target text is rejected');
select throws_ok($$select public.record_product_event('place_view','osm:node:987654321','toronto','ios')$$,'P0001','PLACE_NOT_FOUND','a valid ID cannot spoof another city');
select throws_ok($$select public.record_product_event('map_error','private coordinates',null,'ios')$$,'P0001','INVALID_PRODUCT_EVENT','failure events reject private payloads');
select throws_ok($$select public.record_product_event('map_error',null,null,'untrusted')$$,'P0001','INVALID_PRODUCT_EVENT','product platforms are bounded');
select is(public.record_product_event('map_error',null,null,'ios'),true,'error collection derives its city without private client input');
select is(public.record_product_event('event_view','performance-event','toronto','ios'),true,'a trusted cached event can be recorded');
select throws_ok($$select public.record_product_event('event_view','performance-wrong-city','toronto','ios')$$,'P0001','EVENT_NOT_FOUND','a mismatched event venue cannot be attributed to another city');
select is(public.record_product_event('notification_push_open','88888888-0005-0000-0000-000000000005',null,'ios'),false,'foreign notification opens are not recorded');
select is(public.record_product_event('notification_push_open','88888888-0001-0000-0000-000000000001',null,'ios'),true,'an owned visible notification is recorded');
select is(public.record_product_event('notification_push_open','88888888-0001-0000-0000-000000000001',null,'android'),false,'multiple devices do not duplicate a push open');
select is(public.record_product_event('notification_inbox_open','88888888-0001-0000-0000-000000000001',null,'ios'),true,'inbox and push entrances remain distinct');
select lives_ok($$select public.record_behavior_events('performance-source-session','ios','[{"seq":1,"screen":"places","kind":"view","target":"screen","value":1}]','instagram')$$,'the explicit source overload accepts a fixed code');
select throws_ok($$select public.record_behavior_events('performance-source-session','ios','[{"seq":2,"screen":"places","kind":"view","target":"screen","value":1}]','a private URL')$$,'P0001','INVALID_BEHAVIOR','source attribution rejects arbitrary text');
select lives_ok($$select public.record_behavior_events('performance-old-client-session','ios','[{"seq":1,"screen":"feed","kind":"view","target":"screen","value":1}]')$$,'old three-argument clients remain compatible');
select lives_ok($$select public.record_behavior_events('performance-place-control-session','ios','[{"seq":1,"screen":"places","kind":"press","target":"places.category.food","value":1}]','direct')$$,'actual place controls remain in the server allowlist');
select lives_ok($$select public.record_app_visit('ios','place-detail','1.2.3(65)')$$,'the real native version and places screen are accepted');
update public.notifications set read_at=now() where user_id=auth.uid();
reset role;
select is((select count(*)::int from private.product_events where kind like 'notification_%'),2,'bulk inbox reads do not create opens');
update private.product_events set day=(now() at time zone 'UTC')::date-1 where kind='notification_push_open';
select set_config('request.jwt.claims','{"sub":"88888888-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select is(public.record_product_event('notification_push_open','88888888-0001-0000-0000-000000000001',null,'ios'),false,'a push retry on another day remains one open');
reset role;
select is((select source from private.behavior_events where session_id='performance-source-session'),'instagram','a source is attached only to the validated batch');
select is((select source from private.behavior_events where session_id='performance-old-client-session'),null,'older untracked clients do not acquire invented sources');
update private.behavior_events set created_at=now()-interval '3 hours' where session_id='performance-source-session';
insert into auth.sessions(id,user_id,aal) values
('88888888-dddd-dddd-dddd-dddddddddddd','88888888-1111-1111-1111-111111111111','aal1');
insert into private.push_devices(id,user_id,session_id,token) values
('88888888-eeee-eeee-eeee-eeeeeeeeeee1','88888888-1111-1111-1111-111111111111','88888888-dddd-dddd-dddd-dddddddddddd','ExpoPushToken[performance-device-one]'),
('88888888-eeee-eeee-eeee-eeeeeeeeeee2','88888888-1111-1111-1111-111111111111','88888888-dddd-dddd-dddd-dddddddddddd','ExpoPushToken[performance-device-two]');
insert into private.push_delivery_queue(notification_id,device_id,status,created_at) values
('88888888-0001-0000-0000-000000000001','88888888-eeee-eeee-eeee-eeeeeeeeeee1','provider_accepted',now()-interval '2 hours'),
('88888888-0001-0000-0000-000000000001','88888888-eeee-eeee-eeee-eeeeeeeeeee2','failed',now()-interval '2 hours'),
('88888888-0002-0000-0000-000000000002','88888888-eeee-eeee-eeee-eeeeeeeeeee1','provider_accepted',now()-interval '1 hour'),
('88888888-0003-0000-0000-000000000003','88888888-eeee-eeee-eeee-eeeeeeeeeee1','provider_accepted',now()-interval '4 hours'),
('88888888-0004-0000-0000-000000000004','88888888-eeee-eeee-eeee-eeeeeeeeeee1','failed',now()-interval '1 hour');
insert into private.payment_events(id,user_id,event_type,environment,store,product_id,transaction_id,currency,amount,occurred_at) values
('performance-payment-one','88888888-1111-1111-1111-111111111111','INITIAL_PURCHASE','PRODUCTION','APP_STORE','com.dlwpdl.gling.plus.monthly','performance-sale-one','CAD',5,now()),
('performance-payment-repeat','88888888-1111-1111-1111-111111111111','INITIAL_PURCHASE','PRODUCTION','APP_STORE','com.dlwpdl.gling.plus.monthly','performance-sale-one','CAD',5,now()),
('performance-payment-renew','88888888-1111-1111-1111-111111111111','RENEWAL','PRODUCTION','APP_STORE','com.dlwpdl.gling.plus.monthly','performance-sale-two','CAD',5,now()),
('performance-payment-sandbox','88888888-2222-2222-2222-222222222222','INITIAL_PURCHASE','SANDBOX','APP_STORE','com.dlwpdl.gling.plus.monthly','performance-sandbox','CAD',100,now()),
('performance-payment-usd','88888888-2222-2222-2222-222222222222','INITIAL_PURCHASE','PRODUCTION','PLAY_STORE','gling_plus:yearly','performance-sale-usd','USD',4,now()),
('performance-payment-cancel','88888888-1111-1111-1111-111111111111','CANCELLATION','PRODUCTION','APP_STORE','com.dlwpdl.gling.plus.monthly','performance-cancel','CAD',-5,now()),
('performance-business-initial','88888888-3333-3333-3333-333333333333','INITIAL_PURCHASE','PRODUCTION','APP_STORE','com.dlwpdl.gling.business.plus.monthly.v2','performance-business-one','CAD',20,now()),
('performance-business-renew','88888888-3333-3333-3333-333333333333','RENEWAL','PRODUCTION','APP_STORE','com.dlwpdl.gling.business.plus.monthly.v2','performance-business-two','CAD',20,now()),
('performance-business-cancel','88888888-3333-3333-3333-333333333333','CANCELLATION','PRODUCTION','PLAY_STORE','gling_business_plus_v2:monthly','performance-business-cancel','CAD',0,now()),
('performance-unknown-product','88888888-3333-3333-3333-333333333333','INITIAL_PURCHASE','PRODUCTION','APP_STORE','unrecognized_product','performance-unknown-product','CAD',100,now());
select set_config('request.jwt.claims','{"sub":"88888888-7777-7777-7777-777777777777","role":"authenticated","aal":"aal2","session_id":"88888888-aaaa-aaaa-aaaa-aaaaaaaaaaaa","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((pg_temp.performance()->'notifications'->>'providerAccepted')::int,3,'provider acceptance counts notices rather than devices');
select is((pg_temp.performance()->'notifications'->>'failed')::int,1,'one failed device does not mark an accepted notice as failed');
select is((pg_temp.performance()->'notifications'->>'pushOpens')::int,1,'only the actual push entrance is counted');
select is((pg_temp.performance()->'notifications'->>'clickRate')::numeric,50.0::numeric,'CTR excludes sends before the member was observed on tracked code');
select is((public.get_admin_performance(90,'performance-test','all',false,'ios')->'notifications'->>'clickRate')::numeric,null,'platform-specific CTR is unavailable without device-platform denominators');
select is((pg_temp.performance()->'revenue'->'currencies'->0->>'amount')::numeric,10::numeric,'sandbox and duplicate transaction IDs cannot inflate revenue');
select is((pg_temp.performance()->'revenue'->'currencies'->1->>'currency'),'USD','different currencies are never summed together');
select is((pg_temp.performance()->'revenue'->>'refunds')::numeric,null,'cancellation is not reported as an invented refund');
select is((pg_temp.performance()->'revenue'->>'renewals')::int,1,'business renewals do not enter general membership totals');
select is((pg_temp.performance()->'revenue'->>'cancellations')::int,1,'business cancellations remain outside general membership');
select is((pg_temp.performance()->'revenue'->>'paidConversion')::numeric,50.0::numeric,'business and unknown products cannot create a general paid conversion');
reset role;

insert into private.payment_events(id,user_id,event_type,environment,store,product_id,transaction_id,currency,amount,occurred_at) values
('performance-general-v2-apple','88888888-1111-1111-1111-111111111111','RENEWAL','PRODUCTION','APP_STORE','com.dlwpdl.gling.general.pro.monthly.v2','performance-general-apple','CAD',6,now()),
('performance-general-v2-play','88888888-2222-2222-2222-222222222222','INITIAL_PURCHASE','PRODUCTION','PLAY_STORE','gling_general_plus_v2:monthly','performance-general-play','CAD',4,now());
set local role authenticated;
select is((pg_temp.performance()->'revenue'->'currencies'->0->>'amount')::numeric,20::numeric,'both stores current general plan identifiers are included');
reset role;

update public.profiles set city_id='toronto' where id='88888888-1111-1111-1111-111111111111';
set local role authenticated;
select is((public.get_admin_performance(90,'toronto')->'notifications'->>'pushOpens')::int,1,'notification opens and their recipient denominator use the same current member city');
select is((public.get_admin_performance(90,'toronto')->'quality'->'failures'->0->>'members')::int,1,'affected members follow the current member filter after a city change');
select is((pg_temp.performance()->'discovery'->'rows'->0->>'views')::int,1,'discovery still follows the actual target city after a member moves');
reset role;

insert into private.product_events(user_id,kind,platform)
values('88888888-4444-4444-4444-444444444444','map_error','web');
update public.profiles set account_status='deleted' where id='88888888-4444-4444-4444-444444444444';
select is((select count(*)::int from private.product_events where user_id='88888888-4444-4444-4444-444444444444'),0,'soft account deletion erases product records');
select set_config('request.jwt.claims','{"sub":"88888888-4444-4444-4444-444444444444","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.record_product_event('map_error',null,null,'web')$$,'P0001','ACCOUNT_LOCKED','deleted accounts cannot resume product tracking');
reset role;

select * from finish();
rollback;
