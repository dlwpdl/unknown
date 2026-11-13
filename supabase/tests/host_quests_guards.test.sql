-- 모임장 퀘스트: 같은 사람 묶기, 1회용 QR, 퀘스트에 안 치는 모임, 송금 전 확인. 지어낸 계정만 쓰고 되돌린다.
-- 같은 사람 판별은 private.invite_marks(이메일 + 뒤·지메일 점·googlemail, 전화, 기기)를 그대로 쓴다.
begin;
set local search_path=public,extensions;
select no_plan();
update private.meetup_join_cap set enabled=false;

-- h 퀘스트 모임장 · b c d h의 메일 별칭 계정(기기는 다 다르게 등록) · e h와 같은 폰의 두 번째 계정(모임을 연다)
-- m n 서로 다른 메일인데 같은 기기 · p1 p2 같은 메일의 + 별칭 · r1..r4 서로 다른 참석자 · o 다른 모임장 · z 관리자
-- i1 h의 모임에만 간 초대 회원 · i2 e(h의 두 번째 계정)가 연 모임에 간 초대 회원 · i3 o와 같은 기기인 초대 회원
create temporary table who(k text primary key, n int, email text, device int, admin boolean default false);
insert into who(k,n,email,device,admin) values
 ('h',1,'hostg@gmail.com',1,false),('b',2,'hostg+b@gmail.com',2,false),('c',3,'h.ostg@gmail.com',3,false),
 ('d',4,'hostg+d@googlemail.com',4,false),('e',5,'second-account@gmail.com',1,false),
 ('m',6,'one-phone-a@example.invalid',6,false),('n',7,'one-phone-b@example.invalid',6,false),
 ('p1',8,'pat@example.invalid',8,false),('p2',9,'pat+two@example.invalid',9,false),
 ('r1',11,'real-one@example.invalid',11,false),('r2',12,'real-two@example.invalid',12,false),
 ('r3',13,'real-three@example.invalid',13,false),('r4',14,'real-four@example.invalid',14,false),
 ('o',15,'other-host@example.invalid',15,false),('z',16,'quest-admin@example.invalid',16,true),
 ('i1',17,'invite-one@example.invalid',17,false),('i2',18,'invite-two@example.invalid',18,false),('i3',19,'invite-three@example.invalid',15,false);
