begin;
set local search_path=public,extensions;
select no_plan();

-- 동네 말풍선 지도: A owner, B A's friend, C a stranger, P an operated character, D blocked by A, E–I neighbours with bubbles, J a traveller.
insert into public.cities values('live-test','Live test','BC','America/Vancouver',true);
insert into auth.users(id,email) values
 ('e5200000-0000-4000-8000-000000000001','live-a@example.test'),('e5200000-0000-4000-8000-000000000002','live-b@example.test'),
 ('e5200000-0000-4000-8000-000000000003','live-c@example.test'),('e5200000-0000-4000-8000-000000000004','live-persona@example.test'),
 ('e5200000-0000-4000-8000-000000000005','live-d@example.test'),('e5200000-0000-4000-8000-000000000006','live-e@example.test'),
 ('e5200000-0000-4000-8000-000000000007','live-f@example.test'),('e5200000-0000-4000-8000-000000000008','live-g@example.test'),
 ('e5200000-0000-4000-8000-000000000009','live-h@example.test'),('e5200000-0000-4000-8000-000000000010','live-i@example.test'),
 ('e5200000-0000-4000-8000-000000000011','live-j@example.test');
update auth.users set raw_app_meta_data='{"gling_persona":true}' where id='e5200000-0000-4000-8000-000000000004';
insert into public.profiles(id,nickname,city_id) values
 ('e5200000-0000-4000-8000-000000000001','LiveA','live-test'),('e5200000-0000-4000-8000-000000000002','LiveB','live-test'),
 ('e5200000-0000-4000-8000-000000000003','LiveC','live-test'),('e5200000-0000-4000-8000-000000000004','LivePersona','live-test'),
 ('e5200000-0000-4000-8000-000000000005','LiveD','live-test'),('e5200000-0000-4000-8000-000000000006','LiveE','live-test'),
 ('e5200000-0000-4000-8000-000000000007','LiveF','live-test'),('e5200000-0000-4000-8000-000000000008','LiveG','live-test'),
 ('e5200000-0000-4000-8000-000000000009','LiveH','live-test'),('e5200000-0000-4000-8000-000000000010','LiveI','live-test'),
 ('e5200000-0000-4000-8000-000000000011','LiveJ','live-test');
insert into private.friendships(user_low_id,user_high_id,requester_id,created_at,accepted_at)
 values('e5200000-0000-4000-8000-000000000001','e5200000-0000-4000-8000-000000000002','e5200000-0000-4000-8000-000000000001',now(),now());
insert into public.blocks(blocker_id,blocked_id) values('e5200000-0000-4000-8000-000000000001','e5200000-0000-4000-8000-000000000005');
-- Neighbours' bubbles around 49.2627,-123.1007 (written directly; the members' own posts below go through the function).
insert into private.live_bubbles(id,author_id,city_id,body,latitude,longitude,audience,expires_at) values
 ('e5210000-0000-4000-8000-000000000004','e5200000-0000-4000-8000-000000000004','live-test','운영 캐릭터',49.2630,-123.1010,'city',now()+interval '1 hour'),
 ('e5210000-0000-4000-8000-000000000005','e5200000-0000-4000-8000-000000000005','live-test','차단된 사람',49.2631,-123.1011,'city',now()+interval '1 hour'),
 ('e5210000-0000-4000-8000-000000000006','e5200000-0000-4000-8000-000000000006','live-test','커피 한잔',49.2632,-123.1012,'city',now()+interval '1 hour'),
 ('e5210000-0000-4000-8000-000000000007','e5200000-0000-4000-8000-000000000007','live-test','산책해요',49.2633,-123.1013,'city',now()+interval '1 hour'),
 ('e5210000-0000-4000-8000-000000000008','e5200000-0000-4000-8000-000000000008','live-test','보드게임',49.2634,-123.1014,'city',now()+interval '1 hour'),
 ('e5210000-0000-4000-8000-000000000009','e5200000-0000-4000-8000-000000000009','live-test','맛집 추천',49.2635,-123.1015,'city',now()+interval '1 hour'),
 ('e5210000-0000-4000-8000-000000000010','e5200000-0000-4000-8000-000000000010','live-test','동네 친구',49.2636,-123.1016,'city',now()+interval '1 hour');
