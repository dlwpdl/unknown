-- 모임장 퀘스트 판정 규칙. 지어낸 계정만 쓰고 끝에 되돌린다(scripts/check-host-quests.py가 일회용 DB에서 돌린다).
begin;
set local search_path=public,extensions;
select no_plan();
update private.meetup_join_cap set enabled=false;

-- 1 H 퀘스트 모임장(hostq@gmail.com) · 2..7 서로 다른 참석자 · 8 H와 같은 기기 · 9 H의 지메일 별칭 · 10,11 서로 같은 기기
-- 12 운영 캐릭터 · 13 버튼 체크인 · 14 참석자 · 20,21 다른 퀘스트 모임장(2번이 이미 도와줌) · 22 $50 송금 시험 모임장
-- 23 퀘스트 아닌 모임장 · 30..35 다른 모임장 손님 · 40..43 H가 초대한 새 회원(43은 H와 같은 기기) · 44 퀘스트 전에 가입 · 90 관리자
create function pg_temp.u(n int) returns uuid language sql as $$ select ('eb000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.sid(n int) returns uuid language sql as $$ select ('eb900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.dev(n int) returns text language sql as $$ select encode(extensions.digest('ed000000-0000-4000-8000-'||lpad(n::text,12,'0'),'sha256'),'hex') $$;
create function pg_temp.person(n int, email text, device int, age interval default interval '100 days', meta jsonb default '{}') returns uuid
language plpgsql as $$
begin
  insert into auth.users(id,email,raw_app_meta_data,created_at) values(pg_temp.u(n),email,meta,now()-age);
  insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version,created_at)
    values(pg_temp.u(n),'퀘스트'||n,'vancouver',now(),now(),now(),'test',now()-age);
  insert into auth.sessions(id,user_id,aal) values(pg_temp.sid(n),pg_temp.u(n),(case when meta->>'role'='admin' then 'aal2' else 'aal1' end)::auth.aal_level);
  insert into private.account_security_devices(user_id,device_hash) values(pg_temp.u(n),pg_temp.dev(device)) on conflict do nothing;
  update private.account_security_sessions set device_hash=pg_temp.dev(device) where session_id=pg_temp.sid(n);
  return pg_temp.u(n);
end $$;
create function pg_temp.act(n int) returns void language sql as $$
  select set_config('request.jwt.claims',json_build_object('sub',pg_temp.u(n),'role','authenticated','session_id',pg_temp.sid(n),
    'aal',case when n=90 then 'aal2' else 'aal1' end,'app_metadata',case when n=90 then '{"role":"admin"}'::json else '{}'::json end)::text,true) $$;
-- 끝난 모임 하나: 모임장과 참석자가 서로 확인했고, 참석자는 p_method로 체크인했다.
create function pg_temp.meetup(p_host int, p_post int, p_start timestamptz, p_hours numeric, p_people int[], p_method text default 'qr',
  p_access text default 'public', p_live boolean default false) returns uuid language plpgsql as $$
declare post uuid:=('eb100000-0000-4000-8000-'||lpad(p_post::text,12,'0'))::uuid; s uuid; n int;
begin
  insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview,created_at)
    values(post,pg_temp.u(p_host),'vancouver',1,'퀘스트 시험 모임 '||p_post,'시험용 모임 글이에요',current_date,
      jsonb_build_object('eventKind','group','cadence','매주','capacity',8,'access',p_access),p_start-interval '3 days')
    on conflict (id) do nothing;
  insert into private.meetup_sessions(post_id,host_id,starts_at,ends_at,created_at)
    values(post,pg_temp.u(p_host),p_start,p_start+make_interval(secs=>p_hours*3600),p_start-interval '2 days') returning id into s;
  if p_live then
    insert into public.meetup_requests(post_id,host_id,requester_id,status) select post,pg_temp.u(p_host),pg_temp.u(x),'approved' from unnest(p_people) x
      on conflict do nothing;
    return s;
  end if;
  insert into private.meetup_attendance(session_id,user_id,checked_in_at) values(s,pg_temp.u(p_host),p_start);
  foreach n in array p_people loop
    insert into private.meetup_attendance(session_id,user_id,checked_in_at,check_in_method,check_in_device)
      values(s,pg_temp.u(n),p_start+interval '5 minutes',p_method,
        case when p_method='qr' then (select device_hash from private.account_security_sessions where session_id=pg_temp.sid(n)) end);
    insert into private.meetup_attendance_confirmations(session_id,witness_id,attendee_id) values(s,pg_temp.u(p_host),pg_temp.u(n)),(s,pg_temp.u(n),pg_temp.u(p_host));
  end loop;
  update private.meetup_attendance set confirmed_at=p_start+make_interval(secs=>p_hours*3600),confirmation_source='peer' where session_id=s;
  return s;