create function pg_temp.u(k text) returns uuid language sql as $$ select ('ab000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from who where who.k=$1 $$;
create function pg_temp.sid(k text) returns uuid language sql as $$ select ('ab900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from who where who.k=$1 $$;
create function pg_temp.act(k text) returns void language sql as $$
  select set_config('request.jwt.claims',json_build_object('sub',pg_temp.u(k),'role','authenticated','session_id',pg_temp.sid(k),
    'aal',case when admin then 'aal2' else 'aal1' end,'app_metadata',case when admin then '{"role":"admin"}'::json else '{}'::json end)::text,true)
  from who where who.k=$1 $$;
create function pg_temp.quest(k text) returns uuid language sql security definer as $$ select id from private.host_quests where user_id=pg_temp.u(k) $$;
create function pg_temp.reason(s uuid, k text) returns text language sql security definer as $$
  select reason from private.host_quest_session_people(pg_temp.quest('h'),s) where person_id=pg_temp.u(k) $$;
create function pg_temp.invitee(k text) returns text language sql security definer as $$
  select reason from private.host_quest_invitee(pg_temp.quest('h'),pg_temp.u(k)) $$;
create temporary table ctx(k text primary key, v text);
grant all on who, ctx to authenticated;

insert into auth.users(id,email,raw_app_meta_data,created_at)
  select pg_temp.u(k),email,case when admin then '{"role":"admin"}'::jsonb else '{}'::jsonb end,
    case when k in ('b','c','d','i1','i2','i3') then now()-interval '1 day' else now()-interval '100 days' end from who;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version,created_at)
  select pg_temp.u(k),'규칙'||k,'vancouver',now(),now(),now(),'test',
    case when k in ('b','c','d','i1','i2','i3') then now()-interval '1 day' else now()-interval '100 days' end from who;
insert into auth.sessions(id,user_id,aal) select pg_temp.sid(k),pg_temp.u(k),(case when admin then 'aal2' else 'aal1' end)::auth.aal_level from who;
-- 기기: 앱이 보내는 UUID는 클라이언트가 정한다. b c d는 일부러 다 다른 UUID를 보냈다.
do $$ declare r record; begin
  for r in select * from who order by n loop
    perform pg_temp.act(r.k);
    perform public.register_security_device(('dd000000-0000-4000-8000-'||lpad(r.device::text,12,'0'))::uuid,pg_temp.u(r.k));
  end loop;
end $$;

-- 퀘스트 시작
select pg_temp.act('z'); set local role authenticated;
insert into ctx select 'code'||row_number() over (), c from unnest(public.create_admin_host_quest_codes(3)) c;
reset role;
select pg_temp.act('h'); set local role authenticated;
select is(public.start_host_quest((select v from ctx where k='code1'),true)->>'started','true','Host starts a quest');
reset role;
select pg_temp.act('b'); set local role authenticated;
select throws_ok($$select public.start_host_quest((select v from ctx where k='code2'),true)$$,'P0001','QUEST_ALREADY_USED','A mail alias of the host cannot start a second quest');
reset role;
update private.host_quests set started_at=now()-interval '10 days', ends_at=now()+interval '50 days' where user_id=pg_temp.u('h');

-- 모임 글은 3일 전, 일정은 2일 전에 올렸다(24시간 규칙은 아래에서 따로 본다).
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview,created_at) values
 ('ab100000-0000-4000-8000-000000000001',pg_temp.u('h'),'vancouver',1,'보드게임 모임','같이 보드게임 해요',current_date,'{"eventKind":"group","cadence":"매주","capacity":10}',now()-interval '3 days'),
 ('ab100000-0000-4000-8000-000000000002',pg_temp.u('o'),'vancouver',1,'러닝 모임','같이 뛰어요',current_date,'{"eventKind":"group","cadence":"매주","capacity":10}',now()-interval '3 days'),
 ('ab100000-0000-4000-8000-000000000003',pg_temp.u('e'),'vancouver',1,'산책 모임','같이 걸어요',current_date,'{"eventKind":"group","cadence":"매주","capacity":10}',now()-interval '3 days');
insert into public.meetup_requests(post_id,host_id,requester_id,status)
  select 'ab100000-0000-4000-8000-000000000001',pg_temp.u('h'),pg_temp.u(k),'approved' from unnest(array['b','c','d','m','n','p1','p2','r1','i1']) k;
insert into public.meetup_requests(post_id,host_id,requester_id,status)
  select 'ab100000-0000-4000-8000-000000000002',pg_temp.u('o'),pg_temp.u(k),'approved' from unnest(array['b','c','d','i3']) k;
insert into public.meetup_requests(post_id,host_id,requester_id,status)
  values ('ab100000-0000-4000-8000-000000000003',pg_temp.u('e'),pg_temp.u('i2'),'approved');

-- 초대 코드: b c d(별칭)와 i1 i2 i3이 h의 코드로 가입.
select pg_temp.act('h'); set local role authenticated;
insert into ctx select 'invite', public.create_invite_link()->>'code';
reset role;
do $$ declare k text; begin
  foreach k in array array['b','c','d','i1','i2','i3'] loop
    perform pg_temp.act(k); execute 'set local role authenticated';
    perform public.claim_invite_code((select v from ctx where ctx.k='invite')); execute 'reset role';
  end loop;
end $$;

-- 지금 진행 중인 2시간 모임 셋: h, o, e.
insert into private.meetup_sessions(id,post_id,host_id,starts_at,ends_at,created_at) values
 ('ab200000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001',pg_temp.u('h'),now()-interval '1 hour',now()+interval '1 hour',now()-interval '2 days'),
 ('ab200000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000002',pg_temp.u('o'),now()-interval '1 hour',now()+interval '1 hour',now()-interval '2 days'),
 ('ab200000-0000-4000-8000-000000000004','ab100000-0000-4000-8000-000000000003',pg_temp.u('e'),now()-interval '1 hour',now()+interval '1 hour',now()-interval '2 days');
