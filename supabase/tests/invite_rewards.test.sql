begin;
set local search_path=public,extensions;
select no_plan();

-- 01 A inviter · 02 B invitee · 03 H host · 04 W peer · 05 C old member · 06 D host-inviter · 07 E invitee of D
-- 08..11 F G I J more invitees of A (cap) · 12 K shares B's device · 13 L shares A's device
-- 14 X business owner · 15 Y invited business owner · 16 Q paid premium inviter · 17 R invitee of Q
create temporary table ids as select n, ('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid id from generate_series(1,17) n;
create function pg_temp.u(n int) returns uuid language sql as $$ select ('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into public.cities(id,name,province,timezone) values('invite-test','Invite test','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31996,'invite-test','Invite test','meetup') on conflict do nothing;
insert into auth.users(id,email,raw_app_meta_data) select id,'invite-'||n||'@example.invalid',
  case when n in (14,15) then '{"merchant_enabled":true}'::jsonb else '{}'::jsonb end from ids;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version,created_at)
select id,'Inv'||n,'invite-test',now(),now(),now(),'test',
  case when n in (1,3,4,5,6,14,16) then now()-interval '100 days' else now()-interval '1 day' end from ids;
insert into private.account_security_devices(user_id,device_hash) values
 (pg_temp.u(2),repeat('b',64)),(pg_temp.u(12),repeat('b',64)),(pg_temp.u(1),repeat('a',64)),(pg_temp.u(13),repeat('a',64));

insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values
 ('e1100000-0000-4000-8000-000000000001',pg_temp.u(3),'invite-test',31996,'Host H walk','Synthetic local test',current_date,'{"eventKind":"group","cadence":"weekly","capacity":8,"memberCount":1}'),
 ('e1100000-0000-4000-8000-000000000002',pg_temp.u(6),'invite-test',31996,'Host D games','Synthetic local test',current_date,'{"eventKind":"group","cadence":"weekly","capacity":8,"memberCount":1}');
insert into private.meetup_sessions(id,post_id,host_id,starts_at,ends_at) values
 ('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001',pg_temp.u(3),now()-interval '1 day',now()-interval '22 hours'),
 ('e1200000-0000-4000-8000-000000000002','e1100000-0000-4000-8000-000000000002',pg_temp.u(6),now()-interval '1 day',now()-interval '22 hours');

-- Links and claims (as each member).
create function pg_temp.act(n int) returns void language sql as $$
  select set_config('request.jwt.claims',json_build_object('sub',pg_temp.u(n),'role','authenticated')::text,true) $$;
create temporary table codes(owner int, code text);
grant all on codes to authenticated;
select pg_temp.act(1); set local role authenticated;
insert into codes select 1, public.create_invite_link()->>'code';
select is(public.create_invite_link()->>'code',(select code from codes where owner=1),'One personal link per member');
select ok((select code from codes where owner=1) ~ '^[A-HJ-NP-Z2-9]{8}$','Code is 8 unambiguous characters');
select throws_ok($$select public.claim_invite_code((select code from codes where owner=1))$$,'P0001','INVITE_SELF','Inviting yourself is refused');
select throws_ok($$select * from private.invite_rewards$$,'42501',null,'Members cannot read reward tables');
select throws_ok($$select private.grant_invite_reward(auth.uid(),null,'pro',auth.uid(),'attended')$$,'42501',null,'Members cannot grant rewards');
reset role;
select pg_temp.act(6); set local role authenticated; insert into codes select 6, public.create_invite_link()->>'code'; reset role;
select pg_temp.act(16); set local role authenticated; insert into codes select 16, public.create_invite_link()->>'code'; reset role;

select pg_temp.act(5); set local role authenticated;
select throws_ok($$select public.claim_invite_code((select code from codes where owner=1))$$,'P0001','INVITE_TOO_LATE','Members past 7 days cannot link an invite');
reset role;
select pg_temp.act(2); set local role authenticated;
select throws_ok($$select public.claim_invite_code('ZZZZZZZZ')$$,'P0001','INVITE_NOT_FOUND','Unknown code');
select is(public.claim_invite_code(lower((select code from codes where owner=1)))->>'linked','true','New member links an invite (case-insensitive)');
select throws_ok($$select public.claim_invite_code((select code from codes where owner=6))$$,'P0001','INVITE_ALREADY_LINKED','Only one invite per member');
reset role;
do $$ declare n int; begin
  foreach n in array array[8,9,10,11,12,13] loop
    perform pg_temp.act(n); execute 'set local role authenticated';
    perform public.claim_invite_code((select code from codes where owner=1)); execute 'reset role';
  end loop;
  perform pg_temp.act(7); execute 'set local role authenticated'; perform public.claim_invite_code((select code from codes where owner=6)); execute 'reset role';
  perform pg_temp.act(17); execute 'set local role authenticated'; perform public.claim_invite_code((select code from codes where owner=16)); execute 'reset role';