-- Earlier bubbles for the speed check: C posted 10 minutes ago here, J three hours ago 50 km north.
insert into private.live_bubbles(author_id,city_id,body,latitude,longitude,audience,created_at,expires_at,ended_at) values
 ('e5200000-0000-4000-8000-000000000003','live-test','아까',49.2627,-123.1007,'city',now()-interval '10 minutes',now()+interval '20 minutes',now()-interval '5 minutes'),
 ('e5200000-0000-4000-8000-000000000011','live-test','멀리서',49.7120,-123.1007,'city',now()-interval '3 hours',now()-interval '2 hours',now()-interval '2 hours');

-- Nobody reads or writes the tables directly, and no table keeps where the phone actually was.
select ok(not has_table_privilege('authenticated','private.live_bubbles','select'),'bubbles are not directly readable');
select ok(not has_table_privilege('authenticated','private.live_bubble_waves','select'),'waves are not directly readable');
select ok(not has_function_privilege('anon','public.get_live_map(text)','execute'),'visitors without an account see no bubbles');
select ok(not has_function_privilege('authenticated','public.get_live_bubble_safety_content(uuid)','execute'),'members cannot read the safety copy');
select is((select count(*)::int from information_schema.columns where table_schema='private' and table_name like 'live_bubble%' and column_name ~ 'origin|accuracy'),0,
  'only the shown point is stored, never the place the phone reported');

set local role authenticated;
-- A leaves a city-wide bubble 50 m from where the phone is; B a friends-only one.
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('live.a',public.post_live_bubble('live-test','커피 한잔 할 사람','city',60,49.2627,-123.1007,49.26315,-123.1007,'member')::text,true);
select throws_ok($$select public.post_live_bubble('live-test','멀리','city',60,49.2627,-123.1007,49.2641,-123.1007,'member')$$,'P0001','LOCATION_UNAVAILABLE','a bubble more than 100 m from the phone is refused');
select throws_ok($$select public.post_live_bubble('live-test','어디','city',60,49.2627,-123.1007,null,null,'member')$$,'P0001','LOCATION_UNAVAILABLE','a member must send where the phone is');
select throws_ok($$select public.post_live_bubble('live-test','핀','city',60,49.2627,-123.1007,49.2627,-123.1007,'pin')$$,'P0001','ADMIN_REQUIRED','only admins place a 관리자 핀');
select throws_ok($$select public.post_live_bubble('live-test',repeat('가',41),'city',60,49.2627,-123.1007,49.2627,-123.1007,'member')$$,'P0001','INVALID_BODY','41 characters is too long');
select throws_ok($$select public.post_live_bubble('live-test','좋아','city',45,49.2627,-123.1007,49.2627,-123.1007,'member')$$,'P0001','INVALID_BUBBLE','only 30 minutes, 1 hour or 3 hours');
select is(public.get_live_map('live-test')->'mine'->>'id',current_setting('live.a'),'A sees the bubble as her own');
select ok((public.get_live_map('live-test')->'mine'->>'expiresAt')::timestamptz between now()+interval '59 minutes' and now()+interval '61 minutes','it stays up for the chosen hour');
select is(public.extend_live_bubble(),now()+interval '2 hours','1시간 더 띄우기 adds an hour');
select is(public.extend_live_bubble(),now()+interval '3 hours','and never past 3 hours from now');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('live.b',public.post_live_bubble('live-test','친구만 봐요','friends',30,49.2629,-123.1009,49.2629,-123.1009,'member')::text,true);