end $$;
-- 시험 안에서 회원·관리자 역할로도 퀘스트 id를 찾게 한다(시험용 임시 함수).
create function pg_temp.quest(n int) returns uuid language sql security definer as $$ select id from private.host_quests where user_id=pg_temp.u(n) $$;
create function pg_temp.code(n int) returns text language sql security definer as $$ select code from private.host_quests where user_id=pg_temp.u(n) $$;
create function pg_temp.reason(q int, s uuid, n int) returns text language sql as $$
  select reason from private.host_quest_session_people(pg_temp.quest(q),s) where person_id=pg_temp.u(n) $$;
create function pg_temp.step(q int, n int) returns text language sql as $$
  select string_agg(status||coalesce(':'||held_reason,''),',' order by id) from private.host_quest_steps
  where quest_id=pg_temp.quest(q) and step=n and status<>'cancelled' $$;
create temporary table ctx(k text primary key, v text);
grant all on ctx to authenticated, service_role;

select pg_temp.person(1,'hostq@gmail.com',1);
select pg_temp.person(n,'quest-'||n||'@example.invalid',n) from generate_series(2,7) n;
select pg_temp.person(8,'quest-8@example.invalid',1);
select pg_temp.person(9,'h.o.s.t.q+second@googlemail.com',9);
select pg_temp.person(10,'quest-10@example.invalid',10);
select pg_temp.person(11,'quest-11@example.invalid',10);
select pg_temp.person(12,'quest-12@example.invalid',12,interval '100 days','{"gling_persona":"seed"}');
select pg_temp.person(n,'quest-'||n||'@example.invalid',n) from generate_series(13,14) n;
select pg_temp.person(n,'quest-'||n||'@example.invalid',n) from generate_series(20,23) n;
select pg_temp.person(n,'quest-'||n||'@example.invalid',n) from generate_series(30,35) n;
select pg_temp.person(n,'quest-'||n||'@example.invalid',n,interval '1 day') from generate_series(40,42) n;
select pg_temp.person(43,'quest-43@example.invalid',1,interval '1 day');
select pg_temp.person(44,'quest-44@example.invalid',44,interval '41 days');
select pg_temp.person(90,'quest-admin@example.invalid',90,interval '100 days','{"role":"admin"}');

-- 코드: 관리자만 만들고, 첫 묶음은 10개까지.
select pg_temp.act(1); set local role authenticated;
select throws_ok($$select public.create_admin_host_quest_codes(1)$$,'P0001','ADMIN_REQUIRED','Members cannot make quest codes');
select throws_ok($$select * from private.host_quest_codes$$,'42501',null,'Members cannot read quest tables');
select throws_ok($$select private.evaluate_host_quest(gen_random_uuid())$$,'42501',null,'Members cannot run the evaluator');
reset role;
select pg_temp.act(90); set local role authenticated;
insert into ctx select 'code'||row_number() over (), c from unnest(public.create_admin_host_quest_codes(6)) c;
select is((select count(*)::int from ctx where v ~ '^[A-HJ-NP-Z2-9]{8}$'),6,'Admin makes six 8-character codes');
select lives_ok($$select public.create_admin_host_quest_codes(4)$$,'Admin can fill the first batch of ten');
select throws_ok($$select public.create_admin_host_quest_codes(1)$$,'P0001','QUEST_CODE_LIMIT','An eleventh code is refused');
select is((public.get_admin_host_quests()->>'remaining')::int,0,'Admin sees no codes left');
reset role;
select ok(exists(select 1 from public.admin_access_logs where scope='host_quests' and actor_id=pg_temp.u(90)),'Admin quest access is logged');

