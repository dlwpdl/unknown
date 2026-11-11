begin;
set local search_path=public,extensions;
select no_plan();
-- 01 host · 02,03 approved (v3) · 04 pending · 05 rejected · 06 viewer · 07,08,13,14 block/report viewers
-- 09 friend of 12 · 10 non-friend follower · 11,15,16 link guests · 12 invite host · 17 approved with old v2 text
-- 18 old-app host · 19 old member · 20 old pending
insert into auth.users(id,email) select ('5a0b0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'meetup-members-'||n||'@example.invalid' from generate_series(1,20) n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'General '||right(id::text,2),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '5a0b0000-%';
create temporary table meetup_people(n integer primary key, name text, intro text, share boolean) on commit drop;
grant all on meetup_people to authenticated;
insert into meetup_people values (1,'Host One','Host intro',false),(2,'Member Two','Intro two',false),(3,'Member Three','Intro three',true),
  (4,'Pending Four','Intro four',false),(5,'Rejected Five','Intro five',false),(11,'Link Eleven','Intro eleven',false),
  (12,'Invite Host','Invite host intro',false),(17,'Old Seventeen','Intro seventeen',false),(18,'Old Host','Old host intro',false),
  (19,'Old Nineteen','Intro nineteen',false),(20,'Old Twenty','Intro twenty',false);
create function pg_temp.act(n integer) returns void language sql as $$
  select set_config('request.jwt.claims',json_build_object('sub','5a0b0000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated')::text,true);
$$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$ select ('5a0b0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.names(roster jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(e->>'displayName' order by o),'{}') from jsonb_array_elements(roster) with ordinality x(e,o) $$;
grant execute on function pg_temp.act(integer),pg_temp.uid(integer),pg_temp.names(jsonb) to authenticated;

-- Everyone with a meetup profile saves one (version 2, photos none, preferences private).
do $$ declare person record; begin
  for person in select * from meetup_people loop
    perform pg_temp.act(person.n);
    perform public.save_chilling_profile(jsonb_build_object('version',2,'displayName',person.name,'cityId','vancouver','photoPaths','[]'::jsonb,
      'publicPhotoPath',null,'intro',person.intro,'interests',jsonb_build_array('walk'),'promptOne','Secret prompt answer','promptTwo','Another secret',
      'promptOneId','meet','promptTwoId','join','shareWithMembers',person.share,
      'preferences',jsonb_build_object('activities',jsonb_build_array('walk'),'availability','Owner secret','pace','relaxed')));
  end loop;
end $$;
insert into private.host_follows(follower_id,host_id) values(pg_temp.uid(10),pg_temp.uid(1)),(pg_temp.uid(10),pg_temp.uid(12));

-- Public meetup: applicants see host and approved members.
select pg_temp.act(1);
set local role authenticated;
select set_config('test.pub',public.create_chilling_event('vancouver','Public walk club','Synthetic meetup',
  '{"eventKind":"group","cadence":"weekly","capacity":10,"hostProfileConsentVersion":"chilling-v2","access":"public"}'::jsonb
  ||jsonb_build_object('hostProfileRevision',public.get_my_chilling_profile()->>'revision'),'Question?')::text,true);
select is((select room_preview->>'access'||'/'||(room_preview->>'membersVisible') from public.posts where id=current_setting('test.pub')::uuid),'public/true','new public meetup shows members');
select throws_ok($$select public.create_chilling_event('vancouver','Bad access','Synthetic meetup','{"eventKind":"group","cadence":"weekly","capacity":10,"access":"secret"}','Q?')$$,'P0001','INVALID_CHILLING_EVENT','unknown access value rejected');
reset role;
do $$ declare n integer; begin
  foreach n in array array[2,3,4,5,17] loop
    perform pg_temp.act(n);
    perform set_config('test.req'||n,public.request_chilling_join_v2(current_setting('test.pub')::uuid,'Secret answer '||n,
      case when n=17 then 'chilling-v2' else 'chilling-v3' end,
      (select updated_at::text from private.chilling_profiles where id=pg_temp.uid(n)))::text,true);
  end loop;
  perform pg_temp.act(1);
  perform public.respond_meetup_request(current_setting('test.req2')::uuid,'approved');
  perform public.respond_meetup_request(current_setting('test.req3')::uuid,'approved');
  perform public.respond_meetup_request(current_setting('test.req17')::uuid,'approved');
  perform public.respond_meetup_request(current_setting('test.req5')::uuid,'rejected');
end $$;
-- respond_meetup_request stamps now(); spread the approvals so the roster order is checkable.
update public.meetup_requests set responded_at=now()+interval '1 minute' where id=current_setting('test.req3')::uuid;

select pg_temp.act(6);
set local role authenticated;
select is(pg_temp.names(public.get_meetup_public_roster(current_setting('test.pub')::uuid)),array['Host One','Member Two','Member Three'],
  'a member who has not applied sees the host and approved members, not pending, rejected or old-text members');
select is((select e->>'intro' from jsonb_array_elements(public.get_meetup_public_roster(current_setting('test.pub')::uuid)) e where e->>'displayName'='Member Two'),
  'Intro two','intro shows even with the photo switch off');
select ok(not exists(select 1 from jsonb_array_elements(public.get_meetup_public_roster(current_setting('test.pub')::uuid)) e
  where e ?| array['photoPaths','publicPhotoPath','cityId','answer','promptOne','promptTwo','preferences']),'no photo, area, answer or preference fields');
select ok(public.get_meetup_public_roster(current_setting('test.pub')::uuid)::text !~ '(Secret|vancouver|Owner secret)','no answer, prompt or area text anywhere');
select ok(exists(select 1 from public.get_public_feed_page_v2('vancouver') f where f.id=current_setting('test.pub')::uuid),'public meetup is in the feed');
reset role;

-- Blocks and reports drop the pair in both directions.
insert into public.blocks(blocker_id,blocked_id) values(pg_temp.uid(7),pg_temp.uid(2)),(pg_temp.uid(3),pg_temp.uid(8));
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code) values
  (pg_temp.uid(13),pg_temp.uid(2),'user',pg_temp.uid(2),'harassment'),(pg_temp.uid(3),pg_temp.uid(14),'user',pg_temp.uid(14),'harassment');
select pg_temp.act(7);
set local role authenticated;
select is(pg_temp.names(public.get_meetup_public_roster(current_setting('test.pub')::uuid)),array['Host One','Member Three'],'viewer who blocked a member no longer sees them');
reset role;
select pg_temp.act(8);
set local role authenticated;
select is(pg_temp.names(public.get_meetup_public_roster(current_setting('test.pub')::uuid)),array['Host One','Member Two'],'member who blocked the viewer is hidden from them');
reset role;
select pg_temp.act(13);
set local role authenticated;
select is(pg_temp.names(public.get_meetup_public_roster(current_setting('test.pub')::uuid)),array['Host One','Member Three'],'viewer who reported a member no longer sees them');
reset role;
select pg_temp.act(14);
set local role authenticated;
select is(pg_temp.names(public.get_meetup_public_roster(current_setting('test.pub')::uuid)),array['Host One','Member Two'],'member who reported the viewer is hidden from them');
reset role;

-- Logged out.
set local role anon;
select throws_ok($$select public.get_meetup_public_roster(current_setting('test.pub')::uuid)$$,'42501',null,'logged-out visitors cannot read the roster');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_meetup_public_roster(current_setting('test.pub')::uuid)$$,'P0001','AUTH_REQUIRED','a session without a user is refused');
reset role;