-- Impossible speed: C was here 10 minutes ago, so a bubble from 50 km away now is refused; J's 50 km over 3 hours is fine.
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.post_live_bubble('live-test','순간이동','city',30,49.7120,-123.1007,49.7120,-123.1007,'member')$$,'P0001','LOCATION_UNAVAILABLE','50 km in 10 minutes is refused');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select ok(public.post_live_bubble('live-test','돌아왔어요','city',30,49.2627,-123.1007,49.2627,-123.1007,'member') is not null,'50 km over three hours is allowed');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.post_live_bubble('live-test','안녕','city',30,49.2627,-123.1007,49.2627,-123.1007,'member')$$,'P0001','PERSONA_NOT_ALLOWED','an operated character cannot post');
select throws_ok($$select public.send_live_bubble_request(current_setting('live.a')::uuid,0)$$,'P0001','PERSONA_NOT_ALLOWED','nor ask anyone');

-- Who sees what.
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select ok(public.get_live_map('live-test')->'bubbles' @> jsonb_build_array(jsonb_build_object('id',current_setting('live.a'))),'a city-wide bubble reaches a stranger');
select ok(not public.get_live_map('live-test')->'bubbles' @> jsonb_build_array(jsonb_build_object('id',current_setting('live.b'))),'a friends-only bubble does not');
select ok(not public.get_live_map('live-test')->'bubbles' @> '[{"id":"e5210000-0000-4000-8000-000000000004"}]','an operated character never appears');
select is(public.get_live_map('live-test')->'mine','null'::jsonb,'C has no bubble up (the earlier one went down)');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select ok(public.get_live_map('live-test')->'bubbles' @> jsonb_build_array(jsonb_build_object('id',current_setting('live.b'))),'a friend sees the friends-only bubble');
select ok(not public.get_live_map('live-test')->'bubbles' @> '[{"id":"e5210000-0000-4000-8000-000000000005"}]','the person A blocked is gone from her map');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select ok(not public.get_live_map('live-test')->'bubbles' @> jsonb_build_array(jsonb_build_object('id',current_setting('live.a'))),'and A is gone from the blocked person''s map');
select throws_ok($$select public.wave_live_bubble(current_setting('live.a')::uuid)$$,'P0001','BUBBLE_GONE','a blocked person cannot wave');
select throws_ok($$select public.send_live_bubble_request(current_setting('live.a')::uuid,0)$$,'P0001','BUBBLE_GONE','or ask for a chat');

-- Others cannot edit or delete my bubble.
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$update private.live_bubbles set body='바꿈'$$,'42501',null,'nobody edits a bubble directly');
select throws_ok($$delete from private.live_bubbles$$,'42501',null,'nobody deletes a bubble directly');
select lives_ok($$select public.end_live_bubble()$$,'내리기 only ever touches your own bubble');
select ok(public.get_live_map('live-test')->'bubbles' @> jsonb_build_array(jsonb_build_object('id',current_setting('live.a'))),'A''s bubble is still up');

-- 👋 Once per bubble; only the owner sees who waved; 20 a day, apart from chat requests.
select set_config('live.wave',public.wave_live_bubble(current_setting('live.a')::uuid)::text,true);
select throws_ok($$select public.wave_live_bubble(current_setting('live.a')::uuid)$$,'P0001','ALREADY_WAVED','the same bubble cannot be waved at twice');
select ok((select b->>'waved' from jsonb_array_elements(public.get_live_map('live-test')->'bubbles') b where b->>'id'=current_setting('live.a'))='true','C sees that she waved');
select is((public.get_live_map('live-test')->>'requestsLeft')::int,5,'a wave is not a chat request');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select b - 'sent' - 'createdAt' - 'expiresAt' - 'author' from jsonb_array_elements(public.get_live_map('live-test')->'bubbles') b where b->>'id'=current_setting('live.a')),
  jsonb_build_object('id',current_setting('live.a'),'body','커피 한잔 할 사람','latitude',49.2627,'longitude',-123.1007,'audience','city','kind','member','waved',false),
  'someone else sees no waver and no count on A''s bubble');
select is(public.get_live_map('live-test')->'waves','[]'::jsonb,'and no waves of their own bubble yet');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.get_live_map('live-test')->'waves'->0->'sender'->>'id','e5200000-0000-4000-8000-000000000003','the owner sees who waved');
reset role;
select is((select category from public.notifications where user_id='e5200000-0000-4000-8000-000000000001' and kind='live_bubble_wave'),'post_likes','the owner is told, under the like setting');
insert into public.notification_preferences(user_id,post_likes) values('e5200000-0000-4000-8000-000000000001',false)
  on conflict(user_id) do update set post_likes=false;
