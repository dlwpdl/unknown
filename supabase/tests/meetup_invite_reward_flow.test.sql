begin;
set local search_path=public,extensions;
select no_plan();

-- The whole invite reward path through the app's own RPCs, as each signed-in account (what PostgREST does):
-- a code on a meetup link → sign-up → request → host approves → both check in → the meetup ends → host and guest
-- confirm each other → the sharer gets Plus 2 weeks, or Pro 2 weeks when the sharer hosts meetups (owner 2026-11-13).
-- A friend the host brought counts only at a meetup somebody else hosts (owner 2026-11-13 inbox adb25323 Q1).
insert into auth.users(id,email) select ('9f000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'reward-flow-'||n||'@example.invalid' from generate_series(1,5)n;
-- 1 member who shares a meetup (never hosted), 2 host, 3 friend from member 1's link, 4 friend from the host's own link,
-- 5 another host whose meetup the host's friend joins later.
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'보상'||right(id::text,1),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '9f000000-%';
insert into private.chilling_profiles(id,profile) select id,'{"intro":"Reward flow fixture","interests":[],"promptOne":"","promptTwo":""}'
  from auth.users where id::text like '9f000000-%';
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values
 ('9f100000-0000-4000-8000-000000000001','9f000000-0000-4000-8000-000000000002','vancouver',(select id from public.tags where kind='meetup' limit 1),
  '목요일 보드게임','매주 목요일에 모여요.',current_date,'{"eventKind":"group","cadence":"매주 목요일","capacity":8,"memberCount":1,"access":"public"}'),
 ('9f100000-0000-4000-8000-000000000002','9f000000-0000-4000-8000-000000000005','vancouver',(select id from public.tags where kind='meetup' limit 1),
  '토요일 러닝','토요일 아침에 같이 뛰어요.',current_date,'{"eventKind":"group","cadence":"매주 토요일","capacity":8,"memberCount":1,"access":"public"}');
create temp table rev as select id,updated_at::text r from private.chilling_profiles where id::text like '9f000000-%';
grant select on rev to anon,authenticated;
create function pg_temp.act(p_user int) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub','9f000000-0000-4000-8000-'||lpad(p_user::text,12,'0'),'role','authenticated')::text,true);
$$;
create function pg_temp.u(p_user int) returns uuid language sql immutable as $$ select ('9f000000-0000-4000-8000-'||lpad(p_user::text,12,'0'))::uuid $$;
grant execute on function pg_temp.act(int),pg_temp.u(int) to anon,authenticated;

-- ① The share sheet makes (or reuses) each sharer's personal code and puts it on the meetup link.
select pg_temp.act(1); set local role authenticated;
select lives_ok($$select public.create_invite_link()$$,'The sharing member gets a personal code');
reset role;
select pg_temp.act(2); set local role authenticated;
select lives_ok($$select public.create_invite_link()$$,'The host gets a personal code too');
reset role;
create temp table codes as select owner_id,code from private.invite_links where owner_id::text like '9f000000-%' and merchant_id is null;
grant select on codes to anon,authenticated;

-- ② Before signing up, the invitation names who shared it.
select set_config('request.jwt.claims','{"role":"anon"}',true); set local role anon;
select is(public.get_meetup_invite_card('9f100000-0000-4000-8000-000000000001',(select code from codes where owner_id=pg_temp.u(1)))->>'inviter','보상1',
  'The invitation names the member whose code is on the link');
reset role;

-- ③ Signing up links the remembered code once (auth.tsx claimRememberedInvite).
select pg_temp.act(3); set local role authenticated;
select is(public.claim_invite_code((select code from codes where owner_id=pg_temp.u(1)))->>'linked','true','A new member from the shared link is linked to the sharer');
select lives_ok($$select public.request_chilling_join_v2('9f100000-0000-4000-8000-000000000001','보드게임은 처음이에요','chilling-v2',(select r from rev where id=pg_temp.u(3)))$$,
  'They request a spot the way the app and the web do');
reset role;
select pg_temp.act(4); set local role authenticated;
select is(public.claim_invite_code((select code from codes where owner_id=pg_temp.u(2)))->>'linked','true','A new member from the host''s own link is linked to the host');
select lives_ok($$select public.request_chilling_join_v2('9f100000-0000-4000-8000-000000000001','같이 하고 싶어요','chilling-v2',(select r from rev where id=pg_temp.u(4)))$$,
  'The host''s friend requests a spot');
reset role;

-- ④ The host accepts both and opens tonight's session; everyone checks in on the spot.
select pg_temp.act(2); set local role authenticated;
select lives_ok($$select public.respond_meetup_request_v2((select id from public.meetup_requests where requester_id=pg_temp.u(3)),'approved',false)$$,'Host accepts the shared friend');
select lives_ok($$select public.respond_meetup_request_v2((select id from public.meetup_requests where requester_id=pg_temp.u(4)),'approved',false)$$,'Host accepts their own friend');
select lives_ok($$select public.create_meetup_session('9f100000-0000-4000-8000-000000000001',now()-interval '1 hour',now()+interval '1 hour')$$,'Host opens tonight''s session');
reset role;
create temp table sess as select id from private.meetup_sessions where post_id='9f100000-0000-4000-8000-000000000001';
grant select on sess to authenticated;
select pg_temp.act(2); set local role authenticated;
select lives_ok($$select public.check_in_meetup((select id from sess))$$,'Host checks in');
reset role;
select pg_temp.act(3); set local role authenticated;
select lives_ok($$select public.check_in_meetup((select id from sess))$$,'The shared friend checks in');
reset role;
select pg_temp.act(4); set local role authenticated;
select lives_ok($$select public.check_in_meetup((select id from sess))$$,'The host''s friend checks in');
reset role;
select is((select count(*)::int from private.invite_rewards where user_id in (pg_temp.u(1),pg_temp.u(2))),0,'Signing up, requesting and checking in grant nothing yet');

-- ⑤ The evening ends (one transaction keeps one now(), so the session moves into the past), then host and guest confirm each other.
update private.meetup_sessions set starts_at=now()-interval '3 hours',ends_at=now()-interval '1 minute' where id=(select id from sess);
select pg_temp.act(2); set local role authenticated;
select lives_ok($$select public.confirm_meetup_attendance((select id from sess),pg_temp.u(3))$$,'Host confirms the shared friend came');
select lives_ok($$select public.confirm_meetup_attendance((select id from sess),pg_temp.u(4))$$,'Host confirms their own friend came');
reset role;
select is((select count(*)::int from private.invite_rewards where user_id in (pg_temp.u(1),pg_temp.u(2))),0,'One side confirming is not attendance yet');
select pg_temp.act(3); set local role authenticated;
select lives_ok($$select public.confirm_meetup_attendance((select id from sess),pg_temp.u(2))$$,'The shared friend confirms the host');
reset role;
select pg_temp.act(4); set local role authenticated;
select lives_ok($$select public.confirm_meetup_attendance((select id from sess),pg_temp.u(2))$$,'The host''s friend confirms the host');
reset role;

-- ⑥ The rewards.
select is((select tier||':'||days||':'||reason from private.invite_rewards where invitee_id=pg_temp.u(3)),'plus:14:attended','The sharing member gets Plus for 2 weeks');
select is((select user_id from private.invite_rewards where invitee_id=pg_temp.u(3)),pg_temp.u(1),'…credited to the member who shared the link');
select is((select count(*)::int from private.invite_rewards where invitee_id=pg_temp.u(4)),0,'The host''s own meetup does not count for the friend the host brought');
select is((select coalesce(outcome,'waiting') from private.invite_redemptions where invitee_id=pg_temp.u(4)),'waiting','…the host''s invite keeps waiting');
select pg_temp.act(1); set local role authenticated;
select is(public.get_membership()->>'tier','plus','The sharing member''s membership reads Plus now');
select is((public.get_my_invite()->>'rewarded')::int||'/'||(public.get_my_invite()->>'grantedDays')::int,'1/14','Their invite screen shows one reward of 14 days');
reset role;

-- ⑦ The host's friend joins another host's meetup the same way; once that one is confirmed, the host gets Pro.
-- The 60-second gap between two join requests has passed by then (one transaction keeps one now()).
update private.action_rate_events set created_at=created_at-interval '1 day' where user_id=pg_temp.u(4) and action='meetup_request';
select pg_temp.act(4); set local role authenticated;
select lives_ok($$select public.request_chilling_join_v2('9f100000-0000-4000-8000-000000000002','러닝도 해 보고 싶어요','chilling-v2',(select r from rev where id=pg_temp.u(4)))$$,
  'The host''s friend requests a spot at another host''s meetup');
reset role;
select pg_temp.act(5); set local role authenticated;
select lives_ok($$select public.respond_meetup_request_v2((select id from public.meetup_requests where requester_id=pg_temp.u(4) and post_id='9f100000-0000-4000-8000-000000000002'),'approved',false)$$,
  'The other host accepts');
select lives_ok($$select public.create_meetup_session('9f100000-0000-4000-8000-000000000002',now()-interval '1 hour',now()+interval '1 hour')$$,'The other host opens a session');
reset role;
create temp table sess2 as select id from private.meetup_sessions where post_id='9f100000-0000-4000-8000-000000000002';
grant select on sess2 to authenticated;
select pg_temp.act(5); set local role authenticated;
select lives_ok($$select public.check_in_meetup((select id from sess2))$$,'The other host checks in');
reset role;
select pg_temp.act(4); set local role authenticated;
select lives_ok($$select public.check_in_meetup((select id from sess2))$$,'The host''s friend checks in there');
reset role;
update private.meetup_sessions set starts_at=now()-interval '3 hours',ends_at=now()-interval '1 minute' where id=(select id from sess2);
select pg_temp.act(5); set local role authenticated;
select lives_ok($$select public.confirm_meetup_attendance((select id from sess2),pg_temp.u(4))$$,'The other host confirms the friend came');
reset role;
select pg_temp.act(4); set local role authenticated;
select lives_ok($$select public.confirm_meetup_attendance((select id from sess2),pg_temp.u(5))$$,'The friend confirms the other host');
reset role;
select is((select tier||':'||days||':'||reason from private.invite_rewards where invitee_id=pg_temp.u(4)),'pro:14:attended','A host who brought a friend gets Pro for 2 weeks');
select is((select user_id from private.invite_rewards where invitee_id=pg_temp.u(4)),pg_temp.u(2),'…credited to the host who shared their link');
select is((select string_agg(outcome,',' order by invitee_id) from private.invite_redemptions where invitee_id in (pg_temp.u(3),pg_temp.u(4))),'rewarded,rewarded','Both links are marked rewarded');
select pg_temp.act(2); set local role authenticated;
select is(public.get_membership()->>'tier','pro','The host''s membership reads Pro now');
reset role;

-- ⑧ Confirming again (another path touching confirmed_at) does not pay out twice.
update private.meetup_attendance set confirmed_at=confirmed_at where session_id in ((select id from sess),(select id from sess2));
select is((select count(*)::int from private.invite_rewards where invitee_id in (pg_temp.u(3),pg_temp.u(4))),2,'Each friend pays out once');

select * from finish();
rollback;