-- 시작: 동의, 일시 정지, 1인 1회(지메일 별칭 포함), 쓴 코드 재사용.
select pg_temp.act(1); set local role authenticated;
select throws_ok($$select public.start_host_quest((select v from ctx where k='code1'),false)$$,'P0001','QUEST_AGREEMENT_REQUIRED','Starting needs the agreement');
select throws_ok($$select public.start_host_quest('ZZZZZZZZ',true)$$,'P0001','QUEST_CODE_NOT_FOUND','Unknown code');
reset role;
update private.host_quest_program set accepting=false;
select pg_temp.act(1); set local role authenticated;
select throws_ok($$select public.start_host_quest((select v from ctx where k='code1'),true)$$,'P0001','QUEST_PAUSED','Paused program refuses new starts');
reset role;
update private.host_quest_program set accepting=true;
select pg_temp.act(1); set local role authenticated;
select is(public.start_host_quest(lower((select v from ctx where k='code1')),true)->>'started','true','Host starts with a code (case-insensitive)');
select throws_ok($$select public.start_host_quest((select v from ctx where k='code2'),true)$$,'P0001','QUEST_ALREADY_USED','One quest per account');
reset role;
select pg_temp.act(9); set local role authenticated;
select throws_ok($$select public.start_host_quest((select v from ctx where k='code2'),true)$$,'P0001','QUEST_ALREADY_USED','A Gmail alias of the same person cannot start again');
reset role;
select pg_temp.act(2); set local role authenticated;
select throws_ok($$select public.start_host_quest((select v from ctx where k='code1'),true)$$,'P0001','QUEST_CODE_NOT_FOUND','A used code cannot be reused');
reset role;
select pg_temp.act(12); set local role authenticated;
select throws_ok($$select public.start_host_quest((select v from ctx where k='code2'),true)$$,'P0001','QUEST_NOT_AVAILABLE','Operated characters cannot start');
reset role;
do $$ declare r record; begin
  for r in select * from (values (20,'code2'),(21,'code3'),(22,'code4')) x(n,k) loop
    perform pg_temp.act(r.n); execute 'set local role authenticated';
    perform public.start_host_quest((select v from ctx where k=r.k),true); execute 'reset role';
  end loop;
end $$;
update private.host_quests set started_at=now()-interval '40 days', ends_at=now()+interval '20 days' where user_id=pg_temp.u(1);
update private.host_quests set started_at=now()-interval '69 days', ends_at=now()-interval '9 days' where user_id=pg_temp.u(20);
update private.host_quests set started_at=now()-interval '45 days', ends_at=now()+interval '15 days' where user_id=pg_temp.u(21);
update private.host_quests set started_at=now()-interval '40 days', ends_at=now()+interval '20 days' where user_id=pg_temp.u(22);

-- 품앗이: 2번은 30일 안에 이미 다른 퀘스트 모임장 두 명(20, 21)의 첫 모임에서 셌다.
select pg_temp.meetup(20,20,now()-interval '39 days',2,array[2,30,31,32]);
select pg_temp.meetup(21,21,now()-interval '39 days',2,array[2,33,34,35]);
select private.evaluate_host_quest(pg_temp.quest(20));
select private.evaluate_host_quest(pg_temp.quest(21));
select is(pg_temp.step(20,2),'pending','Another quest host earns step 2 with four real people');

-- H의 첫 모임: 3, 4, 5만 셈.
insert into ctx values('s0',pg_temp.meetup(1,1,now()-interval '38 days',2,array[2,3,4,5,8,9,10,11,12]));
insert into private.meetup_attendance(session_id,user_id,checked_in_at,check_in_method,confirmed_at,confirmation_source)
  values((select v::uuid from ctx where k='s0'),pg_temp.u(13),now()-interval '38 days','button',now()-interval '38 days','admin');
select is(pg_temp.reason(1,(select v::uuid from ctx where k='s0'),3),null,'A distinct QR-checked, mutually confirmed attendee counts');
select is(pg_temp.reason(1,(select v::uuid from ctx where k='s0'),8),'same_person','An attendee on the host''s device does not count');
select is(pg_temp.reason(1,(select v::uuid from ctx where k='s0'),9),'same_person','A Gmail dot/plus alias of the host does not count');
select is(pg_temp.reason(1,(select v::uuid from ctx where k='s0'),10),'same_device','Two accounts on one device: neither counts (a)');
select is(pg_temp.reason(1,(select v::uuid from ctx where k='s0'),11),'same_device','Two accounts on one device: neither counts (b)');
select is(pg_temp.reason(1,(select v::uuid from ctx where k='s0'),12),'operated','Operated characters do not count');
select is(pg_temp.reason(1,(select v::uuid from ctx where k='s0'),13),'not_qr','Button check-in does not count for the quest');
select is(pg_temp.reason(1,(select v::uuid from ctx where k='s0'),2),'helper_limit','One person helps at most two quest hosts in 30 days');