-- Inside the meetup the switch only decides photos; area stays hidden.
select pg_temp.act(3);
set local role authenticated;
select is(public.get_chilling_member_profile(current_setting('test.pub')::uuid,pg_temp.uid(2))->>'intro','Intro two','fellow member sees intro with the photo switch off');
select is(public.get_chilling_member_profile(current_setting('test.pub')::uuid,pg_temp.uid(2))->>'cityId',null,'fellow member does not see area');
select is(public.get_chilling_member_profile(current_setting('test.pub')::uuid,pg_temp.uid(17))->>'intro','','old-text member keeps intro hidden while their switch is off');
reset role;

-- Nobody can change who may apply after opening.
select throws_ok($$update public.posts set room_preview=room_preview||'{"access":"invite"}' where id=current_setting('test.pub')::uuid$$,'P0001','MEETUP_ACCESS_FIXED','access is fixed');
select throws_ok($$update public.posts set room_preview=room_preview-'membersVisible' where id=current_setting('test.pub')::uuid$$,'P0001','MEETUP_ACCESS_FIXED','members stay visible once on');

-- Invite meetup: only its people see it.
select pg_temp.act(12);
set local role authenticated;
select set_config('test.inv',public.create_chilling_event('vancouver','Secret garden picnic','Synthetic invite meetup',
  '{"eventKind":"group","cadence":"weekly","capacity":10,"hostProfileConsentVersion":"chilling-v2","access":"invite"}'::jsonb
  ||jsonb_build_object('hostProfileRevision',public.get_my_chilling_profile()->>'revision'),'Question?')::text,true);