-- C has waved once; count 19 so her next wave is the twentieth of the day.
update private.live_bubble_quota set waves=19 where user_id='e5200000-0000-4000-8000-000000000003' and day=private.live_day('live-test');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select lives_ok($$select public.wave_live_bubble(current_setting('live.a')::uuid)$$,'E waves too');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select lives_ok($$select public.wave_live_bubble('e5210000-0000-4000-8000-000000000006')$$,'the twentieth wave of the day goes out');
select throws_ok($$select public.wave_live_bubble('e5210000-0000-4000-8000-000000000007')$$,'P0001','WAVE_LIMIT','the twenty-first does not');
select is((public.get_live_map('live-test')->>'wavesLeft')::int,0,'no waves left today');
reset role;
select is((select count(*)::int from public.notifications where user_id='e5200000-0000-4000-8000-000000000001' and kind='live_bubble_wave'),1,'with 좋아요 off, the next wave rings no bell');

-- Five chat requests a day, counted when sent and never refunded.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('live.r1',public.send_live_bubble_request(current_setting('live.a')::uuid,0)::text,true);
select throws_ok($$select public.send_live_bubble_request(current_setting('live.a')::uuid,1)$$,'P0001','ALREADY_SENT','one request per bubble');
select throws_ok($$select public.send_live_bubble_request('e5210000-0000-4000-8000-000000000006',7)$$,'P0001','INVALID_GREETING','only the offered greetings');
select lives_ok($$select public.cancel_live_bubble_request(current_setting('live.r1')::uuid)$$,'a request can be taken back');
select is((public.get_live_map('live-test')->>'requestsLeft')::int,4,'but it still counts');
select set_config('live.re',public.send_live_bubble_request('e5210000-0000-4000-8000-000000000006',0)::text,true);
select set_config('live.rf',public.send_live_bubble_request('e5210000-0000-4000-8000-000000000007',1)::text,true);
select lives_ok($$select public.send_live_bubble_request('e5210000-0000-4000-8000-000000000008',2)$$,'fourth request');
select lives_ok($$select public.send_live_bubble_request('e5210000-0000-4000-8000-000000000009',0)$$,'fifth request');
select throws_ok($$select public.send_live_bubble_request('e5210000-0000-4000-8000-000000000010',0)$$,'P0001','REQUEST_LIMIT','the sixth of the day is refused');
reset role;
select is((select route from public.notifications where user_id='e5200000-0000-4000-8000-000000000006' and kind='live_bubble_request'),
  '/discover?bubbleRequest='||current_setting('live.re'),'the receiver is told and the alert opens that request');

-- Accepting opens the existing 1:1 chat for both; declining says nothing more.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select is(public.get_live_map('live-test')->'received'->0->'sender'->>'nickname','LiveC','E sees who asked');
select set_config('live.conv',public.respond_live_bubble_request(current_setting('live.re')::uuid,'accepted')::text,true);
select throws_ok($$select public.respond_live_bubble_request(current_setting('live.re')::uuid,'declined')$$,'P0001','REQUEST_NOT_FOUND','an answered request cannot be answered again');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000007","role":"authenticated"}',true);
select is(public.respond_live_bubble_request(current_setting('live.rf')::uuid,'declined'),null,'F declines');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select b->'sent'->>'conversationId' from jsonb_array_elements(public.get_live_map('live-test')->'bubbles') b where b->>'id'='e5210000-0000-4000-8000-000000000006'),
  current_setting('live.conv'),'C sees the accepted request with its chat');
select is((select b->'sent'->>'status' from jsonb_array_elements(public.get_live_map('live-test')->'bubbles') b where b->>'id'='e5210000-0000-4000-8000-000000000007'),'declined','C sees only that F declined');
reset role;
select ok(exists(select 1 from public.conversations c where c.id=current_setting('live.conv')::uuid and c.kind='direct' and c.status='active'
  and c.user_low_id=least('e5200000-0000-4000-8000-000000000003'::uuid,'e5200000-0000-4000-8000-000000000006'::uuid)
  and c.user_high_id=greatest('e5200000-0000-4000-8000-000000000003'::uuid,'e5200000-0000-4000-8000-000000000006'::uuid)),'accepting opened the ordinary 1:1 chat between them');
