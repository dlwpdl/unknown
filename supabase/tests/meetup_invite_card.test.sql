begin;
set local search_path=public,extensions;
select no_plan();

select has_function('public','get_meetup_invite_card',array['uuid','text'],'a meetup invitation has its own narrow card');
select has_function('public','get_business_invite_landing',array['text'],'a shop QR code has its own narrow landing');

insert into auth.users(id,email) values
 ('9e000000-0000-4000-8000-000000000001','invite-host@example.invalid'),
 ('9e000000-0000-4000-8000-000000000002','invite-friend@example.invalid'),
 ('9e000000-0000-4000-8000-000000000003','invite-viewer@example.invalid'),
 ('9e000000-0000-4000-8000-000000000004','invite-shop@example.invalid');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'초대검사'||right(id::text,1),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '9e000000-%';
update public.profiles set nickname='지은' where id='9e000000-0000-4000-8000-000000000002';

-- One map place at Metrotown and one in Coquitlam; the catalog row is a fixture (a schema dump has no rows).
delete from private.city_place_catalog;
insert into private.city_place_catalog(id,payload,refreshed_on) values(true,jsonb_build_object('collectedAt','2026-11-13','cities',jsonb_build_object(
  'vancouver',jsonb_build_object('places',jsonb_build_array(
    jsonb_build_object('id','osm:node:9001','cityId','vancouver','name','Board game cafe','latitude',49.2271,'longitude',-123.0021),
    jsonb_build_object('id','osm:node:9002','cityId','vancouver','name','Shop cafe','latitude',49.2775,'longitude',-122.7998)),
  'regionalPlaces',jsonb_build_array(jsonb_build_object('id','osm:node:9003','cityId','vancouver','name','Far away','latitude',50.7,'longitude',-120.3))))),current_date);

-- One host opens all of them; slot and moderation triggers are not what this suite checks.
set local session_replication_role=replica;
insert into public.posts(id,author_id,city_id,tag_id,title,body,room_preview,posted_on) values
 ('9e100000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000001','vancouver',(select id from public.tags where kind='meetup' limit 1),'금요일 저녁에 보드게임 하실 분',
  E'룰은 가서 알려 드려요.\n카톡 아이디 private-contact\n처음이어도 괜찮아요.\n\n장소: Board game cafe\n장소 정보: https://www.openstreetmap.org/node/9001',
  jsonb_build_object('eventKind','once','startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 2 hours','timezone','America/Vancouver',
    'capacity',8,'memberCount',4,'fee',jsonb_build_object('amount',10,'note','private fee note'),'applicationQuestion','private question sentinel','access','public'),current_date),
 ('9e100000-0000-4000-8000-000000000002','9e000000-0000-4000-8000-000000000001','vancouver',(select id from public.tags where kind='meetup' limit 1),'초대용 모임',
  'private invite-only body',jsonb_build_object('eventKind','once','startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 2 hours','timezone','America/Vancouver','capacity',4,'memberCount',1,'access','invite'),current_date),
 ('9e100000-0000-4000-8000-000000000003','9e000000-0000-4000-8000-000000000001','vancouver',1,'그냥 글','private story body',null,current_date),
 ('9e100000-0000-4000-8000-000000000004','9e000000-0000-4000-8000-000000000001','vancouver',(select id from public.tags where kind='meetup' limit 1),'가게 보드게임 밤',
  E'가게에서 매달 모여요.\n\n장소: Shop cafe\n장소 정보: https://www.openstreetmap.org/node/9002',
  jsonb_build_object('eventKind','group','cadence','매달 둘째 목요일','capacity',6,'memberCount',2,'access','public'),current_date),
 ('9e100000-0000-4000-8000-000000000005','9e000000-0000-4000-8000-000000000001','vancouver',(select id from public.tags where kind='meetup' limit 1),'장소 없는 모임',
  E'장소는 모임 대화에서 정해요.',jsonb_build_object('eventKind','group','cadence','매주','capacity',6,'memberCount',1,'access','public'),current_date),
 ('9e100000-0000-4000-8000-000000000006','9e000000-0000-4000-8000-000000000001','vancouver',(select id from public.tags where kind='meetup' limit 1),'먼 곳 모임',
  E'멀리 가요.\n\n장소: Far away\n장소 정보: https://www.openstreetmap.org/node/9003',jsonb_build_object('eventKind','group','cadence','매주','capacity',6,'memberCount',1,'access','public'),current_date);