select is((select room_preview->>'access'||'/'||(room_preview->>'membersVisible') from public.posts where id=current_setting('test.inv')::uuid),'invite/false','invite meetup keeps members hidden');
select is(public.get_meetup_public_roster(current_setting('test.inv')::uuid),null::jsonb,'invite meetup has no public roster, even for its host');
reset role;
select ok(exists(select 1 from public.notifications where user_id=pg_temp.uid(10) and target_id=current_setting('test.pub')::uuid),'followers hear about public meetups');
select ok(not exists(select 1 from public.notifications where target_type='post' and target_id=current_setting('test.inv')::uuid),'nobody outside hears about the invite meetup');
select ok(not private.notification_target_visible(pg_temp.uid(10),'post',current_setting('test.inv')::uuid),'invite meetup is not a notification target for outsiders');

select pg_temp.act(6);
set local role authenticated;
select ok(not exists(select 1 from public.get_public_feed_page_v2('vancouver') f where f.id=current_setting('test.inv')::uuid),'invite meetup is not in the feed or map');
select ok(not exists(select 1 from public.get_public_popular_feed_page('vancouver') f where f.id=current_setting('test.inv')::uuid),'invite meetup is not in popular posts');
select ok(not exists(select 1 from public.get_public_author_posts(pg_temp.uid(12)) f where f.id=current_setting('test.inv')::uuid),'invite meetup is not in the host post list');
select ok(public.search_public_directory('Secret garden','vancouver','meetup')->'items'='[]'::jsonb,'invite meetup is not in search');
select ok(public.search_public_directory('Public walk club','vancouver','meetup')->'items' @> jsonb_build_array(jsonb_build_object('id',current_setting('test.pub'))),'public meetup is in search');
select is(public.get_shared_link_preview(current_setting('test.inv')::uuid),null::jsonb,'invite meetup has no share preview');
select is((select count(*)::integer from public.get_public_post(current_setting('test.inv')::uuid)),0,'invite meetup detail is hidden');
select is((select count(*)::integer from public.posts where id=current_setting('test.inv')::uuid),0,'invite meetup row is hidden by RLS');
select is((select count(*)::integer from public.posts where id=current_setting('test.pub')::uuid),1,'public meetup row is still readable');
select is(public.get_chilling_host_profile(current_setting('test.inv')::uuid),null::jsonb,'invite host profile is hidden');
select throws_ok($$select public.get_meetup_invite_link(current_setting('test.inv')::uuid)$$,'P0001','MEETUP_NOT_FOUND','only the host makes links');
reset role;
set local role anon;
select is((select count(*)::integer from public.get_public_post(current_setting('test.inv')::uuid)),0,'logged-out visitors do not see the invite meetup');
select throws_ok($$select public.open_meetup_invite('00000000000000000000000000000000')$$,'42501',null,'logged-out visitors cannot open links');
reset role;
select pg_temp.act(4);
set local role authenticated;
select throws_ok($$select public.request_chilling_join_v2(current_setting('test.inv')::uuid,'answer','chilling-v3',(public.get_my_chilling_profile()->>'revision'))$$,
  'P0001','MEETUP_NOT_FOUND','outsiders cannot apply');
