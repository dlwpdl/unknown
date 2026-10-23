begin;
set local search_path=public,extensions;
select no_plan();
-- The isolated checker injects business_post_identity.test.sql's seed prefix here.

insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,record_kind,owner_id,owner_verified_at)
values('b1810000-0000-4000-8000-000000000002','첫글없는비즈니스','vancouver','비공개연락처노출금지','lead','granted','synthetic consent','business','b1800000-0000-4000-8000-000000000001',now());
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,record_kind)
values('b1810000-0000-4000-8000-000000000003','기존공개비즈니스','vancouver','','paid','granted','existing public curation consent','business');
insert into public.posts(id,author_id,city_id,tag_id,title,body)
values('b1820000-0000-4000-8000-000000000006','b1800000-0000-4000-8000-000000000003','vancouver',1,'기존 공개 소개','합성 기존 공개 자료');
insert into private.merchant_posts(post_id,merchant_id,creation_request_id)
values('b1820000-0000-4000-8000-000000000006','b1810000-0000-4000-8000-000000000003','b1830000-0000-4000-8000-000000000006');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002')->>'name','첫글없는비즈니스','verified consenting business opens before its first post');
select is(public.get_merchant_profile_posts('b1810000-0000-4000-8000-000000000002')->>'post_count','0','new business has zero official posts');
select is(public.get_merchant_profile_posts('b1810000-0000-4000-8000-000000000002')->'posts','[]'::jsonb,'new profile returns an empty post page rather than unavailable');
select is(public.get_merchant_profile_posts('b1810000-0000-4000-8000-000000000002','jobs',0)->>'job_count','0','empty business has no jobs');
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002')->>'review_post_id',null::text,'basic profile does not gain paid review privileges');
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002')->>'can_message','false','public profile does not expose personal messaging');
select ok(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002')::text !~ 'b1800000|비즈니스신원검사|비공개연락처노출금지|owner_id|contact','empty profile contains no personal account or private contact');
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000001')->>'name','지모코신원검사','existing published business remains available');
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000003')->>'name','기존공개비즈니스','existing consented curated profile stays available without changing ownership');
reset role;

update public.posts set created_at=now()-interval '3 hours' where id='b1820000-0000-4000-8000-000000000006';
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at,business_author_id) values
 ('b1820000-0000-4000-8000-000000000007','b1800000-0000-4000-8000-000000000003','vancouver',1,'같은 시각 첫 안내','합성 지점 조회 검사',now()-interval '1 hour','b1810000-0000-4000-8000-000000000003'),
 ('b1820000-0000-4000-8000-000000000008','b1800000-0000-4000-8000-000000000003','vancouver',1,'같은 시각 다음 안내','합성 지점 조회 검사',now()-interval '1 hour','b1810000-0000-4000-8000-000000000003');
insert into private.merchant_posts(post_id,merchant_id,creation_request_id) values
 ('b1820000-0000-4000-8000-000000000007','b1810000-0000-4000-8000-000000000003','b1830000-0000-4000-8000-000000000007'),
 ('b1820000-0000-4000-8000-000000000008','b1810000-0000-4000-8000-000000000003','b1830000-0000-4000-8000-000000000008');
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000003')->>'review_post_id','b1820000-0000-4000-8000-000000000008','overlapping legacy and business paths retain the latest UUID tie-break');
select is(public.get_merchant_profile_posts('b1810000-0000-4000-8000-000000000003')->>'post_count','2','overlapping lookup paths do not duplicate official posts');
reset role;
update public.posts set status='removed' where id='b1820000-0000-4000-8000-000000000008';
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000003')->>'review_post_id','b1820000-0000-4000-8000-000000000007','hidden latest post falls back to the next visible post');
reset role;
update public.posts set status='removed' where id='b1820000-0000-4000-8000-000000000007';
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000003')->>'review_post_id','b1820000-0000-4000-8000-000000000006','legacy-only visible posts remain eligible after official posts are hidden');
reset role;