-- 퀘스트에 안 들어가는 모임: 4시간 넘음, 초대 전용, 24시간 안에 잡힘.
insert into ctx values('long',pg_temp.meetup(1,1,now()-interval '37 days',5,array[3,4,5,6]));
insert into ctx values('invite',pg_temp.meetup(1,2,now()-interval '36 days',2,array[3,4,5,6],'qr','invite'));
insert into ctx values('late',pg_temp.meetup(1,1,now()-interval '25 days',2,array[3,4,5,6]));
update private.meetup_sessions set created_at=starts_at-interval '1 hour' where id=(select v::uuid from ctx where k='late');
select is(private.host_quest_session_problem((select v::uuid from ctx where k='long')),'too_long','Sessions longer than 4 hours are out');
select is(private.host_quest_session_problem((select v::uuid from ctx where k='invite')),'invite_only','Invite-only meetups are out');
select is(private.host_quest_session_problem((select v::uuid from ctx where k='late')),'late_notice','Sessions scheduled less than 24 hours ahead are out');
select is(private.host_quest_session_problem((select v::uuid from ctx where k='s0')),null,'A public, announced, 2-hour meetup is in');

insert into ctx values('s1',pg_temp.meetup(1,1,now()-interval '30 days',2,array[3,6,7,14]));
insert into ctx values('s2',pg_temp.meetup(1,1,now()-interval '20 days',2,array[4,5,6,7]));
insert into private.trust_reviews(kind,author_id,session_id,score,body,status,release_at) values
 ('meetup',pg_temp.u(3),(select v::uuid from ctx where k='s0'),9,'재밌었어요','published',now()-interval '38 days'),
 ('meetup',pg_temp.u(8),(select v::uuid from ctx where k='s0'),9,'재밌었어요','published',now()-interval '38 days');
select private.evaluate_host_quest(pg_temp.quest(1));
select is((select session_ids[1]::text from private.host_quest_steps where quest_id=pg_temp.quest(1) and step=2),(select v from ctx where k='s0'),'Step 2 uses the first meetup with 3 counted people');
select is((select person_ids from private.host_quest_steps where quest_id=pg_temp.quest(1) and step=2),array[pg_temp.u(3),pg_temp.u(4),pg_temp.u(5)] ,'Step 2 records exactly the counted people');
select is(pg_temp.step(1,1),'pending','Step 1 is credited with step 2');
select is((select session_ids[1]::text from private.host_quest_steps where quest_id=pg_temp.quest(1) and step=5),(select v from ctx where k='s1'),'Step 5: 7+ days later, 4 counted, one returning');
select is((select session_ids[1]::text from private.host_quest_steps where quest_id=pg_temp.quest(1) and step=7),(select v from ctx where k='s2'),'Step 7 skips the late-notice session and uses the third real meetup');
select is(pg_temp.step(1,6),null,'One counted review is not enough (excluded attendee review ignored)');
insert into private.trust_reviews(kind,author_id,session_id,score,body,status,release_at)
  values('meetup',pg_temp.u(4),(select v::uuid from ctx where k='s0'),8,'좋았어요','published',now()-interval '38 days');
select private.evaluate_host_quest(pg_temp.quest(1));
select is((select person_ids from private.host_quest_steps where quest_id=pg_temp.quest(1) and step=6 and status<>'cancelled'),array[pg_temp.u(3),pg_temp.u(4)],'Step 6: two reviews by counted attendees');

-- 4단계: 3명이 돼야 처음 $3.
select pg_temp.act(1); set local role authenticated;
insert into ctx select 'invite_code', public.create_invite_link()->>'code';
reset role;
do $$ declare n int; begin
  foreach n in array array[40,41,42,43] loop
    perform pg_temp.act(n); execute 'set local role authenticated';
    perform public.claim_invite_code((select v from ctx where k='invite_code')); execute 'reset role';
  end loop;
end $$;
insert into private.invite_redemptions(invitee_id,link_id,inviter_id,redeemed_at)
  select pg_temp.u(44),id,owner_id,now()-interval '41 days' from private.invite_links where owner_id=pg_temp.u(1);