insert into private.meetup_attendance(session_id,user_id,checked_in_at) values
 ('ab200000-0000-4000-8000-000000000001',pg_temp.u('h'),now()-interval '1 hour'),('ab200000-0000-4000-8000-000000000002',pg_temp.u('o'),now()-interval '1 hour'),
 ('ab200000-0000-4000-8000-000000000004',pg_temp.u('e'),now()-interval '1 hour');

-- 1회용 QR: 한 번 쓴 코드와 30초 지난 코드는 안 받는다.
create function pg_temp.qr(host text, s uuid) returns text language plpgsql as $$
declare url text;
begin
  perform pg_temp.act(host); execute 'set local role authenticated';
  url:=public.get_meetup_check_in_qr(s)->>'url'; execute 'reset role';
  return substring(url from 'c=([0-9a-f]{24})$');
end $$;
create function pg_temp.scan(k text, s uuid, code text) returns text language plpgsql as $$
begin
  perform pg_temp.act(k); execute 'set local role authenticated';
  perform public.check_in_meetup_qr(s,code); execute 'reset role';
  return 'ok';
exception when others then execute 'reset role'; return sqlerrm;
end $$;
insert into ctx values('qr',pg_temp.qr('h','ab200000-0000-4000-8000-000000000001'));
select is(pg_temp.scan('b','ab200000-0000-4000-8000-000000000001',(select v from ctx where k='qr')),'ok','b checks in with the host QR');
select is(pg_temp.scan('c','ab200000-0000-4000-8000-000000000001',(select v from ctx where k='qr')),'QR_EXPIRED','A QR code that was already used is refused');
update private.meetup_qr_codes set issued_at=clock_timestamp()-interval '31 seconds' where session_id='ab200000-0000-4000-8000-000000000001' and used_at is null;
select is(pg_temp.scan('c','ab200000-0000-4000-8000-000000000001',pg_temp.qr('h','ab200000-0000-4000-8000-000000000001')),'ok','c checks in with a fresh code');
insert into ctx values('old',pg_temp.qr('h','ab200000-0000-4000-8000-000000000001'));
update private.meetup_qr_codes set issued_at=clock_timestamp()-interval '31 seconds' where code=(select v from ctx where k='old');
select is(pg_temp.scan('d','ab200000-0000-4000-8000-000000000001',(select v from ctx where k='old')),'QR_EXPIRED','A code older than 30 seconds is refused');
do $$ declare k text; begin
  foreach k in array array['d','m','n','p1','p2','r1','i1'] loop
    if pg_temp.scan(k,'ab200000-0000-4000-8000-000000000001',pg_temp.qr('h','ab200000-0000-4000-8000-000000000001'))<>'ok' then raise exception 'scan failed for %',k; end if;
  end loop;
  -- o의 모임: b c d는 버튼으로, i3은 o의 QR로 체크인. e의 모임: i2가 e의 QR로 체크인.
  foreach k in array array['b','c','d'] loop
    perform pg_temp.act(k); execute 'set local role authenticated';
    perform public.check_in_meetup('ab200000-0000-4000-8000-000000000002'); execute 'reset role';
  end loop;
  if pg_temp.scan('i3','ab200000-0000-4000-8000-000000000002',pg_temp.qr('o','ab200000-0000-4000-8000-000000000002'))<>'ok' then raise exception 'scan failed for i3'; end if;
  if pg_temp.scan('i2','ab200000-0000-4000-8000-000000000004',pg_temp.qr('e','ab200000-0000-4000-8000-000000000004'))<>'ok' then raise exception 'scan failed for i2'; end if;
end $$;

-- 모임이 끝나고 모임장과 서로 확인.
update private.meetup_sessions set ends_at=now()-interval '1 minute' where id in ('ab200000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000002','ab200000-0000-4000-8000-000000000004');
do $$ declare r record; begin
  for r in select * from (values ('h','ab200000-0000-4000-8000-000000000001',array['b','c','d','m','n','p1','p2','r1','i1']),
      ('o','ab200000-0000-4000-8000-000000000002',array['b','c','d','i3']),('e','ab200000-0000-4000-8000-000000000004',array['i2'])) x(host,s,people) loop
    declare k text; begin
      foreach k in array r.people loop
        perform pg_temp.act(r.host); execute 'set local role authenticated';
        perform public.confirm_meetup_attendance(r.s::uuid,pg_temp.u(k)); execute 'reset role';
        perform pg_temp.act(k); execute 'set local role authenticated';
        perform public.confirm_meetup_attendance(r.s::uuid,pg_temp.u(r.host)); execute 'reset role';
      end loop;
    end;
  end loop;
