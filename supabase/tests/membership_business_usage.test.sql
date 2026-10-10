begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data)
select ('15900000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'usage159-'||n||'@example.com',
 case when n=4 then '{"role":"admin"}'::jsonb else '{"merchant_enabled":true}'::jsonb end from generate_series(1,4)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select ('15900000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'사용량검사'||n,'vancouver',now(),now(),now(),'test' from generate_series(1,4)n;
insert into private.merchants(id,name,city_id,owner_id,owner_verified_at,status,consent,consent_note) values
 ('15910000-0000-0000-0000-000000000001','사용량검사 프리미엄','vancouver','15900000-0000-0000-0000-000000000001',now(),'lead','granted','검사동의'),
 ('15910000-0000-0000-0000-000000000002','사용량검사 기본','vancouver','15900000-0000-0000-0000-000000000002',now(),'lead','granted','검사동의');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,created_at)
select ('15920000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'15900000-0000-0000-0000-000000000002','vancouver',1,'새 소식 '||n,'서로 다른 실제 메뉴 안내 '||n,current_date,now()-interval '4 days' from generate_series(1,5)n;
select set_config('request.jwt.claims','{"sub":"15900000-0000-0000-0000-000000000002","role":"authenticated"}',true);
insert into private.merchant_posts(post_id,merchant_id,original_url)
select ('15920000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'15910000-0000-0000-0000-000000000002','https://example.com/usage/'||n from generate_series(1,4)n;
select is((private.business_membership_details('15910000-0000-0000-0000-000000000002')->>'postsUsed')::int,4,'canonical links consume all four Basic posts');
select throws_ok($$insert into private.merchant_posts(post_id,merchant_id,original_url) values('15920000-0000-0000-0000-000000000005','15910000-0000-0000-0000-000000000002','https://example.com/usage/5')$$,'P0001','BUSINESS_MONTHLY_LIMIT_REACHED','a fifth distinct new promotion is blocked');
set local role authenticated;
select throws_ok($$select public.bump_post('15920000-0000-0000-0000-000000000001')$$,'P0001','BUSINESS_MONTHLY_LIMIT_REACHED','Basic has zero business bumps even when personal cooldown has elapsed');
select throws_ok($$select * from private.merchant_membership_usage$$,'42501',null,'clients cannot change/read raw quota ledger');
select throws_ok($$select private.consume_business_usage('15910000-0000-0000-0000-000000000002','post',gen_random_uuid(),'fake')$$,'42501',null,'clients cannot call private accounting helper');
reset role;
delete from public.posts where id='15920000-0000-0000-0000-000000000001';
select is((private.business_membership_details('15910000-0000-0000-0000-000000000002')->>'postsUsed')::int,4,'deletion never refunds a spent new-post allowance');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on)
values('15920000-0000-0000-0000-000000000006','15900000-0000-0000-0000-000000000003','vancouver',1,'바꾼 제목','서로 다른 실제 메뉴 안내 1',current_date);
select throws_ok($$insert into private.merchant_posts(post_id,merchant_id,original_url) values('15920000-0000-0000-0000-000000000006','15910000-0000-0000-0000-000000000002','https://example.com/repeat')$$,'P0001','DUPLICATE_PROMOTION','new title, author and deletion cannot repeat the same promotion');
select public.apply_membership_snapshot('15900000-0000-0000-0000-000000000002',jsonb_build_array(jsonb_build_object('kind','business','plan_version',2,'tier','plus','expires_at',now()+interval '30 days','product_id','com.dlwpdl.gling.business.plus.monthly.v2','store','app_store','will_renew',true)),now()-interval '10 seconds');
set local role authenticated;
select public.bind_business_membership('15910000-0000-0000-0000-000000000002');
select is((public.get_business_membership('15910000-0000-0000-0000-000000000002')->>'postsUsed')::int,4,'upgrade changes the ceiling without resetting usage');
select is(public.get_membership()->>'tier','free','business Plus never grants personal Plus');
select public.bump_post('15920000-0000-0000-0000-000000000002');
select is((public.get_business_membership('15910000-0000-0000-0000-000000000002')->>'bumpsUsed')::int,1,'one native business bump consumes one shared allowance');
reset role;
select is((select created_at<now()-interval '3 days' from public.posts where id='15920000-0000-0000-0000-000000000002'),true,'bumping preserves the original post timestamp');
select is((select bump_count from public.posts where id='15920000-0000-0000-0000-000000000002'),1,'same post ID and history are kept');
insert into private.merchant_operators(merchant_id,user_id) values('15910000-0000-0000-0000-000000000002','15900000-0000-0000-0000-000000000003');
select set_config('request.jwt.claims','{"sub":"15900000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_business_membership('15910000-0000-0000-0000-000000000002')->>'canPurchase')::bool,false,'operator shares benefits but cannot bind a purchase');
select throws_ok($$select public.bind_business_membership('15910000-0000-0000-0000-000000000002')$$,'P0001','MERCHANT_ACCESS_REQUIRED','operator cannot buy on behalf of owner');
select throws_ok($$select public.bump_post('15920000-0000-0000-0000-000000000003')$$,'P0001','BUSINESS_BUMP_COOLDOWN','switching operator cannot bypass whole-business 24-hour wait');
reset role;
update private.merchant_membership_usage set created_at=now()-interval '25 hours' where action='bump';
select set_config('request.jwt.claims','{"sub":"15900000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.bump_post('15920000-0000-0000-0000-000000000002')$$,'P0001','BUSINESS_BUMP_COOLDOWN','same business post still needs seventy-two hours');
select lives_ok($$select public.bump_post('15920000-0000-0000-0000-000000000003')$$,'different post works after shared wait and is charged once');
reset role;
select public.apply_membership_snapshot('15900000-0000-0000-0000-000000000002','[]',now());
select is((private.business_membership_details('15910000-0000-0000-0000-000000000002')->>'bumpsUsed')::int,2,'refund/expiry does not erase already-used actions');
select throws_ok($$update private.merchant_posts set merchant_id='15910000-0000-0000-0000-000000000001' where post_id='15920000-0000-0000-0000-000000000003'$$,'P0001','MERCHANT_POST_BUSINESS_CHANGED','relinking cannot give another company free quota');

-- Boundary checks use the verified canonical business tier, never the caller's personal tier.
select public.apply_membership_snapshot('15900000-0000-0000-0000-000000000002',jsonb_build_array(jsonb_build_object('kind','business','plan_version',2,'tier','plus','expires_at',now()+interval '30 days','product_id','com.dlwpdl.gling.business.plus.monthly.v2','store','app_store','will_renew',true)),now()+interval '1 second');
select is((private.business_membership_details('15910000-0000-0000-0000-000000000002')->>'bumpCooldownHours')::int,72,'business Plus publishes seventy-two hours');
update private.merchant_membership_usage set created_at=now()-interval '25 hours' where merchant_id='15910000-0000-0000-0000-000000000002' and action='bump';
update public.posts set bumped_at=now()-interval '71 hours' where id='15920000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok($$select public.bump_post('15920000-0000-0000-0000-000000000002')$$,'P0001','BUSINESS_BUMP_COOLDOWN','Plus cannot bump one hour early');
reset role;
update public.posts set bumped_at=now()-interval '72 hours' where id='15920000-0000-0000-0000-000000000002';
set local role authenticated;
select is((public.bump_post('15920000-0000-0000-0000-000000000002')->>'nextBumpAt')::timestamptz,now()+interval '72 hours','Plus works exactly at seventy-two hours and returns that wait');
reset role;

select public.apply_membership_snapshot('15900000-0000-0000-0000-000000000002',jsonb_build_array(jsonb_build_object('kind','business','plan_version',2,'tier','pro','expires_at',now()+interval '30 days','product_id','com.dlwpdl.gling.business.pro.monthly.v2','store','app_store','will_renew',true)),now()+interval '2 seconds');
select is((private.business_membership_details('15910000-0000-0000-0000-000000000002')->>'bumpCooldownHours')::int,60,'business Pro publishes sixty hours');
update private.merchant_membership_usage set created_at=now()-interval '25 hours' where merchant_id='15910000-0000-0000-0000-000000000002' and action='bump';
update public.posts set bumped_at=now()-interval '59 hours' where id='15920000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok($$select public.bump_post('15920000-0000-0000-0000-000000000002')$$,'P0001','BUSINESS_BUMP_COOLDOWN','Pro cannot bump one hour early');
reset role;
update public.posts set bumped_at=now()-interval '60 hours' where id='15920000-0000-0000-0000-000000000002';
set local role authenticated;
select is((public.bump_post('15920000-0000-0000-0000-000000000002')->>'nextBumpAt')::timestamptz,now()+interval '60 hours','Pro works exactly at sixty hours and returns that wait');
reset role;

select public.apply_membership_snapshot('15900000-0000-0000-0000-000000000002',jsonb_build_array(jsonb_build_object('kind','business','plan_version',2,'tier','premium','expires_at',now()+interval '30 days','product_id','com.dlwpdl.gling.business.premium.monthly.v2','store','app_store','will_renew',true)),now()+interval '3 seconds');
select is((private.business_membership_details('15910000-0000-0000-0000-000000000002')->>'bumpCooldownHours')::int,48,'business Premium publishes forty-eight hours');
update private.merchant_membership_usage set created_at=now()-interval '25 hours' where merchant_id='15910000-0000-0000-0000-000000000002' and action='bump';
update public.posts set bumped_at=now()-interval '47 hours' where id='15920000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok($$select public.bump_post('15920000-0000-0000-0000-000000000002')$$,'P0001','BUSINESS_BUMP_COOLDOWN','Premium cannot bump one hour early');
reset role;
update public.posts set bumped_at=now()-interval '48 hours' where id='15920000-0000-0000-0000-000000000002';
set local role authenticated;
select is((public.bump_post('15920000-0000-0000-0000-000000000002')->>'nextBumpAt')::timestamptz,now()+interval '48 hours','Premium works exactly at forty-eight hours and returns that wait');
reset role;
select public.apply_membership_snapshot('15900000-0000-0000-0000-000000000002','[]',now()+interval '4 seconds');
select is((private.business_membership_details('15910000-0000-0000-0000-000000000002')->>'bumpLimit')::int,0,'expiry removes business bump grants without resetting usage');
select is((private.business_membership_details('15910000-0000-0000-0000-000000000002')->>'bumpCooldownHours')::int,72,'expiry cannot retain the Premium shortened cooldown');

-- General stories use the same protected bump entry point and a non-accumulating account turn.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,created_at)
select ('15930000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'15900000-0000-0000-0000-000000000003','vancouver',1,'개인 이야기 '||n,'실제 게시가 아닌 검사 이야기 '||n,current_date,now()-interval '4 days' from generate_series(1,2)n;
select set_config('request.jwt.claims','{"sub":"15900000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.bump_post('15930000-0000-0000-0000-000000000001')$$,'Basic can bump an existing ordinary story');
select throws_ok($$select public.bump_post('15930000-0000-0000-0000-000000000002')$$,'P0001','BUMP_COOLDOWN','another old post cannot bypass the shared personal turn');
reset role;
update private.personal_bump_state set last_bumped_at=now()-interval '31 hours' where user_id='15900000-0000-0000-0000-000000000003';
select public.apply_membership_snapshot('15900000-0000-0000-0000-000000000003',jsonb_build_array(jsonb_build_object('kind','general','plan_version',2,'tier','pro','expires_at',now()+interval '30 days','product_id','com.dlwpdl.gling.general.pro.monthly.v2','store','app_store','will_renew',true)),now());
set local role authenticated;
select lives_ok($$select public.bump_post('15930000-0000-0000-0000-000000000002')$$,'upgrade uses shorter thirty-hour cooldown without accumulating turns');
reset role;

-- Premium's managed actions are a partition of 30/24, not an extra allowance.
select public.apply_membership_snapshot('15900000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('kind','business','plan_version',2,'tier','premium','expires_at',now()+interval '30 days','product_id','com.dlwpdl.gling.business.premium.monthly.v2','store','app_store','will_renew',true)),now());
select set_config('request.jwt.claims','{"sub":"15900000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.bind_business_membership('15910000-0000-0000-0000-000000000001');
reset role;
insert into private.merchant_membership_usage(merchant_id,action,post_id,fingerprint)
select '15910000-0000-0000-0000-000000000001','post',('15940000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'fixture-original-'||n from generate_series(1,26)n;
select throws_ok($$select private.consume_business_usage('15910000-0000-0000-0000-000000000001','post',gen_random_uuid(),'self-27')$$,'P0001','BUSINESS_MONTHLY_LIMIT_REACHED','self-managed new posts reserve four managed slots inside thirty');
insert into auth.sessions(id,user_id,aal) values('15990000-0000-0000-0000-000000000004','15900000-0000-0000-0000-000000000004','aal2');
select set_config('request.jwt.claims','{"sub":"15900000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2","session_id":"15990000-0000-0000-0000-000000000004","app_metadata":{"role":"admin"}}',true);
select lives_ok($$select private.consume_business_usage('15910000-0000-0000-0000-000000000001','post',('15950000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'managed-'||n) from generate_series(1,4)n$$,'four managed posts fit the reserved partition');
select is((private.business_membership_details('15910000-0000-0000-0000-000000000001')->>'postsUsed')::int,30,'26 self plus four managed is exactly thirty');
select is((private.business_membership_details('15910000-0000-0000-0000-000000000001')->>'managedPostsUsed')::int,4,'managed subset is recorded separately');
select throws_ok($$select private.consume_business_usage('15910000-0000-0000-0000-000000000001','post',gen_random_uuid(),'managed-5')$$,'P0001','BUSINESS_MONTHLY_LIMIT_REACHED','no thirty-first post or fifth managed post');
select private.consume_business_usage('15910000-0000-0000-0000-000000000001','report','15960000-0000-0000-0000-000000000001');
select lives_ok($$select private.consume_business_usage('15910000-0000-0000-0000-000000000001','report','15960000-0000-0000-0000-000000000001')$$,'same managed report retry is idempotent');
select throws_ok($$select private.consume_business_usage('15910000-0000-0000-0000-000000000001','report',gen_random_uuid())$$,'P0001','BUSINESS_MONTHLY_LIMIT_REACHED','one included monthly report is counted once');

-- Seed earlier posts, then exercise the actual app/web/MCP publishing RPC at each ceiling.
create function pg_temp.check_business_publish_cap(n int,tier text,cap int) returns setof text
language plpgsql as $$
declare
  uid uuid:=('15970000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
  mid uuid:=('15971000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
  did uuid:=('15973000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
  extra uuid:=('15974000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
  pid uuid;
begin
  insert into auth.users(id,email,raw_app_meta_data) values(uid,'publish159-'||n||'@example.com','{"merchant_enabled":true}');
  insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
    values(uid,'게시경계검사'||n,'vancouver',now(),now(),now(),'test');
  insert into private.merchants(id,name,city_id,owner_id,owner_verified_at,status,consent,consent_note)
    values(mid,'게시 경계 검사 '||tier,'vancouver',uid,now(),'lead','granted','검사동의');
  perform public.apply_membership_snapshot(uid,jsonb_build_array(jsonb_build_object('kind','business','plan_version',2,
    'tier',tier,'expires_at',now()+interval '30 days','product_id','com.dlwpdl.gling.business.'||tier||'.monthly.v2',
    'store','app_store','will_renew',true)),now());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform public.bind_business_membership(mid);
  execute 'reset role';
  insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,created_at)
    select ('15972'||lpad(n::text,3,'0')||'-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
      uid,'vancouver',1,'이전 경계 소식 '||i,'다른 게시 경계 원고 '||n||' '||i,current_date,now()-interval '1 day'
    from generate_series(1,cap-1)i;
  insert into private.merchant_posts(post_id,merchant_id,original_url)
    select id,mid,'https://example.com/publish/'||id from public.posts where author_id=uid;
  return next is((private.business_membership_details(mid)->>'postsUsed')::int,cap-1,tier||': canonical earlier posts are counted');
  execute 'set local role authenticated';
  perform public.save_merchant_workspace_draft(mid,did,'gling','마지막 허용 '||tier,'서로 다른 마지막 원고 '||tier,null,'life','story');
  perform public.approve_merchant_workspace_drafts(mid,array[did],true,jsonb_build_object(did::text,now()));
  return next lives_ok(format('select public.publish_merchant_workspace_draft(%L,%L,now())',mid,did),tier||': final allowed new post publishes through the real RPC');
  pid:=public.publish_merchant_workspace_draft(mid,did);
  return next is(public.publish_merchant_workspace_draft(mid,did),pid,tier||': retry at the ceiling returns the existing post');
  return next is((public.get_business_membership(mid)->>'postsUsed')::int,cap,tier||': final publication and retry consume exactly one slot');
  perform public.save_merchant_workspace_draft(mid,extra,'gling','초과 검사 '||tier,'서로 다른 초과 원고 '||tier,null,'life','story');
  perform public.approve_merchant_workspace_drafts(mid,array[extra],true,jsonb_build_object(extra::text,now()));
  return next throws_ok(format('select public.publish_merchant_workspace_draft(%L,%L,now())',mid,extra),
    'P0001','BUSINESS_MONTHLY_LIMIT_REACHED',tier||': the next new post is refused by the real RPC');
  execute 'reset role';
  return next is((select count(*)::int from public.posts where author_id=uid),cap,tier||': rejected publication leaves no orphan post');
  return next is((private.business_membership_details(mid)->>'postsUsed')::int,cap,tier||': rejected publication does not spend quota');
  return next is((select post_id from private.merchant_workspace_drafts where id=extra),null::uuid,tier||': rejected draft remains unpublished');
  if tier='premium' then
    perform set_config('request.jwt.claims','{"sub":"15900000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2","session_id":"15990000-0000-0000-0000-000000000004","app_metadata":{"role":"admin"}}',true);
    execute 'set local role authenticated';
    return next lives_ok(format($q$select public.create_admin_merchant_post(%L,'관리 원고 '||i,'관리 경계의 서로 다른 실제 검사 원고 '||i,
      'life','https://example.com/managed/'||i,'story',('15975000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid) from generate_series(1,4)i$q$,mid),
      'Premium: four managed publications fill the reserved slots through the real admin RPC');
    return next lives_ok(format($q$select public.create_admin_merchant_post(%L,'재시도','재시도','life','https://example.com/retry','story','15975000-0000-0000-0000-000000000004')$q$,mid),
      'Premium: managed request retry succeeds even when all thirty slots are used');
    return next throws_ok(format($q$select public.create_admin_merchant_post(%L,'다섯째 관리 원고','서로 다른 다섯째 관리 원고','life','https://example.com/managed/5','story','15975000-0000-0000-0000-000000000005')$q$,mid),
      'P0001','BUSINESS_MONTHLY_LIMIT_REACHED','Premium: a fifth managed/thirty-first total publication is refused');
    execute 'reset role';
    return next is((private.business_membership_details(mid)->>'postsUsed')::int,30,'Premium: actual owner/admin publications total thirty');
    return next is((private.business_membership_details(mid)->>'managedPostsUsed')::int,4,'Premium: four managed posts are included, not extra');
    return next is((select count(*)::int from private.merchant_posts where merchant_id=mid),30,'Premium: rejected admin publication leaves no extra merchant post');
    return next is((select count(*)::int from public.posts where author_id='15900000-0000-0000-0000-000000000004'),4,'Premium: rejected admin publication leaves no orphan public post');
  end if;
end;
$$;
select * from pg_temp.check_business_publish_cap(1,'plus',12);
select * from pg_temp.check_business_publish_cap(2,'pro',30);
select * from pg_temp.check_business_publish_cap(3,'premium',26);

-- Monthly windows reset usage, not the permanent duplicate history.
update private.merchant_membership_usage set created_at=(date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')-interval '1 second'
  where merchant_id='15971000-0000-0000-0000-000000000002' and action='post';
select is((private.business_membership_details('15971000-0000-0000-0000-000000000002')->>'postsUsed')::int,0,'posts from before the UTC month boundary do not spend this month');
update private.merchant_membership_usage set created_at=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'
  where post_id='15972002-0000-0000-0000-000000000001';
select is((private.business_membership_details('15971000-0000-0000-0000-000000000002')->>'postsUsed')::int,1,'a post exactly at the UTC month boundary counts in this month');
select set_config('request.jwt.claims','{"sub":"15970000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.save_merchant_workspace_draft('15971000-0000-0000-0000-000000000002','15976000-0000-0000-0000-000000000002','gling','다른 달 다른 제목','다른 게시 경계 원고 2 2',null,'life','story');
select public.approve_merchant_workspace_drafts('15971000-0000-0000-0000-000000000002',array['15976000-0000-0000-0000-000000000002']::uuid[],true,jsonb_build_object('15976000-0000-0000-0000-000000000002',now()));
select throws_ok($$select public.publish_merchant_workspace_draft('15971000-0000-0000-0000-000000000002','15976000-0000-0000-0000-000000000002',now())$$,'P0001','DUPLICATE_PROMOTION','changing month/title cannot recreate the same promotion through the publish RPC');
reset role;
select is((select count(*) from public.posts where author_id='15970000-0000-0000-0000-000000000002'),30::bigint,'duplicate publication failure rolls back the new public post');
select * from finish();
rollback;