select pg_temp.meetup(23,23,now()-interval '12 hours',2,array[40,41,43]);
select private.evaluate_host_quest(pg_temp.quest(1));
select is((private.host_quest_totals(pg_temp.quest(1))->>'invitees')::int,2,'Two invitees qualify (the one on the host''s device does not)');
select is((select reason from private.host_quest_invitee(pg_temp.quest(1),pg_temp.u(43))),'same_person','An invitee on the host''s device is the same person');
select is((private.host_quest_totals(pg_temp.quest(1))->>'pending')::int,100+500+1000+1500+400,'Two invitees add nothing yet');
-- 사장님 확정 Q1: 초대한 모임장 본인 모임에서만 참석 확인된 사람은 4단계에 안 센다.
select pg_temp.meetup(1,1,now()-interval '6 hours',2,array[42]);
select private.evaluate_host_quest(pg_temp.quest(1));
select is((select reason from private.host_quest_invitee(pg_temp.quest(1),pg_temp.u(42))),'waiting','Q1 an invitee confirmed only at the host''s own meetup does not count');
select is((private.host_quest_totals(pg_temp.quest(1))->>'pending')::int,100+500+1000+1500+400,'Q1 the host''s own meetup adds nothing to step 4');
-- 다른 모임장 모임이어도 버튼 체크인은 안 센다(퀘스트는 QR만).
select pg_temp.meetup(23,24,now()-interval '5 hours',2,array[42],'button');
select private.evaluate_host_quest(pg_temp.quest(1));
select is((select reason from private.host_quest_invitee(pg_temp.quest(1),pg_temp.u(42))),'waiting','A button check-in at another host''s meetup does not count');
select pg_temp.meetup(23,25,now()-interval '4 hours',2,array[42]);
select private.evaluate_host_quest(pg_temp.quest(1));
select is((private.host_quest_totals(pg_temp.quest(1))->>'pending')::int,100+500+1000+1500+400+300,'The third invitee, QR-checked at another host''s meetup, unlocks $3');
select is((select count(*)::int from private.host_quest_steps where quest_id=pg_temp.quest(1) and step=4 and person_id=pg_temp.u(44)),0,'Members who joined before the quest are not counted');

-- QR 체크인: 모임장만 받고, 한 번 쓰면 끝, 30초 지나면 끝.
insert into ctx values('live',pg_temp.meetup(1,1,now()-interval '1 hour',2,array[3,6,13],'qr','public',true));
select pg_temp.act(3); set local role authenticated;
select throws_ok($$select public.get_meetup_check_in_qr((select v::uuid from ctx where k='live'))$$,'P0001','SESSION_NOT_FOUND','Only the host gets the QR');
reset role;
select pg_temp.act(1); set local role authenticated;
insert into ctx select 'qr1', substring(public.get_meetup_check_in_qr((select v::uuid from ctx where k='live'))->>'url' from 'c=([0-9a-f]{24})$');
select is((select v from ctx where k='qr1'),substring(public.get_meetup_check_in_qr((select v::uuid from ctx where k='live'))->>'url' from 'c=([0-9a-f]{24})$'),'The same unused code is shown within 15 seconds');
select ok(public.get_meetup_check_in_qr((select v::uuid from ctx where k='live'))->>'url' like 'https://gling.ej-entertainment.com/checkin?s=%','QR opens the app link');
select throws_ok($$select public.check_in_meetup_qr((select v::uuid from ctx where k='live'),(select v from ctx where k='qr1'))$$,'P0001','INVALID_ATTENDEE','The host cannot scan their own QR');
reset role;
select pg_temp.act(3); set local role authenticated;
select lives_ok($$select public.check_in_meetup_qr((select v::uuid from ctx where k='live'),(select v from ctx where k='qr1'))$$,'An approved attendee checks in with the QR');
reset role;
select is((select check_in_method||':'||(check_in_device=pg_temp.dev(3)) from private.meetup_attendance where session_id=(select v::uuid from ctx where k='live') and user_id=pg_temp.u(3)),'qr:true','QR check-in records the method and the device');
select pg_temp.act(13); set local role authenticated;
select throws_ok($$select public.check_in_meetup_qr((select v::uuid from ctx where k='live'),(select v from ctx where k='qr1'))$$,'P0001','QR_EXPIRED','A scanned code cannot be used again');
reset role;
select pg_temp.act(1); set local role authenticated;
insert into ctx select 'qr2', substring(public.get_meetup_check_in_qr((select v::uuid from ctx where k='live'))->>'url' from 'c=([0-9a-f]{24})$');
reset role;
select isnt((select v from ctx where k='qr2'),(select v from ctx where k='qr1'),'After a scan the host screen gets a new code');
update private.meetup_qr_codes set issued_at=clock_timestamp()-interval '31 seconds' where code=(select v from ctx where k='qr2');
select pg_temp.act(13); set local role authenticated;
select throws_ok($$select public.check_in_meetup_qr((select v::uuid from ctx where k='live'),(select v from ctx where k='qr2'))$$,'P0001','QR_EXPIRED','An expired QR is refused');
select lives_ok($$select public.check_in_meetup((select v::uuid from ctx where k='live'))$$,'Button check-in still works');
reset role;
select is((select check_in_method from private.meetup_attendance where session_id=(select v::uuid from ctx where k='live') and user_id=pg_temp.u(13)),'button','Button check-in is recorded as button');
update private.account_security_sessions set device_hash=null where session_id=pg_temp.sid(6);
select pg_temp.act(6); set local role authenticated;
select throws_ok($$select public.check_in_meetup_qr((select v::uuid from ctx where k='live'),'000000000000000000000000')$$,'P0001','DEVICE_REQUIRED','QR check-in needs a registered device');
reset role;