end $$;

-- B: a peer-only confirmation does not count; the host's confirmation does.
insert into private.meetup_attendance(session_id,user_id,checked_in_at) values
 ('e1200000-0000-4000-8000-000000000001',pg_temp.u(3),now()-interval '1 day'),
 ('e1200000-0000-4000-8000-000000000001',pg_temp.u(4),now()-interval '1 day'),
 ('e1200000-0000-4000-8000-000000000001',pg_temp.u(2),now()-interval '1 day');
insert into private.meetup_attendance_confirmations(session_id,witness_id,attendee_id) values
 ('e1200000-0000-4000-8000-000000000001',pg_temp.u(4),pg_temp.u(2)),('e1200000-0000-4000-8000-000000000001',pg_temp.u(2),pg_temp.u(4));
update private.meetup_attendance set confirmed_at=now(),confirmation_source='peer' where session_id='e1200000-0000-4000-8000-000000000001' and user_id in (pg_temp.u(2),pg_temp.u(4));
select is((select outcome from private.invite_redemptions where invitee_id=pg_temp.u(2)),null,'Peer-only confirmation gives no reward');
insert into private.meetup_attendance_confirmations(session_id,witness_id,attendee_id) values ('e1200000-0000-4000-8000-000000000001',pg_temp.u(3),pg_temp.u(2));
update private.meetup_attendance set confirmed_at=coalesce(confirmed_at,now()) where session_id='e1200000-0000-4000-8000-000000000001' and user_id=pg_temp.u(2);
select is((select outcome from private.invite_redemptions where invitee_id=pg_temp.u(2)),'rewarded','Host-confirmed first meetup rewards the inviter');
select is((select tier||':'||days from private.invite_rewards where invitee_id=pg_temp.u(2)),'plus:14','Inviter without hosting gets Plus 2 weeks');
select is((select private.membership_details(pg_temp.u(1))->>'tier'),'plus','membership_details shows the reward tier');
select is((select private.membership_details(pg_temp.u(1))->>'store'),'reward','Reward is marked as a non-store grant');
select is((select private.membership_details(pg_temp.u(1))->'willRenew'),'false'::jsonb,'Reward never renews');
select is((select private.membership_details(pg_temp.u(1))->>'productId'),'gling.invite.general.plus','Reward has a product id old apps accept');
select is((select array(select jsonb_object_keys(private.membership_details(pg_temp.u(1))) order by 1)),
  (select array(select jsonb_object_keys(private.membership_details(pg_temp.u(5))) order by 1)),'membership_details keeps the same keys');
select is((select private.meetup_tool_tier(pg_temp.u(1))),'plus','Meetup tools follow the reward tier');

-- E is confirmed by an admin at D's own meetup: D gets Pro.
insert into private.meetup_attendance(session_id,user_id,confirmed_at,confirmation_source) values ('e1200000-0000-4000-8000-000000000002',pg_temp.u(7),now(),'admin');
select is((select tier from private.invite_rewards where invitee_id=pg_temp.u(7)),'pro','A host who brings someone gets Pro 2 weeks');

-- More invitees of A: periods queue, the 8-week cap holds, duplicates and self-invites never count.
insert into private.meetup_attendance(session_id,user_id,confirmed_at,confirmation_source)
  select 'e1200000-0000-4000-8000-000000000001',pg_temp.u(n),now(),'admin' from unnest(array[8,9,10,12,13,11]) n;
select is((select sum(days)::int from private.invite_rewards where user_id=pg_temp.u(1) and kind='general'),56,'Rewards stop at 8 weeks in total');
select is((select outcome from private.invite_redemptions where invitee_id=pg_temp.u(11)),'cap','The invite past the cap is recorded as cap');
select is((select outcome from private.invite_redemptions where invitee_id=pg_temp.u(12)),'duplicate','The same device counts once');
select is((select outcome from private.invite_redemptions where invitee_id=pg_temp.u(13)),'self','A device shared with the inviter is a self-invite');
select ok((select bool_and(prev_end=starts_at) from (select starts_at,lag(ends_at) over (order by starts_at) prev_end from private.invite_rewards
  where user_id=pg_temp.u(1) and kind='general') s where prev_end is not null),'Each new period starts when the last one ends');
select is((select private.membership_details(pg_temp.u(1))->>'expiresAt')::timestamptz,
  (select min(ends_at) from private.invite_rewards where user_id=pg_temp.u(1)),'The current period ends first');