end $$;
select is((select count(*)::int from private.meetup_attendance where session_id='ab200000-0000-4000-8000-000000000001' and confirmed_at is not null and user_id<>pg_temp.u('h')),9,'Nine accounts are checked in and confirmed at the host''s meetup');
select is((select count(*)::int from private.meetup_attendance where check_in_method='qr' and confirmed_at is not null
  and (session_id,user_id) in (('ab200000-0000-4000-8000-000000000002',pg_temp.u('i3')),('ab200000-0000-4000-8000-000000000004',pg_temp.u('i2')))),2,'i2 and i3 are QR-checked and confirmed at their meetups');

-- 메일 별칭: 기기를 다 다르게 등록해도 모임장과 같은 사람으로 잡힌다.
select is(pg_temp.reason('ab200000-0000-4000-8000-000000000001','b'),'same_person','A plus alias of the host does not count');
select is(pg_temp.reason('ab200000-0000-4000-8000-000000000001','c'),'same_person','A Gmail dot alias of the host does not count');
select is(pg_temp.reason('ab200000-0000-4000-8000-000000000001','d'),'same_person','A googlemail alias of the host does not count');
-- 참석자끼리: 한 기기 여러 계정, 같은 메일의 + 별칭.
select is(pg_temp.reason('ab200000-0000-4000-8000-000000000001','m'),'same_device','Two accounts on one device: first does not count');
select is(pg_temp.reason('ab200000-0000-4000-8000-000000000001','n'),'same_device','Two accounts on one device: second does not count');
select is(pg_temp.reason('ab200000-0000-4000-8000-000000000001','p1'),'same_device','Two attendees with one inbox (plus alias): first does not count');
select is(pg_temp.reason('ab200000-0000-4000-8000-000000000001','p2'),'same_device','Two attendees with one inbox (plus alias): second does not count');
select is(pg_temp.reason('ab200000-0000-4000-8000-000000000001','r1'),null,'A distinct attendee still counts');
select private.evaluate_host_quest(pg_temp.quest('h'));
select is((select count(*)::int from private.host_quest_steps where quest_id=pg_temp.quest('h') and step in (1,2) and status<>'cancelled'),0,'Nine accounts of a few people do not earn the first meetup');

-- 4단계는 다른 모임장 모임에서 QR로 체크인하고 서로 확인한 초대 회원만 센다.
select is(pg_temp.invitee('i1'),'waiting','An invitee seen only at the host''s own meetup does not count');
select is(pg_temp.invitee('i2'),'waiting','A meetup hosted by the host''s second account does not count');
select is(pg_temp.invitee('i3'),'waiting','A meetup hosted by the same person as the invitee does not count');
select is((select string_agg(i.reason,',' order by k) from unnest(array['b','c','d']) k cross join lateral private.host_quest_invitee(pg_temp.quest('h'),pg_temp.u(k)) i),
  'same_person,same_person,same_person','Mail alias invitees are the host');
select is((select count(*)::int from private.host_quest_steps where quest_id=pg_temp.quest('h') and step=4 and status<>'cancelled'),0,'None of these invitees adds to step 4');

-- 4시간 넘는 체크인 창이나 시작 24시간 안에 잡은 모임은 서로 다른 4명이 와도 퀘스트 모임이 아니다.
insert into private.meetup_sessions(id,post_id,host_id,starts_at,ends_at,created_at) values
 ('ab200000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000001',pg_temp.u('h'),now()-interval '7 days',now()-interval '2 hours',now()-interval '9 days');
insert into private.meetup_attendance(session_id,user_id,checked_in_at,check_in_method,check_in_device,confirmed_at,confirmation_source)
  select 'ab200000-0000-4000-8000-000000000003',pg_temp.u(k),now()-interval '3 hours','qr',
    (select device_hash from private.account_security_sessions where session_id=pg_temp.sid(k)),now()-interval '1 hour','admin'
  from unnest(array['r1','r2','r3','r4']) k;