-- 인증샷: 모임 시간 안에 올린 파일만, 같은 파일은 한 번만.
insert into ctx values('photo_path',pg_temp.u(1)||'/'||(select v from ctx where k='live')||'/eb200000-0000-4000-8000-000000000001.webp'),
  ('photo_early',pg_temp.u(1)||'/'||(select v from ctx where k='live')||'/eb200000-0000-4000-8000-000000000002.webp'),
  ('photo_copy',pg_temp.u(1)||'/'||(select v from ctx where k='live')||'/eb200000-0000-4000-8000-000000000003.webp');
insert into storage.objects(bucket_id,name,owner,owner_id,metadata,created_at) values
 ('meetup-quest-photos',(select v from ctx where k='photo_path'),pg_temp.u(1),pg_temp.u(1)::text,'{"eTag":"\"aaa1\"","mimetype":"image/webp","size":1000}',now()),
 ('meetup-quest-photos',(select v from ctx where k='photo_early'),pg_temp.u(1),pg_temp.u(1)::text,'{"eTag":"\"bbb2\"","mimetype":"image/webp","size":1000}',now()-interval '2 hours'),
 ('meetup-quest-photos',(select v from ctx where k='photo_copy'),pg_temp.u(1),pg_temp.u(1)::text,'{"eTag":"\"aaa1\"","mimetype":"image/webp","size":1000}',now()),
 ('meetup-quest-photos',pg_temp.u(1)||'/orphan.webp',pg_temp.u(1),pg_temp.u(1)::text,'{"eTag":"\"ccc3\"","mimetype":"image/webp","size":1000}',now()-interval '2 days');
select pg_temp.act(1); set local role authenticated;
select ok(private.can_upload_host_quest_photo((select v from ctx where k='photo_path')),'The quest host may upload into the live session folder');
select throws_ok($$select public.submit_host_quest_photo((select v::uuid from ctx where k='live'),(select v from ctx where k='photo_early'))$$,'P0001','PHOTO_WINDOW_CLOSED','A photo uploaded before the meetup is refused');
insert into ctx select 'photo_id', public.submit_host_quest_photo((select v::uuid from ctx where k='live'),(select v from ctx where k='photo_path'));
select throws_ok($$select public.submit_host_quest_photo((select v::uuid from ctx where k='live'),(select v from ctx where k='photo_copy'))$$,'P0001','PHOTO_DUPLICATE','The same file cannot be sent twice');
reset role;
select pg_temp.act(3); set local role authenticated;
select ok(not private.can_upload_host_quest_photo((select v from ctx where k='photo_path')),'Other members cannot upload into the host folder');
select throws_ok($$select public.review_admin_host_quest_photo((select v::uuid from ctx where k='photo_id'),true)$$,'P0001','ADMIN_REQUIRED','Members cannot approve photos');
reset role;
select pg_temp.act(90); set local role authenticated;
select lives_ok($$select public.review_admin_host_quest_photo((select v::uuid from ctx where k='photo_id'),true,'단체 사진 확인')$$,'Admin approves the group photo');
reset role;
select is(pg_temp.step(1,3),'pending','An approved photo earns step 3');
update private.host_quest_photos set delete_after=now()-interval '1 second' where id=(select v::uuid from ctx where k='photo_id');
set local role service_role;
select is((select count(*)::int from public.claim_host_quest_photo_cleanup(100)),2,'Cleanup claims the due photo and the never-submitted file');
select is(public.finish_host_quest_photo_cleanup(array[(select v::uuid from ctx where k='photo_id')]),1,'Cleanup marks the photo deleted');
reset role;

