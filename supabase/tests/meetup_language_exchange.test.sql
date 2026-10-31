begin;
set local search_path=public,extensions;
select no_plan();

-- 1 host, 2-3 Korean speakers, 4-5 English speakers, 6 an applicant from an app without the language step.
insert into public.cities(id,name,province,timezone) values('lang-test','Language test','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31997,'lang-test','Language test','meetup') on conflict do nothing;
insert into auth.users(id,email,raw_app_meta_data) select ('1a000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'lang-'||n||'@example.invalid','{}' from generate_series(1,6)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version,created_at)
select id,'Lang'||right(id::text,2),'lang-test',now(),now(),now(),'test',now()-interval '200 days' from auth.users where id::text like '1a000000-%';
insert into private.chilling_profiles(id,profile)
select id,'{"intro":"말 바꿔 가며 수다 떨어요","interests":["언어교환"],"promptOne":"카페","promptTwo":"주말"}' from public.profiles where id::text like '1a000000-%';
create temporary table ids as select
  '1a000000-0000-4000-8000-000000000001'::uuid h, '1a000000-0000-4000-8000-000000000002'::uuid k2, '1a000000-0000-4000-8000-000000000003'::uuid k3,
  '1a000000-0000-4000-8000-000000000004'::uuid e4, '1a000000-0000-4000-8000-000000000005'::uuid e5, '1a000000-0000-4000-8000-000000000006'::uuid o6,
  '1a100000-0000-4000-8000-000000000001'::uuid x;
grant select on ids to authenticated;
insert into private.membership_accounts(user_id,entitlements,observed_at) select h,
  jsonb_build_array(jsonb_build_object('tier','premium','kind','general','plan_version','2','expires_at',now()+interval '30 days')),now() from ids
  on conflict(user_id) do update set entitlements=excluded.entitlements,observed_at=now();
create function pg_temp.as_user(p uuid) returns void language sql as $$ select set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated')::text,true) $$;

-- 1. Seat arithmetic mirrors src/lib/meetup-language.ts languageSeats().
select is(private.meetup_language_seats('{"capacity":10,"languageExchange":{"languages":["ko","en"],"share":50}}','ko'),5,'Half of nine member seats rounds to five');
select is(private.meetup_language_seats('{"capacity":10,"languageExchange":{"languages":["ko","en"],"share":50}}','en'),4,'The other side gets the rest');
select is(private.meetup_language_seats('{"capacity":10,"languageExchange":{"languages":["ko","en"],"share":67}}','ko'),6,'2:1 of nine is six');
select is(private.meetup_language_seats('{"capacity":3,"languageExchange":{"languages":["ko","fr"],"share":90}}','fr'),1,'Each side keeps one seat');
select is(private.meetup_language_seats('{"capacity":2,"languageExchange":{"languages":["ko","en"],"share":50}}','ko'),null,'Capacity edited below three removes side limits');
select is(private.meetup_language_seats('{"capacity":10}','ko'),null,'Ordinary meetups have no side limits');
select is(private.meetup_language_exchange('{"languages":["en","fr"],"share":33}',6),'{"languages":["en","fr"],"share":33}'::jsonb,'A valid exchange is kept as sent');
select throws_ok($$select private.meetup_language_exchange('{"languages":["ko","ko"],"share":50}',6)$$,'P0001','INVALID_LANGUAGE_EXCHANGE','Two different languages are required');
select throws_ok($$select private.meetup_language_exchange('{"languages":["ko","ja"],"share":50}',6)$$,'P0001','INVALID_LANGUAGE_EXCHANGE','Only the offered languages');
select throws_ok($$select private.meetup_language_exchange('{"languages":["ko","en"],"share":95}',6)$$,'P0001','INVALID_LANGUAGE_EXCHANGE','Share stays between 10 and 90');
select throws_ok($$select private.meetup_language_exchange('{"languages":["ko","en"],"share":50,"x":1}',6)$$,'P0001','INVALID_LANGUAGE_EXCHANGE','No extra keys');
select throws_ok($$select private.meetup_language_exchange('{"languages":["ko","en"],"share":50}',2)$$,'P0001','LANGUAGE_EXCHANGE_CAPACITY','Needs one member seat per side');

-- 2. Creation keeps category 'casual' for published apps and stores the exchange beside it.
select pg_temp.as_user(h) from ids; set local role authenticated;
select lives_ok($$select public.create_chilling_event('lang-test','한영 수다','Synthetic local test',
  '{"eventKind":"group","cadence":"매주 토요일","capacity":6,"category":"casual","languageExchange":{"languages":["ko","en"],"share":50}}','어떤 말을 연습하고 싶어요?')$$,'Create RPC accepts languageExchange');
select throws_ok($$select public.create_chilling_event('lang-test','파티 교환','Synthetic local test',
  '{"eventKind":"group","cadence":"매주","capacity":6,"category":"party","languageExchange":{"languages":["ko","en"],"share":50}}','질문?')$$,'P0001','INVALID_EVENT_CATEGORY','An exchange is always the casual category');
select throws_ok($$select public.create_chilling_event('lang-test','작은 교환','Synthetic local test',
  '{"eventKind":"group","cadence":"매주","capacity":2,"languageExchange":{"languages":["ko","en"],"share":50}}','질문?')$$,'P0001','LANGUAGE_EXCHANGE_CAPACITY','Capacity two is refused');
reset role;
select is((select room_preview->>'category' from public.posts where title='한영 수다'),'casual','Old apps read 가볍게');
select is((select room_preview->'languageExchange' from public.posts where title='한영 수다'),'{"languages":["ko","en"],"share":50}'::jsonb,'Exchange stored in room_preview');

-- 3. Side guard. Capacity 4 = three member seats; share 67 gives Korean 2, English 1.
alter table public.posts disable trigger posts_meetup_abuse;
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select x,h,'lang-test',31997,'Side fixture','Synthetic local test',current_date,
  '{"eventKind":"group","cadence":"weekly","capacity":4,"memberCount":1,"category":"casual","languageExchange":{"languages":["ko","en"],"share":67}}' from ids;
alter table public.posts enable trigger posts_meetup_abuse;
insert into private.meetup_member_languages(post_id,user_id,speaks,learns)
select x,k2,'ko','en' from ids union all select x,k3,'ko','en' from ids union all select x,e4,'en','ko' from ids union all select x,e5,'en','ko' from ids;
insert into public.meetup_requests(post_id,host_id,requester_id,status,responded_at) select x,h,e4,'approved',now() from ids;
select throws_ok($$insert into public.meetup_requests(post_id,host_id,requester_id) select x,h,e5 from ids$$,'P0001','LANGUAGE_SIDE_FULL','A full English side takes no new request');
select lives_ok($$insert into public.meetup_requests(post_id,host_id,requester_id) select x,h,k2 from ids$$,'The Korean side still takes requests');
select lives_ok($$insert into public.meetup_requests(post_id,host_id,requester_id) select x,h,o6 from ids$$,'An applicant without a language row is not side-limited');
select lives_ok($$update public.meetup_requests set status='approved',responded_at=now() where post_id=(select x from ids) and requester_id=(select k2 from ids)$$,'Korean approval within its two seats');
select ok(not private.meetup_language_seat_open((select x from ids),(select e5 from ids)),'Waitlist skips the full English side');
select ok(private.meetup_language_seat_open((select x from ids),(select k3 from ids)),'Waitlist offers the open Korean side');
select ok(private.meetup_language_seat_open((select x from ids),(select o6 from ids)),'No language row means no side check');

-- 4. Counts. Host sees sides, each request's side and requests without a language; others see seats only.
select pg_temp.as_user(h) from ids; set local role authenticated;
select is(public.get_meetup_languages((select x from ids))->'sides',
  '[{"language":"ko","seats":2,"approved":1,"pending":0,"waiting":0},{"language":"en","seats":1,"approved":1,"pending":0,"waiting":0}]'::jsonb,'Host sees per-side seats and approvals');
select is(public.get_meetup_languages((select x from ids))->'unknown','{"approved":0,"pending":1}'::jsonb,'Host sees the request without a language');
select is(jsonb_typeof(public.get_meetup_languages((select x from ids))->'requests'),'object','Host gets each request side');
reset role; select pg_temp.as_user(k3) from ids; set local role authenticated;
select is(public.get_meetup_languages((select x from ids))->'requests','null'::jsonb,'Members do not see other people''s sides');
select is(public.get_meetup_languages((select x from ids))->'mine','{"speaks":"ko","learns":"en"}'::jsonb,'Members see their own choice');
select throws_ok($$select public.request_language_exchange_join((select x from ids),'안녕하세요','chilling-v2','x','ko','ko')$$,'P0001','INVALID_LANGUAGE_CHOICE','Speaks and learns differ');
select throws_ok($$select public.request_language_exchange_join((select x from ids),'안녕하세요','chilling-v2','x','ko','fr')$$,'P0001','INVALID_LANGUAGE_CHOICE','Only the meetup''s two languages');
reset role;

select ok(not has_function_privilege('anon','public.get_meetup_languages(uuid)','execute'),'Anonymous callers cannot read counts');
select ok(not has_function_privilege('anon','public.request_language_exchange_join(uuid,text,text,text,text,text)','execute'),'Anonymous callers cannot apply');
select ok(has_function_privilege('authenticated','public.set_language_exchange_waitlist(uuid,text,text)','execute'),'Members can join a side waitlist');
select ok(not has_function_privilege('authenticated','private.save_meetup_language(uuid,uuid,text,text)','execute'),'Private helpers stay private');

select * from finish();
rollback;