reset role;

-- Comments and host tools take the post id directly; invite meetups stay with their people there too (git-76 review).
select pg_temp.act(12);
set local role authenticated;
select set_config('test.inv_comment',public.create_thread_comment(current_setting('test.inv')::uuid,'See you there',null,null)::text,true);
reset role;
select ok(private.comment_visible_to(current_setting('test.inv_comment')::uuid,pg_temp.uid(12)),'the host sees comments on an invite meetup');
select ok(not private.comment_visible_to(current_setting('test.inv_comment')::uuid,pg_temp.uid(4)),'outsiders do not see comments on an invite meetup');
select ok(not private.comment_visible_to(current_setting('test.inv_comment')::uuid,null),'logged-out readers do not either');
select pg_temp.act(4);
set local role authenticated;
select throws_ok($$select public.create_thread_comment(current_setting('test.inv')::uuid,'hi',null,null)$$,'P0001','POST_NOT_FOUND','outsiders cannot comment on an invite meetup by id');
select throws_ok($$select public.set_meetup_waitlist(current_setting('test.inv')::uuid,true)$$,'P0001','MEETUP_NOT_FOUND','outsiders cannot join an invite meetup waitlist');
select lives_ok($$select public.create_thread_comment(current_setting('test.pub')::uuid,'Looks fun',null,null)$$,'public meetups still take comments');
reset role;

-- Links: the host reuses one link until making a new one, which blocks the old link at once.
select pg_temp.act(12);
set local role authenticated;
select set_config('test.token1',public.get_meetup_invite_link(current_setting('test.inv')::uuid),true);
select ok(current_setting('test.token1') ~ '^[0-9a-f]{32}$','link token is 32 hex');
select is(public.get_meetup_invite_link(current_setting('test.inv')::uuid),current_setting('test.token1'),'same link until renewed');
select throws_ok($$select public.get_meetup_invite_link(current_setting('test.pub')::uuid)$$,'P0001','MEETUP_NOT_FOUND','public meetups have no invite link');
reset role;
select pg_temp.act(11);
set local role authenticated;
select is(public.open_meetup_invite(current_setting('test.token1'))::text,current_setting('test.inv'),'link opens the meetup');
select is((select count(*)::integer from public.get_public_post(current_setting('test.inv')::uuid)),1,'link guest sees the detail');
select lives_ok($$select public.request_chilling_join_v2(current_setting('test.inv')::uuid,'answer','chilling-v3',(public.get_my_chilling_profile()->>'revision'))$$,'link guest applies');
select is((select status from public.meetup_requests where post_id=current_setting('test.inv')::uuid and requester_id=auth.uid()),'pending','host still approves');
select throws_ok($$select public.open_meetup_invite('not-a-token')$$,'P0001','MEETUP_INVITE_INVALID','malformed token rejected');
reset role;
select pg_temp.act(16);
set local role authenticated;
select lives_ok($$select public.open_meetup_invite(current_setting('test.token1'))$$,'another guest opens the old link');
reset role;
select pg_temp.act(12);
set local role authenticated;
select set_config('test.token2',public.get_meetup_invite_link(current_setting('test.inv')::uuid,true),true);
select isnt(current_setting('test.token2'),current_setting('test.token1'),'new link replaces the old one');
reset role;
select pg_temp.act(15);
set local role authenticated;
select throws_ok($$select public.open_meetup_invite(current_setting('test.token1'))$$,'P0001','MEETUP_INVITE_INVALID','old link is blocked after a new one');
select is(public.open_meetup_invite(current_setting('test.token2'))::text,current_setting('test.inv'),'new link works');
reset role;
select pg_temp.act(16);
set local role authenticated;
select is((select count(*)::integer from public.get_public_post(current_setting('test.inv')::uuid)),0,'old-link guest who never applied loses access');
reset role;
select pg_temp.act(11);
set local role authenticated;
select is((select count(*)::integer from public.get_public_post(current_setting('test.inv')::uuid)),1,'old-link guest who applied keeps access');
reset role;