select is((select route from public.notifications where user_id='e5200000-0000-4000-8000-000000000003' and kind='live_bubble_accepted'),'/chat?conversationId='||current_setting('live.conv'),'the sender is told and taken to the chat');
select is((select count(*)::int from public.notifications where user_id='e5200000-0000-4000-8000-000000000003' and actor_id='e5200000-0000-4000-8000-000000000007'),0,'a decline sends no alert');

-- The owner answers a wave with a chat request (one of her five); C sees it as a reply to her wave.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('live.reply',public.reply_live_bubble_wave(current_setting('live.wave')::uuid)::text,true);
select is((public.get_live_map('live-test')->>'requestsLeft')::int,4,'answering a wave uses one of the owner''s five');
select is(public.get_live_map('live-test')->'waves'->0->'reply'->>'status','pending','the owner sees her answer waiting');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select r->>'waveReply' from jsonb_array_elements(public.get_live_map('live-test')->'received') r where r->>'id'=current_setting('live.reply')),'true','C sees "내 손 흔들기에 답했어요"');

-- No requests once a bubble has gone down.
reset role;
update private.live_bubbles set created_at=now()-interval '2 hours',expires_at=now()-interval '1 minute' where id='e5210000-0000-4000-8000-000000000010';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.send_live_bubble_request('e5210000-0000-4000-8000-000000000010',0)$$,'P0001','BUBBLE_GONE','an expired bubble takes no requests');
select throws_ok($$select public.wave_live_bubble('e5210000-0000-4000-8000-000000000010')$$,'P0001','BUBBLE_GONE','or waves');
select ok(not public.get_live_map('live-test')->'bubbles' @> '[{"id":"e5210000-0000-4000-8000-000000000010"}]','and is off the map');

-- Three different people reporting a bubble take it down at once.
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select lives_ok($$select public.create_report('live_bubble','e5210000-0000-4000-8000-000000000009','spam',null)$$,'first report');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select lives_ok($$select public.create_report('live_bubble','e5210000-0000-4000-8000-000000000009','spam',null)$$,'second report');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select ok(public.get_live_map('live-test')->'bubbles' @> '[{"id":"e5210000-0000-4000-8000-000000000009"}]','two reports leave it up for others');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000007","role":"authenticated"}',true);
select lives_ok($$select public.create_report('live_bubble','e5210000-0000-4000-8000-000000000009','harassment',null)$$,'third report');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select ok(not public.get_live_map('live-test')->'bubbles' @> '[{"id":"e5210000-0000-4000-8000-000000000009"}]','the third takes it off the map');
reset role;
select ok((select hidden_at is not null and ended_at is not null from private.live_bubbles where id='e5210000-0000-4000-8000-000000000009'),'it is marked hidden for the report queue');
select is((select count(*)::int from private.live_bubble_requests where bubble_id='e5210000-0000-4000-8000-000000000009' and status='pending'),0,'its unanswered request went with it');
select is((select evidence->>'body' from public.reports where target_type='live_bubble' limit 1),'맛집 추천','the report keeps a copy of the line');
select ok(exists(select 1 from public.safety_review_queue where target_type='live_bubble' and target_id=current_setting('live.a')::uuid),'every bubble line enters the safety review queue');

-- 내리기: waves and unanswered requests go with the bubble.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.end_live_bubble()$$,'A takes her bubble down');
select is(public.get_live_map('live-test')->'mine','null'::jsonb,'it is gone');
reset role;
select is((select count(*)::int from private.live_bubble_waves where bubble_id=current_setting('live.a')::uuid),0,'its waves went with it');
select is((select count(*)::int from private.live_bubble_requests where bubble_id=current_setting('live.a')::uuid and status='pending'),0,'and so did the unanswered answer to C');

select * from finish();
rollback;