set local session_replication_role=origin;

-- A verified owner gives the shop a public profile before its first post (20261018037000).
update auth.users set raw_app_meta_data='{"merchant_enabled":true}' where id='9e000000-0000-4000-8000-000000000004';
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,owner_id,owner_verified_at) values
 ('9e200000-0000-4000-8000-000000000001','Invite shop','vancouver','paid','granted','Synthetic public shop','business','9e000000-0000-4000-8000-000000000004',now()),
 ('9e200000-0000-4000-8000-000000000002','Hidden shop','vancouver','paused','granted','Synthetic paused shop','business','9e000000-0000-4000-8000-000000000004',now());
insert into private.webshop_place_links(place_key,merchant_id,city_id) values('osm:node:9002','9e200000-0000-4000-8000-000000000001','vancouver');
insert into private.invite_links(code,owner_id,merchant_id) values
 ('JEUNK234','9e000000-0000-4000-8000-000000000002',null),
 ('SHPQ2345','9e000000-0000-4000-8000-000000000004','9e200000-0000-4000-8000-000000000001'),
 ('HDDE2345','9e000000-0000-4000-8000-000000000004','9e200000-0000-4000-8000-000000000002');

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001','JEUNK234'))k),
  array['area','capacity','fee','id','intro','inviter','memberCount']::text[],'the card has only its narrow fields');
select is(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001')->>'intro',E'룰은 가서 알려 드려요.\n처음이어도 괜찮아요.','the intro opening drops contact lines and the place tail');
select is(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001')->>'area','metrotown','the neighborhood comes from the picked map place');
select ok(position('Board game cafe' in public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001')::text)=0,'the picked place itself never appears');
select ok(position('private' in public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001','JEUNK234')::text)=0,'question, fee note and contacts stay private');
select is((public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001')->>'capacity')::int-(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001')->>'memberCount')::int,4,'seats left can be counted');
select is((public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001')->>'fee')::int,10,'the fee amount shows like in the app');
select is(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001','JEUNK234')->>'inviter','지은','a personal code names the member who shared');
select is(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001','SHPQ2345')->>'inviter',null,'a shop code never names its owner');
select is(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001','jeunk234')->>'inviter',null,'codes are matched exactly');
select is(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001','NQPE2345')->>'inviter',null,'an unknown code names nobody');
select is(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000002'),null::jsonb,'invite-only meetups have no public card');
select is(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000003'),null::jsonb,'stories have no meetup card');
select is(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000005')->>'area',null,'no picked place means no neighborhood');
select is(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000006')->>'area',null,'a place far from every neighborhood is not guessed');
select is(public.get_business_invite_landing('JEUNK234'),null::jsonb,'a personal code is not a shop landing');
select is(public.get_business_invite_landing('HDDE2345'),null::jsonb,'a business without a public profile has no landing');
select is(public.get_business_invite_landing('SHPQ2345')->>'name','Invite shop','the shop landing names the business');
select is(public.get_business_invite_landing('SHPQ2345')->'meetups','["9e100000-0000-4000-8000-000000000004"]'::jsonb,'only open meetups at the shop''s own map places are listed');
select ok(position('9e000000-0000-4000-8000-000000000004' in public.get_business_invite_landing('SHPQ2345')::text)=0,'the owner account is never exposed');
reset role;

-- A viewer who blocked the inviter does not see their name; a blocked host's meetup has no card.
insert into public.blocks(blocker_id,blocked_id) values('9e000000-0000-4000-8000-000000000003','9e000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"9e000000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select is(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001','JEUNK234')->>'inviter',null,'a blocked inviter is not named');
reset role;
insert into public.blocks(blocker_id,blocked_id) values('9e000000-0000-4000-8000-000000000003','9e000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001'),null::jsonb,'a blocked host''s meetup has no card');
reset role;

update public.profiles set account_status='deleted' where id='9e000000-0000-4000-8000-000000000002';
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select is(public.get_meetup_invite_card('9e100000-0000-4000-8000-000000000001','JEUNK234')->>'inviter',null,'a deleted inviter is not named');
reset role;

select * from finish();
rollback;