-- $50 전에는 송금 요청이 안 된다.
select pg_temp.act(1); set local role authenticated;
select throws_ok($$select public.request_host_quest_payout('hostq@gmail.com','Host Q')$$,'P0001','PAYOUT_NOT_READY','Payout is refused before $50 is confirmed');
reset role;

-- 14일 확인: 신고가 있으면 운영팀 판단으로 넘긴다. 탈퇴하면 근거가 빠져 취소된다.
select private.settle_host_quest(pg_temp.quest(1));
select is(pg_temp.step(1,2),'pending','Nothing confirms before 14 days');
update private.host_quest_steps set confirm_after=now()-interval '1 second' where quest_id=pg_temp.quest(1) and step in (1,2);
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code,status)
  values(pg_temp.u(14),pg_temp.u(1),'user',pg_temp.u(1),'other','open');
select private.settle_host_quest(pg_temp.quest(1));
select is(pg_temp.step(1,2),'pending:report','An open report holds a due step for admin review');
insert into ctx select 'held_step', id from private.host_quest_steps where quest_id=pg_temp.quest(1) and step=2 and status='pending';
select pg_temp.act(90); set local role authenticated;
select lives_ok($$select public.decide_admin_host_quest_step((select v::bigint from ctx where k='held_step'),true,'신고 확인함')$$,'Admin confirms a held step');
reset role;
update public.reports set status='dismissed' where reported_user_id=pg_temp.u(1);
update public.profiles set account_status='suspended' where id=pg_temp.u(5);
select private.evaluate_host_quest(pg_temp.quest(1));
select is(pg_temp.step(1,7),null,'Losing a counted attendee before 14 days cancels the step');
update public.profiles set account_status='active' where id=pg_temp.u(5);
update private.host_quest_steps set confirm_after=now()-interval '1 second' where quest_id=pg_temp.quest(1) and status='pending';
select private.settle_host_quest(pg_temp.quest(1));
select is(pg_temp.step(1,7),'pending','A restored attendee earns the step again with a fresh 14 days');
select is((select string_agg(distinct status,',') from private.host_quest_steps where quest_id=pg_temp.quest(1) and step in (1,2,3,5,6)),'confirmed','Due steps confirm after 14 days with no report');
select is((private.host_quest_totals(pg_temp.quest(1))->>'confirmed')::int,100+500+500+1000+400+300,'Confirmed total adds the invitee threshold amount');

-- 60일: 확정된 만큼 멤버십(10달러마다 14일, 모임을 열었으면 프로).
update private.host_quest_steps set confirm_after=now()-interval '1 second' where quest_id=pg_temp.quest(20) and status='pending';
select private.run_host_quests();
select is((select status||':'||converted_days from private.host_quests where user_id=pg_temp.u(20)),'converted:8','After 60 days $6 confirmed becomes 8 days');
select is((select tier||':'||days||':'||reason from private.invite_rewards where user_id=pg_temp.u(20)),'pro:8:quest','The conversion reuses the invite reward grant as Pro');
select is(private.membership_details(pg_temp.u(20))->>'tier','pro','Membership shows the converted Pro pass');
select is(private.grant_invite_reward(pg_temp.u(20),null,'plus',pg_temp.u(35),'attended'),14,'Quest days do not use up the invite reward cap');
select pg_temp.act(20); set local role authenticated;
select is((public.get_my_invite()->>'grantedDays')::int,14,'The invite screen leaves quest days out');
reset role;

-- $50 송금: 사진 속 사람 수, 참석자 2명 확인, 받는 이름, 은행 이름 확인이 다 있어야 "보냄".
insert into ctx values('h4s',pg_temp.meetup(22,22,now()-interval '30 days',2,array[3,4,5]));
insert into private.host_quest_steps(quest_id,step,amount_cents,status,session_ids,person_ids,person_id)
  select pg_temp.quest(22),x.step,x.amount,'confirmed',array[(select v::uuid from ctx where k='h4s')],
    case when x.step=2 then array[pg_temp.u(3),pg_temp.u(4),pg_temp.u(5)] else '{}' end,null
  from (values (1,100),(2,500),(3,500),(5,1000),(6,400),(7,1500)) x(step,amount);