update private.merchants set owner_verified_at=null where id='b1810000-0000-4000-8000-000000000002';
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002'),null::jsonb,'unverified owner cannot expose a new profile');
reset role;
update private.merchants set owner_id=null where id='b1810000-0000-4000-8000-000000000002';
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002'),null::jsonb,'internal candidate has no public profile');
reset role;
update private.merchants set owner_id='b1800000-0000-4000-8000-000000000001',owner_verified_at=now(),consent='pending' where id='b1810000-0000-4000-8000-000000000002';
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002'),null::jsonb,'pending consent stays private');
reset role;
update private.merchants set consent='revoked' where id='b1810000-0000-4000-8000-000000000002';
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002'),null::jsonb,'withdrawn consent stays private');
reset role;
update private.merchants set consent='granted',status='paused' where id='b1810000-0000-4000-8000-000000000002';
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002'),null::jsonb,'paused business stays hidden');
reset role;
update private.merchants set status='lead',record_kind='source' where id='b1810000-0000-4000-8000-000000000002';
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002'),null::jsonb,'source records cannot become public business profiles');
reset role;
update private.merchants set record_kind='business',deleted_at=now() where id='b1810000-0000-4000-8000-000000000002';
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002'),null::jsonb,'deleted business stays hidden');
reset role;
update private.merchants set deleted_at=null where id='b1810000-0000-4000-8000-000000000002';
update public.profiles set account_status='suspended' where id='b1800000-0000-4000-8000-000000000001';
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002'),null::jsonb,'inactive owner cannot publish an empty profile');
reset role;
update public.profiles set account_status='active' where id='b1800000-0000-4000-8000-000000000001';
update auth.users set raw_app_meta_data='{}' where id='b1800000-0000-4000-8000-000000000001';
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002'),null::jsonb,'disabled business access cannot expose a new empty profile');
reset role;
update auth.users set raw_app_meta_data='{"merchant_enabled":true}' where id='b1800000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"b1800000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002')->>'name','첫글없는비즈니스','ordinary member can open the registered profile');
reset role;
insert into public.blocks(blocker_id,blocked_id) values('b1800000-0000-4000-8000-000000000003','b1800000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002'),null::jsonb,'personal blocking still protects the linked owner');
reset role;
delete from public.blocks where blocker_id='b1800000-0000-4000-8000-000000000003';
delete from public.reports where reporter_id='b1800000-0000-4000-8000-000000000003';
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code) values('b1800000-0000-4000-8000-000000000003','b1800000-0000-4000-8000-000000000001','user','b1800000-0000-4000-8000-000000000001','spam');
set local role authenticated;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002'),null::jsonb,'reported owner remains protected');
reset role;
delete from public.reports where reporter_id='b1800000-0000-4000-8000-000000000003';
set local role authenticated;
select lives_ok($$select public.block_business('b1810000-0000-4000-8000-000000000002','b1800000-0000-4000-8000-000000000003')$$,'reader can block an empty business without receiving its owner ID');
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002'),null::jsonb,'business blocking hides the registered empty profile');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002')->>'name','첫글없는비즈니스','one reader block does not unpublish the business for everyone');
select throws_ok($$select public.get_business_public_media('b1810000-0000-4000-8000-000000000002','avatar')$$,'42501',null,'ordinary public callers cannot recover the physical logo path');
reset role;
select ok(not has_function_privilege('anon','private.business_base_get_merchant_profile(uuid)','EXECUTE'),'private projection is not a public bypass');
insert into public.posts(id,author_id,city_id,tag_id,title,body)
values('b1820000-0000-4000-8000-000000000005','b1800000-0000-4000-8000-000000000003','vancouver',1,'개인 소개 자료','합성 개인 글');
insert into private.merchant_posts(post_id,merchant_id,creation_request_id)
values('b1820000-0000-4000-8000-000000000005','b1810000-0000-4000-8000-000000000002','b1830000-0000-4000-8000-000000000005');
set local role anon;
select is(public.get_merchant_profile_posts('b1810000-0000-4000-8000-000000000002')->'posts','[]'::jsonb,'curated personal association stays off the empty official profile');
reset role;
update private.merchants set avatar_path='b1800000-0000-4000-8000-000000000001/b1810000-0000-4000-8000-000000000002_b1840000-0000-4000-8000-000000000003.webp',
  banner_path='b1800000-0000-4000-8000-000000000002/b1810000-0000-4000-8000-000000000002_b1840000-0000-4000-8000-000000000004.webp'
where id='b1810000-0000-4000-8000-000000000002';
set local role anon;
select matches(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002')->>'avatar_path','^business-profile/b1810000-0000-4000-8000-000000000002/avatar/[0-9a-f]{32}$','empty profile logo uses an opaque versioned business reference');
select matches(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002')->>'banner_path','^business-profile/b1810000-0000-4000-8000-000000000002/banner/[0-9a-f]{32}$','empty profile banner does not identify its uploader');
select ok(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002')::text !~ 'b1800000|b1840000|비공개연락처노출금지|owner_id','branding does not reveal the owner, uploader or private CRM fields');
reset role;
set local role service_role;
select is(public.get_business_public_media('b1810000-0000-4000-8000-000000000002','avatar')->>'bucket','merchant-profile-images','privileged media route resolves logos before the first post');
reset role;
update private.merchants set owner_id=null,owner_verified_at=null where id='b1810000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000002'),null::jsonb,'disconnecting the verified owner removes the new registration visibility path');
reset role;
select is((select count(*) from public.posts where business_author_id='b1810000-0000-4000-8000-000000000001'),2::bigint,'profile visibility changes never delete or reattribute existing official posts');
select * from finish();
rollback;