-- Paid plans: higher paid tier wins; a higher reward shows over a lower paid tier.
insert into private.membership_accounts(user_id,entitlements,observed_at) values
 (pg_temp.u(16),jsonb_build_array(jsonb_build_object('tier','premium','kind','general','plan_version','2','store','app_store','product_id','com.dlwpdl.gling.general.premium.monthly.v2','will_renew',true,'expires_at',now()+interval '20 days')),now()),
 (pg_temp.u(6),jsonb_build_array(jsonb_build_object('tier','plus','kind','general','plan_version','2','store','app_store','product_id','com.dlwpdl.gling.general.plus.monthly.v2','will_renew',true,'expires_at',now()+interval '20 days')),now());
insert into private.meetup_attendance(session_id,user_id,confirmed_at,confirmation_source) values ('e1200000-0000-4000-8000-000000000001',pg_temp.u(17),now(),'admin');
select is((select private.membership_details(pg_temp.u(16))->>'store'),'app_store','A higher paid plan wins over the reward');
select is((select private.membership_details(pg_temp.u(6))->>'tier'),'pro','A Pro reward shows over a paid Plus plan');

-- Summary for the member: counts only.
select pg_temp.act(1); set local role authenticated;
select is((public.get_my_invite()->>'joined')::int,7,'Invite summary counts sign-ups');
select is((public.get_my_invite()->>'rewarded')::int,4,'Invite summary counts rewarded invites');
select ok(public.get_my_invite()::text !~ 'e1000000-','No invitee ids leak');
reset role;

-- Business: X's business invites Y; Y's business's first own post rewards both.
insert into private.merchants(id,name,city_id,owner_id,owner_verified_at) values
 ('e1300000-0000-4000-8000-000000000001','Invite cafe X','invite-test',pg_temp.u(14),now()),
 ('e1300000-0000-4000-8000-000000000002','Invite bakery Y','invite-test',pg_temp.u(15),now());
select pg_temp.act(14); set local role authenticated;
insert into codes select 14, public.create_invite_link('e1300000-0000-4000-8000-000000000001')->>'code';
reset role;
select pg_temp.act(15); set local role authenticated;
select is(public.claim_invite_code((select code from codes where owner=14))->>'business','true','Business link is linked');
reset role;
insert into private.merchant_membership_usage(merchant_id,action,post_id,managed) values ('e1300000-0000-4000-8000-000000000002','post',gen_random_uuid(),true);
select is((select count(*)::int from private.invite_rewards where kind='business'),0,'An admin-written post does not count');
insert into private.merchant_membership_usage(merchant_id,action,post_id,managed) values ('e1300000-0000-4000-8000-000000000002','post',gen_random_uuid(),false);
select is((select count(*)::int from private.invite_rewards where kind='business'),2,'First own post rewards both businesses');
insert into private.merchant_membership_usage(merchant_id,action,post_id,managed) values ('e1300000-0000-4000-8000-000000000002','post',gen_random_uuid(),false);
select is((select count(*)::int from private.invite_rewards where kind='business'),2,'Later posts add nothing');
select is((select private.business_membership_details('e1300000-0000-4000-8000-000000000001')->>'tier'),'plus','Inviting business gets Business Plus');
select is((select private.business_membership_details('e1300000-0000-4000-8000-000000000002')->>'store'),'reward','Invited business gets the reward too');
select pg_temp.act(14); set local role authenticated;
select is((public.get_business_invite('e1300000-0000-4000-8000-000000000001')->>'grantedDays')::int,14,'Business invite summary shows granted days');
reset role;

-- Admin view: per-link counts, only for a verified admin session.
select pg_temp.act(4); set local role authenticated;
select throws_ok($$select public.get_admin_invite_links()$$,'P0001','ADMIN_REQUIRED','Members cannot see link stats');
reset role;
update auth.users set raw_app_meta_data='{"role":"admin"}' where id=pg_temp.u(5);
insert into auth.sessions(id,user_id,aal) values ('e1400000-0000-4000-8000-000000000001',pg_temp.u(5),'aal2');
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.u(5),'role','authenticated','aal','aal2','session_id','e1400000-0000-4000-8000-000000000001','app_metadata',json_build_object('role','admin'))::text,true);
set local role authenticated;
select is((select (r->>'joined')::int||'/'||(r->>'attended')::int||'/'||(r->>'rewarded')::int from jsonb_array_elements(public.get_admin_invite_links()) r where r->>'code'=(select code from codes where owner=1)),'7/7/4','Admin sees sign-ups, confirmed meetups and rewards per link');
select is((select (r->>'businessPosted')::int from jsonb_array_elements(public.get_admin_invite_links()) r where r->>'businessName'='Invite cafe X'),1,'Admin sees first business posts per business link');
reset role;

select * from finish();
rollback;