select is(private.host_quest_session_problem('ab200000-0000-4000-8000-000000000003'),'too_long','A 7-day check-in window is not a quest meetup');
update private.meetup_sessions set ends_at=starts_at+interval '2 hours', created_at=starts_at-interval '1 hour' where id='ab200000-0000-4000-8000-000000000003';
select is(private.host_quest_session_problem('ab200000-0000-4000-8000-000000000003'),'late_notice','A meetup set up an hour before is not a quest meetup');
select private.evaluate_host_quest(pg_temp.quest('h'));
select is((select count(*)::int from private.host_quest_steps where quest_id=pg_temp.quest('h') and status<>'cancelled'
  and 'ab200000-0000-4000-8000-000000000003'::uuid=any(session_ids)),0,'Four people in an unannounced session earn nothing');

-- $50이 다 차도 사진 속 사람 수와 참석자 2명 확인 전에는 "보냄"이 안 된다. 두 번 눌러도 한 번만 보낸다.
delete from private.host_quest_steps where quest_id=pg_temp.quest('h');
insert into private.host_quest_steps(quest_id,step,amount_cents,status,session_ids,person_ids,person_id)
  select pg_temp.quest('h'),x.step,x.amount,'confirmed',array['ab200000-0000-4000-8000-000000000001'::uuid],
    case when x.step=2 then array[pg_temp.u('r1'),pg_temp.u('r2'),pg_temp.u('r3')] else '{}' end,null
  from (values (1,100),(2,500),(3,500),(5,1000),(6,400),(7,1500)) x(step,amount);
insert into private.host_quest_steps(quest_id,step,amount_cents,status,person_id)
  select pg_temp.quest('h'),4,100,'confirmed',gen_random_uuid() from generate_series(1,10);
update private.host_quest_codes set recipient_name='Host Kim' where code=(select v from ctx where k='code1');
select pg_temp.act('h'); set local role authenticated;
select lives_ok($$select public.request_host_quest_payout('hostg@gmail.com','Host Kim')$$,'Host requests $50');
reset role;
select pg_temp.act('b'); set local role authenticated;
select throws_ok($$select public.request_host_quest_payout('h.ostg+again@gmail.com','Host Kim')$$,'P0001','QUEST_NOT_FOUND','An alias account has no quest to cash out');
reset role;
select pg_temp.act('z'); set local role authenticated;
select throws_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest('h'),'sent','9999',true)$$,'P0001','PHOTO_PEOPLE_REQUIRED','$50 filled, but no photo head count: cannot mark sent');
select lives_ok($$select public.set_admin_host_quest_photo_people(pg_temp.quest('h'),2)$$,'Admin enters the photo head count');
select throws_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest('h'),'sent','9999',true)$$,'P0001','ATTENDEE_CHECKS_REQUIRED','$50 filled, but no attendee checks: cannot mark sent');
select ok(public.ask_admin_host_quest_attendee(pg_temp.quest('h'),pg_temp.u('r1')) is not null,'Admin asks attendee r1');
select lives_ok($$select public.record_admin_host_quest_check(pg_temp.quest('h'),pg_temp.u('r1'),'yes')$$,'r1 says yes');
select throws_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest('h'),'sent','9999',true)$$,'P0001','ATTENDEE_CHECKS_REQUIRED','One check is not enough');
select ok(public.ask_admin_host_quest_attendee(pg_temp.quest('h'),pg_temp.u('r2')) is not null,'Admin asks attendee r2');
select lives_ok($$select public.record_admin_host_quest_check(pg_temp.quest('h'),pg_temp.u('r2'),'yes')$$,'r2 says yes');
select lives_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest('h'),'sent','9999',true)$$,'Sent after both checks');
select throws_ok($$select public.settle_admin_host_quest_payout(pg_temp.quest('h'),'sent','9999',true)$$,'P0001','PAYOUT_ALREADY_SENT','A second press does not pay twice');
reset role;
select is((select count(*)::int from private.host_quest_payouts where quest_id=pg_temp.quest('h') and status='sent'),1,'Exactly one payout');

select * from finish();
rollback;
