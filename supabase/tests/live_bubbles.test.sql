begin;
set local search_path=public,extensions;
select no_plan();

-- 동네 말풍선 지도: A owner, B A's friend, C a stranger, P an operated character, D blocked by A, E–I neighbours with bubbles, J a traveller,
-- K1–K3 accounts made today, M an admin, N someone who used to be one. Everyone but K1–K3 signed up a month ago.
insert into public.cities values('live-test','Live test','BC','America/Vancouver',true);
insert into auth.users(id,email) values
 ('e5200000-0000-4000-8000-000000000001','live-a@example.test'),('e5200000-0000-4000-8000-000000000002','live-b@example.test'),
 ('e5200000-0000-4000-8000-000000000003','live-c@example.test'),('e5200000-0000-4000-8000-000000000004','live-persona@example.test'),
 ('e5200000-0000-4000-8000-000000000005','live-d@example.test'),('e5200000-0000-4000-8000-000000000006','live-e@example.test'),
 ('e5200000-0000-4000-8000-000000000007','live-f@example.test'),('e5200000-0000-4000-8000-000000000008','live-g@example.test'),
 ('e5200000-0000-4000-8000-000000000009','live-h@example.test'),('e5200000-0000-4000-8000-000000000010','live-i@example.test'),
 ('e5200000-0000-4000-8000-000000000011','live-j@example.test'),('e5200000-0000-4000-8000-000000000012','live-k1@example.test'),
 ('e5200000-0000-4000-8000-000000000013','live-k2@example.test'),('e5200000-0000-4000-8000-000000000014','live-k3@example.test'),
 ('e5200000-0000-4000-8000-000000000015','live-m@example.test'),('e5200000-0000-4000-8000-000000000016','live-n@example.test');
update auth.users set created_at=case when id between 'e5200000-0000-4000-8000-000000000012' and 'e5200000-0000-4000-8000-000000000014' then now() else now()-interval '30 days' end
  where id between 'e5200000-0000-4000-8000-000000000001' and 'e5200000-0000-4000-8000-000000000016';
update auth.users set raw_app_meta_data='{"gling_persona":true}' where id='e5200000-0000-4000-8000-000000000004';
update auth.users set raw_app_meta_data='{"role":"admin"}' where id='e5200000-0000-4000-8000-000000000015';
insert into public.profiles(id,nickname,city_id) values
 ('e5200000-0000-4000-8000-000000000001','LiveA','live-test'),('e5200000-0000-4000-8000-000000000002','LiveB','live-test'),
 ('e5200000-0000-4000-8000-000000000003','LiveC','live-test'),('e5200000-0000-4000-8000-000000000004','LivePersona','live-test'),
 ('e5200000-0000-4000-8000-000000000005','LiveD','live-test'),('e5200000-0000-4000-8000-000000000006','LiveE','live-test'),
 ('e5200000-0000-4000-8000-000000000007','LiveF','live-test'),('e5200000-0000-4000-8000-000000000008','LiveG','live-test'),
 ('e5200000-0000-4000-8000-000000000009','LiveH','live-test'),('e5200000-0000-4000-8000-000000000010','LiveI','live-test'),
 ('e5200000-0000-4000-8000-000000000011','LiveJ','live-test'),('e5200000-0000-4000-8000-000000000012','LiveK1','live-test'),
 ('e5200000-0000-4000-8000-000000000013','LiveK2','live-test'),('e5200000-0000-4000-8000-000000000014','LiveK3','live-test'),
 ('e5200000-0000-4000-8000-000000000015','LiveM','live-test'),('e5200000-0000-4000-8000-000000000016','LiveN','live-test');
insert into private.admin_ids(user_id) values('e5200000-0000-4000-8000-000000000016') on conflict do nothing;
insert into auth.sessions(id,user_id,aal) values('e5260000-0000-4000-8000-000000000015','e5200000-0000-4000-8000-000000000015','aal2');
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
select is((select string_agg(pg_get_function_identity_arguments(p.oid),';') from pg_proc p where p.oid='public.post_live_bubble'::regproc),
  'p_city_id text, p_body text, p_audience text, p_minutes integer, p_latitude double precision, p_longitude double precision, p_kind text',
  'and the phone''s place is never even sent: the app checks the 100 m itself');