-- Friend invites: mutual friends only, by notification.
insert into private.friendships(user_low_id,user_high_id,requester_id,created_at,accepted_at)
select least(pg_temp.uid(12),f),greatest(pg_temp.uid(12),f),pg_temp.uid(12),now(),case when f=pg_temp.uid(6) then null else now() end
from unnest(array[pg_temp.uid(9),pg_temp.uid(6),pg_temp.uid(8)]) f;
insert into public.blocks(blocker_id,blocked_id) values(pg_temp.uid(8),pg_temp.uid(12));
select pg_temp.act(12);
set local role authenticated;
select throws_ok($$select public.invite_meetup_friends(current_setting('test.inv')::uuid,array[pg_temp.uid(10)])$$,'P0001','MEETUP_INVITE_NOT_FRIEND','non-friend rejected');
select throws_ok($$select public.invite_meetup_friends(current_setting('test.inv')::uuid,array[pg_temp.uid(9),pg_temp.uid(10)])$$,'P0001','MEETUP_INVITE_NOT_FRIEND','one non-friend rejects the whole send');
select throws_ok($$select public.invite_meetup_friends(current_setting('test.inv')::uuid,array[pg_temp.uid(6)])$$,'P0001','MEETUP_INVITE_NOT_FRIEND','unaccepted request is not a friendship');
select throws_ok($$select public.invite_meetup_friends(current_setting('test.inv')::uuid,array[pg_temp.uid(8)])$$,'P0001','MEETUP_INVITE_NOT_FRIEND','blocked pair rejected');
select is(public.invite_meetup_friends(current_setting('test.inv')::uuid,array[pg_temp.uid(9)]),1,'friend invited');
select is(public.invite_meetup_friends(current_setting('test.inv')::uuid,array[pg_temp.uid(9)]),0,'second invite sends nothing');
reset role;
select is((select count(*)::integer from private.meetup_invitees where user_id=pg_temp.uid(10)),0,'rejected send left no invite');
select is((select route from public.notifications where user_id=pg_temp.uid(9) and kind='meetup_invite' and target_id=current_setting('test.inv')::uuid),
  '/post/'||current_setting('test.inv'),'friend gets one invite notification to the meetup');
select is((select category from public.notifications where user_id=pg_temp.uid(9) and kind='meetup_invite'),'meetups','invite sits with meetup alerts');
select pg_temp.act(9);
set local role authenticated;
select is((select count(*)::integer from public.get_public_post(current_setting('test.inv')::uuid)),1,'invited friend sees the meetup');
reset role;
select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select public.invite_meetup_friends(current_setting('test.inv')::uuid,array[pg_temp.uid(9)])$$,'P0001','MEETUP_NOT_FOUND','only the host invites');
select throws_ok($$select public.invite_meetup_friends(current_setting('test.pub')::uuid,array[pg_temp.uid(9)])$$,'P0001','MEETUP_NOT_FOUND','public meetups take no friend invites');
reset role;

select * from finish();
rollback;