insert into private.host_quest_steps(quest_id,step,amount_cents,status,person_id) select pg_temp.quest(22),4,100,'confirmed',gen_random_uuid() from generate_series(1,10);
select is((private.host_quest_totals(pg_temp.quest(22))->>'confirmed')::int,5000,'Seven confirmed steps make $50');
select pg_temp.act(22); set local role authenticated;
select is(public.request_host_quest_payout(' Haneul.Kim+gling@Gmail.com ','Haneul   Kim')->>'requested','true','Host requests the payout at $50');
select is(public.get_my_host_quest()->'payout'->>'legalName','Haneul Kim','Host sees their own payout details');
reset role;
select pg_temp.act(90); set local role authenticated;
select throws_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest(22),'sent','1234',true)$$,'P0001','PHOTO_PEOPLE_REQUIRED','Sent needs the photo head count first');
select lives_ok($$select public.set_admin_host_quest_photo_people(pg_temp.quest(22),4)$$,'Admin enters the photo head count');
select throws_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest(22),'sent','1234',true)$$,'P0001','ATTENDEE_CHECKS_REQUIRED','Sent needs two attendee answers');
select throws_ok($$select public.ask_admin_host_quest_attendee(pg_temp.quest(22),pg_temp.u(14))$$,'P0001','INVALID_ATTENDEE','Admin can only ask counted attendees');
select ok(public.ask_admin_host_quest_attendee(pg_temp.quest(22),pg_temp.u(3)) is not null,'Admin messages attendee 3');
select ok(public.ask_admin_host_quest_attendee(pg_temp.quest(22),pg_temp.u(4)) is not null,'Admin messages attendee 4');
select lives_ok($$select public.record_admin_host_quest_check(pg_temp.quest(22),pg_temp.u(3),'yes')$$,'Admin records a yes');
select throws_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest(22),'sent','1234',true)$$,'P0001','ATTENDEE_CHECKS_REQUIRED','One yes is not enough');
select lives_ok($$select public.record_admin_host_quest_check(pg_temp.quest(22),pg_temp.u(4),'yes')$$,'Admin records a second yes');
select throws_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest(22),'sent','1234',true)$$,'P0001','RECIPIENT_NAME_REQUIRED','Sent needs the name the code was given to');
select lives_ok($$select public.set_admin_host_quest_code(pg_temp.code(22),'Kim Haneul')$$,'Admin records the code recipient');
select throws_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest(22),'sent','1234',true)$$,'P0001','PAYOUT_NAME_MISMATCH','A different payout name blocks sending');
select lives_ok($$select public.set_admin_host_quest_code(pg_temp.code(22),'HANEUL kim')$$,'Admin fixes the recipient name');
select throws_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest(22),'sent','1234',false)$$,'P0001','BANK_NAME_CHECK_REQUIRED','Sent needs the bank name check');
select throws_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest(22),'sent','12',true)$$,'P0001','INVALID_TRANSFER_REFERENCE','Sent needs the last 4 of the transfer');
select lives_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest(22),'sent','A1b2',true)$$,'Admin marks the payout sent');
select throws_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest(22),'sent','A1b2',true)$$,'P0001','PAYOUT_ALREADY_SENT','A second send is refused');
select is((public.get_admin_host_quest(pg_temp.quest(22))->'payout'->>'nameMatches')::boolean,true,'Admin card shows the name match');
reset role;
select is((select status from private.host_quests where user_id=pg_temp.u(22)),'paid','A sent payout finishes the quest');
select is((select count(*)::int from public.messages m join public.conversations c on c.id=m.conversation_id
  where m.sender_id=pg_temp.u(90) and m.body like '%」에 다녀오셨어요?%'),2,'Each asked attendee got one in-app message');
select ok((select count(*) from public.admin_access_logs where scope='host_quests' and subject_user_id=pg_temp.u(22))>=9,'Every admin read and write is logged');

-- 계정 삭제: 진행 중 퀘스트는 끝나고 송금 정보는 바로 지운다.
select ok(strpos(pg_get_functiondef('private.purge_account_data(text)'::regprocedure),'purge_host_quest_account_data')>0,'Account deletion runs the quest purge');
select private.purge_host_quest_account_data(pg_temp.u(22));
select is((select coalesce(email,'')||coalesce(legal_name,'')||status from private.host_quest_payouts where quest_id=pg_temp.quest(22)),'sent','Deleting the account erases the payout email and name');
select private.purge_host_quest_account_data(pg_temp.u(1));
select is((select status from private.host_quests where user_id=pg_temp.u(1)),'ended','Deleting the account ends an active quest');
select is((select count(*)::int from private.host_quest_steps where quest_id=pg_temp.quest(1) and status='pending'),0,'No pending amounts survive account deletion');

select * from finish();
rollback;