-- Metres between a home point and the centre of the circle through three points around it (flat at this scale).
create function pg_temp.off_centre(h_lat float8,h_lon float8,pts float8[]) returns float8 language sql immutable as $$
  with p as (select (pts[2*i]-h_lon)*111194.93*cos(radians(h_lat)) x,(pts[2*i-1]-h_lat)*111194.93 y,i from generate_series(1,3) i),
  a as (select x ax,y ay from p where i=1),b as (select x bx,y by_ from p where i=2),c as (select x cx,y cy from p where i=3)
  select sqrt(power(((ax*ax+ay*ay)*(by_-cy)+(bx*bx+by_*by_)*(cy-ay)+(cx*cx+cy*cy)*(ay-by_))/den,2)+power(((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by_*by_)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/den,2))
  from a,b,c,lateral (select 2*(ax*(by_-cy)+bx*(cy-ay)+cx*(ay-by_)) den) q
$$;

set local role authenticated;
-- A leaves a city-wide bubble; B a friends-only one.
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('live.a',public.post_live_bubble('live-test','커피 한잔 할 사람','city',60,49.2627,-123.1007,'member')::text,true);
select throws_ok($$select public.post_live_bubble('live-test','핀','city',60,49.2627,-123.1007,'pin')$$,'P0001','ADMIN_REQUIRED','only admins place a 관리자 핀');
select throws_ok($$select public.post_live_bubble('live-test',repeat('가',41),'city',60,49.2627,-123.1007,'member')$$,'P0001','INVALID_BODY','41 characters is too long');
select throws_ok($$select public.post_live_bubble('live-test','좋아','city',45,49.2627,-123.1007,'member')$$,'P0001','INVALID_BUBBLE','only 30 minutes, 1 hour or 3 hours');
select is(public.get_live_map('live-test')->'mine'->>'id',current_setting('live.a'),'A sees the bubble as her own');
select ok((public.get_live_map('live-test')->'mine'->>'expiresAt')::timestamptz between now()+interval '59 minutes' and now()+interval '61 minutes','it stays up for the chosen hour');
select is(public.extend_live_bubble(),now()+interval '2 hours','1시간 더 띄우기 adds an hour');
select is(public.extend_live_bubble(),now()+interval '3 hours','and never past 3 hours from now');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('live.b',public.post_live_bubble('live-test','친구만 봐요','friends',30,49.2629,-123.1009,'member')::text,true);

-- The review's attack (F1): three bubbles dragged to the very edge of the 100 m circle around one home, 120° apart. The exact points
-- would give that home back to a few centimetres; saved on the ~100 m grid, the centre lands tens of metres off.
select ok(pg_temp.off_centre(49.2627,-123.1007,array[49.26359,-123.1007, 49.262255,-123.099518, 49.262255,-123.101882])<1,'the exact edge points would give the home away');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000012","role":"authenticated"}',true);
select set_config('live.k1',public.post_live_bubble('live-test','북쪽 끝','city',30,49.26359,-123.1007,'member')::text,true);
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000013","role":"authenticated"}',true);
select set_config('live.k2',public.post_live_bubble('live-test','남동쪽 끝','city',30,49.262255,-123.099518,'member')::text,true);
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000014","role":"authenticated"}',true);
select set_config('live.k3',public.post_live_bubble('live-test','남서쪽 끝','city',30,49.262255,-123.101882,'member')::text,true);
reset role;
select is((select count(*)::int from private.live_bubbles where id in (current_setting('live.k1')::uuid,current_setting('live.k2')::uuid,current_setting('live.k3')::uuid)
  and latitude::numeric=round(latitude::numeric,3) and longitude::numeric=round(longitude::numeric,3)),3,'each is saved on the ~100 m grid');
select ok(pg_temp.off_centre(49.2627,-123.1007,(select array_agg(v order by b.created_at,o) from private.live_bubbles b,
  lateral (values(1,b.latitude),(2,b.longitude)) x(o,v) where b.id in (current_setting('live.k1')::uuid,current_setting('live.k2')::uuid,current_setting('live.k3')::uuid)))>20,
  'so the three saved points no longer give the home away');
-- Back near the last point (its cell or one next to it, F2): the same point again, so a home near a grid line never shows two by turns.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000012","role":"authenticated"}',true);
select lives_ok($$select public.post_live_bubble('live-test','다시 왔어요','city',30,49.26345,-123.1007,'member')$$,'K1 posts again from the next cell south');
select is((select jsonb_build_array(m->'latitude',m->'longitude') from (select public.get_live_map('live-test')->'mine' m) x),'[49.264,-123.101]'::jsonb,'and her bubble keeps its last point');
select lives_ok($$select public.post_live_bubble('live-test','이사 왔어요','city',30,49.2667,-123.1007,'member')$$,'from three cells away');
select is((select jsonb_build_array(m->'latitude',m->'longitude') from (select public.get_live_map('live-test')->'mine' m) x),'[49.267,-123.101]'::jsonb,'it moves to the new cell');
-- A point shown only to friends never comes back on a city-wide bubble (N1).
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000013","role":"authenticated"}',true);
select lives_ok($$select public.post_live_bubble('live-test','집이에요','friends',30,49.2700,-123.1007,'member')$$,'K2 posts friends-only from home');
select lives_ok($$select public.post_live_bubble('live-test','옆 카페예요','city',30,49.2711,-123.1007,'member')$$,'then city-wide from the café next door');
select is((select jsonb_build_array(m->'latitude',m->'longitude') from (select public.get_live_map('live-test')->'mine' m) x),'[49.271,-123.101]'::jsonb,
  'the café bubble keeps its own point, not the friends-only home one');
-- Between home and work: the nearby earlier point still wins over the latest far one (N2).
select lives_ok($$select public.post_live_bubble('live-test','다시 남쪽','city',30,49.2614,-123.1003,'member')$$,'back by her first city-wide spot, across its grid line');
select is((select jsonb_build_array(m->'latitude',m->'longitude') from (select public.get_live_map('live-test')->'mine' m) x),'[49.262,-123.1]'::jsonb,
  'it shows that earlier point again, though the café bubble came last');

-- 글링 pins (F5): only someone who is an admin right now with the second sign-in step, at the exact spot, and naming no admin account.
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000016","role":"authenticated"}',true);
select throws_ok($$select public.post_live_bubble('live-test','공식 안내: 여기로 오세요','city',60,43.6532,-79.3832,'pin')$$,'P0001','ADMIN_REQUIRED','someone who used to be an admin cannot place a 글링 pin');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000015","role":"authenticated","app_metadata":{"role":"admin"}}',true);
select throws_ok($$select public.post_live_bubble('live-test','공식 안내','city',60,49.26543,-123.10021,'pin')$$,'P0001','ADMIN_REQUIRED','nor an admin signed in without the second step');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000015","role":"authenticated","aal":"aal2","session_id":"e5260000-0000-4000-8000-000000000015","app_metadata":{"role":"admin"}}',true);
select set_config('live.pin',public.post_live_bubble('live-test','글링 모임 여기예요','city',60,49.26543,-123.10021,'pin')::text,true);
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select b->'author' from jsonb_array_elements(public.get_live_map('live-test')->'bubbles') b where b->>'id'=current_setting('live.pin')),
  '{"id":"gling","nickname":"글링","trustLevel":3}'::jsonb,'a pin shows 글링, never the admin account behind it');
