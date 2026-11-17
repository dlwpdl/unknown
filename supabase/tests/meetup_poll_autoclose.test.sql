begin;
select no_plan();

insert into public.cities(id,name,province,timezone) values('pollclose-test','PollClose','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label) values(31997,'pollclose-test','PollClose') on conflict do nothing;
insert into auth.users(id,email,raw_app_meta_data)
select ('a1810000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'pollclose-'||n||'@example.invalid','{}' from generate_series(1,4)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at)
select id,'pclose'||right(id::text,2),'pollclose-test',now(),now(),now() from auth.users where id::text like 'a1810000%';
insert into private.chilling_profiles(id,profile)
select id,'{"intro":"함께 걸어요","interests":["산책"],"promptOne":"공원","promptTwo":"주말"}' from public.profiles where id::text like 'a1810000%';
-- Eight meetups for one host is more than the hosting and joining limits allow, so the fixtures skip those guards.
set local session_replication_role=replica;
-- 1 host, 2 and 3 approved members, 4 member who never votes. P1 once, P2 group, P3 group, P4 group, P5 once, P6 once, P7 once, P8 group
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select ('a1820000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'a1810000-0000-0000-0000-000000000001','pollclose-test',31997,'모임 '||n,'본문 첫 줄',current_date,
  case when n in(1,5,6,7) then jsonb_build_object('eventKind','once','capacity',8,'startsAt',now()+interval '10 days','endsAt',now()+interval '10 days 2 hours','timezone','America/Vancouver')
    else '{"eventKind":"group","capacity":8,"cadence":"매주"}'::jsonb end
from generate_series(1,8)n;
reset session_replication_role;
insert into private.membership_accounts(user_id,entitlements,observed_at)
select id,jsonb_build_array(jsonb_build_object('tier','pro','kind','general','plan_version','2','expires_at',now()+interval '30 days')),now() from auth.users where id::text like 'a1810000%';
insert into public.meetup_requests(post_id,host_id,requester_id,status)
select p.id,'a1810000-0000-0000-0000-000000000001',('a1810000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'approved'
from public.posts p cross join generate_series(2,4)n where p.id::text like 'a1820000%';

-- Test helper: an open poll made three hours ago. dates = hours from now, places = labels.
create function pg_temp.mk(p_post int,p_dates int[],p_places text[]) returns uuid language plpgsql as $$
declare poll uuid:=gen_random_uuid(); n int:=0; d int; l text;
begin
  insert into private.meetup_polls(id,post_id,created_by,created_at)
    values(poll,('a1820000-0000-0000-0000-'||lpad(p_post::text,12,'0'))::uuid,'a1810000-0000-0000-0000-000000000001',now()-interval '3 hours');
  foreach d in array p_dates loop n:=n+1; insert into private.meetup_poll_options(poll_id,kind,starts_at,position) values(poll,'date',now()+d*interval '1 hour',n); end loop;
  foreach l in array p_places loop n:=n+1; insert into private.meetup_poll_options(poll_id,kind,label,position) values(poll,'place',l,n); end loop;
  return poll;
end $$;
create function pg_temp.vote(p_poll uuid,p_pos int,p_user int) returns void language sql as $$
  insert into private.meetup_poll_votes(option_id,user_id)
  select o.id,('a1810000-0000-0000-0000-'||lpad(p_user::text,12,'0'))::uuid from private.meetup_poll_options o where o.poll_id=p_poll and o.position=p_pos $$;

select ok(position('private.close_meetup_polls()' in (select command from cron.job where jobname='gling-meetup-tidy'))>0,'the existing tidy job runs the poll closer');
select ok(not has_function_privilege('authenticated','private.close_meetup_polls(timestamptz)','execute'),'clients cannot run the closer');

-- A poll opened the normal way reports when it closes: a day before its earliest date.
select set_config('request.jwt.claims','{"sub":"a1810000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.create_meetup_poll('a1820000-0000-0000-0000-000000000008',array[now()+interval '4 days',now()+interval '6 days'],'{}') as poll8 \gset
select ok(abs(extract(epoch from (public.get_meetup_poll('a1820000-0000-0000-0000-000000000008')->>'autoCloseAt')::timestamptz-(now()+interval '3 days')))<5,'the card gets autoCloseAt = earliest date minus 24 hours');
reset role;
select is((select private.close_meetup_polls()),0,'nothing is due yet');
select is((select status from private.meetup_polls where id=:'poll8'),'open','a poll that is not due stays open');

-- 1. Once-meetup date poll, one clear winner: decided through decide_meetup_poll (schedule moves, one change notice).
select pg_temp.mk(1,array[20,30],'{}') as p1 \gset
select pg_temp.vote(:'p1',1,2); select pg_temp.vote(:'p1',2,3); select pg_temp.vote(:'p1',2,4); select pg_temp.vote(:'p1',2,1);
-- 2. Group, tie on the date: closed, not decided.
select pg_temp.mk(2,array[20,30],'{}') as p2 \gset
select pg_temp.vote(:'p2',1,2); select pg_temp.vote(:'p2',2,3);
-- 3. Group, nobody voted.
select pg_temp.mk(3,array[20,30],'{}') as p3 \gset
-- 5. Once, the leading date has already passed: falls back to closing.
select pg_temp.mk(5,array[-1,40],'{}') as p5 \gset
select pg_temp.vote(:'p5',1,2); select pg_temp.vote(:'p5',1,3);
-- 6. Once, date has a winner but the place is tied: nothing is decided.
select pg_temp.mk(6,array[20,30],array['가','나']) as p6 \gset
select pg_temp.vote(:'p6',2,2); select pg_temp.vote(:'p6',3,2); select pg_temp.vote(:'p6',4,3);
-- 7. The meetup was closed by its host: the poll closes without a word.
select pg_temp.mk(7,array[20,30],'{}') as p7 \gset
set local session_replication_role=replica; -- a host's own closing would count toward the host-closing limit
update public.posts set room_preview=room_preview||'{"closed":true}' where id='a1820000-0000-0000-0000-000000000007';
reset session_replication_role;
-- 9. The host's notice cannot be made: this poll is skipped and stays open, the others still close.
set local session_replication_role=replica;
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
values('a1820000-0000-0000-0000-000000000009','a1810000-0000-0000-0000-000000000001','pollclose-test',31997,'실패유도 모임','본문',current_date,'{"eventKind":"group","capacity":8,"cadence":"매주"}');
reset session_replication_role;
create function public.pollclose_fail_notice() returns trigger language plpgsql as $$ begin if new.body like '%실패유도%' then raise exception 'NOTICE_FAILED'; end if; return new; end $$;
create trigger pollclose_fail_notice before insert on public.notifications for each row execute function public.pollclose_fail_notice();
select pg_temp.mk(9,array[20,30],'{}') as p9 \gset
-- 4. Group, place only, no session yet: never closes.
select pg_temp.mk(4,'{}',array['강가','카페']) as p4 \gset
select pg_temp.vote(:'p4',2,2); select pg_temp.vote(:'p4',2,3);
select is(private.meetup_poll_deadline(:'p4'),null,'a place poll with no session has no deadline');
select ok(private.meetup_poll_deadline(:'p1')<=now(),'a poll opened less than a day before the date closes after its one-hour grace');

select set_config('request.jwt.claims','{"sub":"a1810000-0000-0000-0000-000000000009","role":"authenticated"}',true);
select is((select private.close_meetup_polls()),6,'six due polls were handled; the sessionless place poll was not');
select is(current_setting('request.jwt.claims',true),'{"sub":"a1810000-0000-0000-0000-000000000009","role":"authenticated"}','the caller identity is put back');

select is((select status from private.meetup_polls where id=:'p1'),'decided','clear winner: decided');
select is((select ((room_preview->>'startsAt')::timestamptz)=(select starts_at from private.meetup_poll_options where poll_id=:'p1' and position=2) from public.posts where id='a1820000-0000-0000-0000-000000000001'),true,'the once-meetup moved to the winning date');
select is((select count(*)::int from public.notifications where body like '%시간이나 장소가 바뀌었어요%' and user_id='a1810000-0000-0000-0000-000000000002'),1,'members get the standard change notice once');
select is((select count(*)::int from public.notifications where user_id='a1810000-0000-0000-0000-000000000001' and kind='meetup_changed' and body like '%표가 가장 많은 후보로 정해졌어요%'),1,'the host hears the result');
select is((select count(*)::int from public.notifications where kind='meetup_changed' and body like '%투표 결과가 나왔어요%'),0,'no second result notice');

select is((select status from private.meetup_polls where id=:'p2'),'closed','tie: closed');
select is((select count(*)::int from private.meetup_sessions where post_id='a1820000-0000-0000-0000-000000000002'),0,'tie: no session was created');
select is((select count(*)::int from private.meetup_poll_options where poll_id=:'p2' and chosen),0,'tie: nothing was picked');
select is((select count(*)::int from public.notifications where user_id='a1810000-0000-0000-0000-000000000001' and target_id='a1820000-0000-0000-0000-000000000002' and body like '%직접 골라 주세요%'),1,'tie: the host is asked to pick, once');
select is((select status from private.meetup_polls where id=:'p3'),'closed','no votes: closed');
select is((select count(*)::int from public.notifications where target_id='a1820000-0000-0000-0000-000000000003' and body like '%직접 골라 주세요%'),1,'no votes: the host is asked to pick');
select is((select status from private.meetup_polls where id=:'p5'),'closed','a passed winning date: closed, not applied');
select is((select ((room_preview->>'startsAt')::timestamptz)>now()+interval '9 days' from public.posts where id='a1820000-0000-0000-0000-000000000005'),true,'a passed winning date: the meetup stays as it was');
select is((select status from private.meetup_polls where id=:'p6'),'closed','a tied place keeps the whole poll undecided');
select is((select count(*)::int from private.meetup_poll_options where poll_id=:'p6' and chosen),0,'a tied place: the clear date is not applied alone');
select is((select status from private.meetup_polls where id=:'p7'),'closed','a closed meetup: poll closed');
select is((select count(*)::int from public.notifications where target_id='a1820000-0000-0000-0000-000000000007' and kind='meetup_changed'),0,'a closed meetup: no notification');
select is((select status from private.meetup_polls where id=:'p4'),'open','a place poll with no session stays open');

select is((select status from private.meetup_polls where id=:'p9'),'open','a poll whose notice fails stays open, the sweep still ran to the end');
select is((select private.close_meetup_polls()),0,'a second run changes nothing (the failing poll is tried again and skipped again)');
select is((select count(*)::int from public.notifications where body like '%직접 골라 주세요%'),4,'the host is asked once per closed poll, not again');

-- The next session decides the place poll: a session in 20 hours closes it, the most-voted place goes into the body.
insert into private.meetup_sessions(post_id,host_id,starts_at,ends_at)
values('a1820000-0000-0000-0000-000000000004','a1810000-0000-0000-0000-000000000001',now()+interval '20 hours',now()+interval '22 hours');
select is((select private.close_meetup_polls()),1,'the place poll is due once a session is within a day');
select is((select status from private.meetup_polls where id=:'p4'),'decided','place poll: decided');
select ok((select body from public.posts where id='a1820000-0000-0000-0000-000000000004') like E'%\n\n장소: 카페','place poll: the winning place is on the place line');
select is((select count(*)::int from public.notifications where kind='meetup_changed' and user_id::text like 'a1810000%' and route not like '/post/%' and route not like '/chat?conversationId=%'),0,'every notice opens a post or chat, as released apps expect');

select * from finish();
rollback;