select is((select jsonb_build_array(b->'latitude',b->'longitude') from jsonb_array_elements(public.get_live_map('live-test')->'bubbles') b where b->>'id'=current_setting('live.pin')),
  '[49.26543,-123.10021]'::jsonb,'at the exact spot the admin chose');

-- Impossible speed: C was here 10 minutes ago, so a bubble from 50 km away now is refused; J's 50 km over 3 hours is fine.
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.post_live_bubble('live-test','순간이동','city',30,49.7120,-123.1007,'member')$$,'P0001','LOCATION_UNAVAILABLE','50 km in 10 minutes is refused');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select ok(public.post_live_bubble('live-test','돌아왔어요','city',30,49.2627,-123.1007,'member') is not null,'50 km over three hours is allowed');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.post_live_bubble('live-test','안녕','city',30,49.2627,-123.1007,'member')$$,'P0001','PERSONA_NOT_ALLOWED','an operated character cannot post');
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
  jsonb_build_object('id',current_setting('live.a'),'body','커피 한잔 할 사람','latitude',49.263,'longitude',-123.101,'audience','city','kind','member','waved',false),
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

-- Reports from accounts made today don't take a bubble down (F4); they wait for an admin in the report queue.
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000012","role":"authenticated"}',true);
select lives_ok($$select public.create_report('live_bubble','e5210000-0000-4000-8000-000000000008','spam',null)$$,'a new account reports G');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000013","role":"authenticated"}',true);
select lives_ok($$select public.create_report('live_bubble','e5210000-0000-4000-8000-000000000008','spam',null)$$,'a second one');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000014","role":"authenticated"}',true);
select lives_ok($$select public.create_report('live_bubble','e5210000-0000-4000-8000-000000000008','spam',null)$$,'a third one');
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select ok(public.get_live_map('live-test')->'bubbles' @> '[{"id":"e5210000-0000-4000-8000-000000000008"}]','three accounts made today cannot take it down');
reset role;
select is((select count(*)::int from public.reports where target_type='live_bubble' and target_id='e5210000-0000-4000-8000-000000000008' and status='open'),3,'their reports wait in the queue');
set local role authenticated;

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
select is((select evidence->>'body' from public.reports where target_type='live_bubble' and target_id='e5210000-0000-4000-8000-000000000009' limit 1),'맛집 추천','the report keeps a copy of the line');
select ok(not exists(select 1 from public.reports where target_type='live_bubble' and (evidence ? 'latitude' or evidence ? 'longitude')),'but never where it sat (F3)');
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
