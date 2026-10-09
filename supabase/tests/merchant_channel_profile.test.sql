begin;
set local search_path=public,extensions;
-- This is the Storage API's delete transaction setting; RLS remains enforced.
set local storage.allow_delete_query='true';
select no_plan();

insert into auth.users(id,email,raw_app_meta_data) values
('13400000-0000-4000-8000-000000000001','channel-owner@example.invalid','{"merchant_enabled":true}'),
('13400000-0000-4000-8000-000000000002','channel-other-owner@example.invalid','{"merchant_enabled":true}'),
('13400000-0000-4000-8000-000000000003','channel-viewer@example.invalid','{}'),
('13400000-0000-4000-8000-000000000004','channel-inactive@example.invalid','{"merchant_enabled":true}'),
('13400000-0000-4000-8000-000000000005','channel-admin@example.invalid','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
('13400000-0000-4000-8000-000000000001','채널소유자검사','vancouver',now(),now(),now(),'test'),
('13400000-0000-4000-8000-000000000002','채널다른소유자','vancouver',now(),now(),now(),'test'),
('13400000-0000-4000-8000-000000000003','채널독자검사','vancouver',now(),now(),now(),'test'),
('13400000-0000-4000-8000-000000000004','채널비활성검사','vancouver',now(),now(),now(),'test'),
('13400000-0000-4000-8000-000000000005','채널관리자검사','vancouver',now(),now(),now(),'test');
update public.profiles set account_status='suspended' where id='13400000-0000-4000-8000-000000000004';
insert into auth.sessions(id,user_id,aal) values
('13490000-0000-4000-8000-000000000005','13400000-0000-4000-8000-000000000005','aal2');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,industry,services,address,owner_id,owner_verified_at) values
('13410000-0000-4000-8000-000000000001','채널 검사 업체','vancouver','비공개 연락처','trial','granted','비공개 승인 메모','식당','등록된 서비스 소개','등록된 공개 주소','13400000-0000-4000-8000-000000000001',now()),
('13410000-0000-4000-8000-000000000002','채널 다른 업체','vancouver','','paid','granted','검사 허가','','','','13400000-0000-4000-8000-000000000002',now()),
('13410000-0000-4000-8000-000000000003','채널 중단 업체','vancouver','','paused','granted','검사 허가','','','','13400000-0000-4000-8000-000000000001',now()),
('13410000-0000-4000-8000-000000000004','채널 철회 업체','vancouver','','trial','revoked','검사 철회','','','','13400000-0000-4000-8000-000000000001',now()),
('13410000-0000-4000-8000-000000000005','채널 대기 업체','vancouver','','lead','granted','검사 허가','','','','13400000-0000-4000-8000-000000000001',now()),
('13410000-0000-4000-8000-000000000006','채널 미동의 업체','vancouver','','trial','pending','','','','','13400000-0000-4000-8000-000000000001',now()),
('13410000-0000-4000-8000-000000000007','채널 삭제글 업체','vancouver','','trial','granted','검사 허가','','','','13400000-0000-4000-8000-000000000001',now()),
('13410000-0000-4000-8000-000000000008','채널 비공개 업체','vancouver','','trial','granted','검사 허가','','','','13400000-0000-4000-8000-000000000001',now());
insert into public.posts(id,city_id,author_id,tag_id,title,body,status,created_at) values
('13420000-0000-4000-8000-000000000001','vancouver','13400000-0000-4000-8000-000000000001',1,'채널 소개 하나','실제 업체 소개가 아닌 검사 본문','published',now()-interval '1 day'),
('13420000-0000-4000-8000-000000000002','vancouver','13400000-0000-4000-8000-000000000001',1,'채널 소개 둘','실제 업체 소개가 아닌 검사 본문','published',now()),
('13420000-0000-4000-8000-000000000003','vancouver','13400000-0000-4000-8000-000000000002',1,'채널 다른 업체 소개','실제 업체 소개가 아닌 검사 본문','published',now()),
('13420000-0000-4000-8000-000000000004','vancouver','13400000-0000-4000-8000-000000000001',1,'채널 중단 소개','실제 업체 소개가 아닌 검사 본문','published',now()),
('13420000-0000-4000-8000-000000000005','vancouver','13400000-0000-4000-8000-000000000001',1,'채널 철회 소개','실제 업체 소개가 아닌 검사 본문','published',now()),
('13420000-0000-4000-8000-000000000006','vancouver','13400000-0000-4000-8000-000000000001',1,'채널 대기 소개','실제 업체 소개가 아닌 검사 본문','published',now()),
('13420000-0000-4000-8000-000000000007','vancouver','13400000-0000-4000-8000-000000000001',1,'채널 미동의 소개','실제 업체 소개가 아닌 검사 본문','published',now()),
('13420000-0000-4000-8000-000000000008','vancouver','13400000-0000-4000-8000-000000000001',1,'채널 삭제된 소개','실제 업체 소개가 아닌 검사 본문','removed',now()),
('13420000-0000-4000-8000-000000000009','vancouver','13400000-0000-4000-8000-000000000004',1,'채널 비활성 작성 소개','실제 업체 소개가 아닌 검사 본문','published',now()+interval '1 day');
insert into private.merchant_posts(post_id,merchant_id,original_url) values
('13420000-0000-4000-8000-000000000001','13410000-0000-4000-8000-000000000001','https://example.invalid'),
('13420000-0000-4000-8000-000000000002','13410000-0000-4000-8000-000000000001',null),
('13420000-0000-4000-8000-000000000003','13410000-0000-4000-8000-000000000002',null),
('13420000-0000-4000-8000-000000000004','13410000-0000-4000-8000-000000000003',null),
('13420000-0000-4000-8000-000000000005','13410000-0000-4000-8000-000000000004',null),
('13420000-0000-4000-8000-000000000006','13410000-0000-4000-8000-000000000005',null),
('13420000-0000-4000-8000-000000000007','13410000-0000-4000-8000-000000000006',null),
('13420000-0000-4000-8000-000000000008','13410000-0000-4000-8000-000000000007',null),
('13420000-0000-4000-8000-000000000009','13410000-0000-4000-8000-000000000001',null);

select has_column('private','merchants','avatar_path','channel avatar is attached to the canonical merchant');
select has_column('private','merchants','banner_path','channel banner is attached to the canonical merchant');
select has_function('public','get_merchant_profile',array['uuid'],'anonymous profile getter is installed');
select has_function('public','get_my_merchant_profile',array['uuid'],'workspace profile getter is installed');
select is((select public from storage.buckets where id='merchant-profile-images'),false,'profile images have no public bucket delivery');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select lives_ok($$do $check$ begin
  if public.get_merchant_profile('13410000-0000-4000-8000-000000000001')->>'id' is distinct from '13410000-0000-4000-8000-000000000001' then raise exception 'wrong public merchant'; end if;
end $check$;$$,'native visible linked introduction opens the canonical channel');
reset role;
select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$do $check$ begin
  if public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')->>'can_edit' is distinct from 'true' then raise exception 'verified owner cannot edit'; end if;
end $check$;$$,'actual active enabled verified owner receives edit capability');
reset role;

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_merchant_profile('13410000-0000-4000-8000-000000000001')) k),
  array['address','avatar_path','banner_path','city_id','city_name','id','industry','name','review_post_id','services','source_urls']::text[],
  'public profile exposes only the approved fields');
select is(public.get_merchant_profile('13410000-0000-4000-8000-000000000001')->>'services','등록된 서비스 소개','profile reuses registered service details');
select is(public.get_merchant_profile('13410000-0000-4000-8000-000000000001')->>'review_post_id','13420000-0000-4000-8000-000000000002','latest visible native introduction supplies reviews; inactive author is ignored');
select is(public.get_merchant_profile('13410000-0000-4000-8000-000000000003'),null::jsonb,'paused merchant stays private');
select is(public.get_merchant_profile('13410000-0000-4000-8000-000000000004'),null::jsonb,'revoked consent stays private');
select is(public.get_merchant_profile('13410000-0000-4000-8000-000000000005'),null::jsonb,'lead merchant stays private');
select is(public.get_merchant_profile('13410000-0000-4000-8000-000000000006'),null::jsonb,'pending consent stays private');
select is(public.get_merchant_profile('13410000-0000-4000-8000-000000000007'),null::jsonb,'removed introduction does not publish a profile');
select is(public.get_merchant_profile('13410000-0000-4000-8000-000000000008'),null::jsonb,'unlinked company stays private');
select is(public.get_merchant_profile('13410000-0000-4000-8000-000000000099'),null::jsonb,'unknown merchant stays private');
select is(public.get_merchant_reviews('13420000-0000-4000-8000-000000000002')->>'merchant_id','13410000-0000-4000-8000-000000000001','review summary points to its canonical company');
select throws_ok($$select public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous cannot invoke private profile getter');
reset role;

select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into public.blocks(blocker_id,blocked_id) values('13400000-0000-4000-8000-000000000003','13400000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.get_merchant_profile('13410000-0000-4000-8000-000000000001'),null::jsonb,'blocked introduction author hides the company from that viewer');
select throws_ok($$select public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','personal member cannot open private company profile');
reset role;
delete from public.blocks where blocker_id='13400000-0000-4000-8000-000000000003';
delete from public.reports where reporter_id='13400000-0000-4000-8000-000000000003';
set local role authenticated;
select lives_ok($$select public.create_report('post','13420000-0000-4000-8000-000000000002','other','모의 채널 신고')$$,'profile respects the existing report workflow');
select is(public.get_merchant_profile('13410000-0000-4000-8000-000000000001')->>'review_post_id','13420000-0000-4000-8000-000000000001','reported introduction falls back to an actually visible linked introduction');
reset role;
delete from private.action_rate_events where user_id='13400000-0000-4000-8000-000000000003' and action='report';
set local role authenticated;
select lives_ok($$select public.create_report('user','13400000-0000-4000-8000-000000000001','other','모의 작성자 신고')$$,'viewer may report the introduction author');
select is(public.get_merchant_profile('13410000-0000-4000-8000-000000000001'),null::jsonb,'reported author hides all of its company introductions');
reset role;
delete from public.reports where reporter_id='13400000-0000-4000-8000-000000000003';

select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_my_merchant_profile('13410000-0000-4000-8000-000000000008')->>'id','13410000-0000-4000-8000-000000000008','owner can prepare a profile before a public introduction exists');
select is(public.get_my_merchant_profile('13410000-0000-4000-8000-000000000008')->'review_post_id','null'::jsonb,'private profile does not invent a public review introduction');
select ok(not (public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001') ? 'contact'),'profile editor does not expose private registration contact');
reset role;
update auth.users set raw_app_meta_data='{"merchant_enabled":false}' where id='13400000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"merchant_enabled":true}}',true);
set local role authenticated;
select throws_ok($$select public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','current NO revokes profile workspace despite stale YES JWT');
reset role;
update auth.users set raw_app_meta_data='{"merchant_enabled":"true"}' where id='13400000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','string true does not grant business capability');
reset role;
update auth.users set raw_app_meta_data='{"merchant_enabled":true}' where id='13400000-0000-4000-8000-000000000001';
update private.merchants set owner_verified_at=null where id='13410000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')->>'can_edit','false','unverified owner has no image editing capability');
reset role;
update private.merchants set owner_verified_at=now() where id='13410000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_ACCESS_REQUIRED','other registered company owner cannot read private profile');
reset role;
select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')$$,'P0001','ACCOUNT_LOCKED','inactive account cannot read private profile');
reset role;
select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1","session_id":"13490000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')$$,'P0001','ADMIN_REQUIRED','AAL1 admin cannot use profile workspace');
reset role;
select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2","session_id":"13490000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')->>'can_edit','true','MFA admin can prepare and edit independent business profiles');
reset role;
select ok(exists(select 1 from public.admin_access_logs where actor_id='13400000-0000-4000-8000-000000000005' and scope='analytics'),'admin profile read is audited');
update private.merchants set owner_id=null where id='13410000-0000-4000-8000-000000000002';
update auth.users set raw_app_meta_data='{"role":"admin","merchant_enabled":true}' where id='13400000-0000-4000-8000-000000000005';
set local role authenticated;
select is(public.get_my_merchant_profile('13410000-0000-4000-8000-000000000002')->>'can_edit','true','MFA admin can edit an unowned prepared profile');
reset role;
update private.merchants set owner_id='13400000-0000-4000-8000-000000000002' where id='13410000-0000-4000-8000-000000000002';
update auth.users set raw_app_meta_data='{"role":"admin"}' where id='13400000-0000-4000-8000-000000000005';

select has_function('public','save_my_merchant_profile',array['uuid','text','text','timestamp with time zone'],'profile image writer is installed');
insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values
('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp','13400000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":2097152}'),
('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000002.webp','13400000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":3000}'),
('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000003.webp','13400000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":3000}'),
('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000004.webp','13400000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":3000}'),
('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000005.webp','13400000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":2097153}'),
('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000006.webp','13400000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":0}'),
('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000007.webp','13400000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":"99999999999999999999999999"}'),
('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000008.webp','13400000-0000-4000-8000-000000000002','13400000-0000-4000-8000-000000000002','{"mimetype":"image/webp","size":3000}'),
('merchant-profile-images','13400000-0000-4000-8000-000000000002/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp','13400000-0000-4000-8000-000000000002','13400000-0000-4000-8000-000000000002','{"mimetype":"image/webp","size":3000}'),
('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000002_13440000-0000-4000-8000-000000000001.webp','13400000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":3000}'),
('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000008_13440000-0000-4000-8000-000000000001.webp','13400000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":3000}');
create temporary table profile_before as select id,updated_at from private.merchants where id='13410000-0000-4000-8000-000000000001';
grant select on profile_before to authenticated;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images'),0::bigint,'unsaved profile photos cannot be signed anonymously');
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',null,null,null)$$,'42501',null,'anonymous cannot save profile images');
reset role;
select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images' and name='13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp'),1::bigint,'verified owner can preview its own unsaved photo');
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000020.webp','13400000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":3000}')$$,'current verified owner can upload an immutable photo to its company');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000002_13440000-0000-4000-8000-000000000020.webp','13400000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":3000}')$$,'42501',null,'owner cannot upload to another company');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values('merchant-profile-images','13400000-0000-4000-8000-000000000002/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000020.webp','13400000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":3000}')$$,'42501',null,'owner cannot upload under another account prefix');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000020.jpg','13400000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":3000}')$$,'42501',null,'non-WebP upload path is refused');
select lives_ok($$do $check$ declare saved jsonb; begin
  saved:=public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',
    '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp',
    '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000002.webp',(select updated_at from profile_before));
  if saved->>'id' is distinct from '13410000-0000-4000-8000-000000000001'
    or saved->>'can_edit' is distinct from 'true'
    or saved->>'review_post_id' is distinct from '13420000-0000-4000-8000-000000000002'
    or saved->>'avatar_path' is distinct from '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp'
    or saved->>'banner_path' is distinct from '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000002.webp'
    or saved->>'updated_at' is null then raise exception 'save did not return the confirmed server profile'; end if;
end $check$;$$,'valid 2 MiB avatar and ordered profile fields return the saved server DTO');
with overwritten as(update storage.objects set metadata='{"mimetype":"image/webp","size":4}' where bucket_id='merchant-profile-images' returning id)
select is((select count(*) from overwritten),0::bigint,'profile upload overwrite has no UPDATE policy');
with deleted as(delete from storage.objects where bucket_id='merchant-profile-images' and name='13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp' returning id)
select is((select count(*) from deleted),0::bigint,'bound or uncertain-saved profile image cannot be deleted');
with deleted as(delete from storage.objects where bucket_id='merchant-profile-images' and name='13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000020.webp' returning id)
select is((select count(*) from deleted),1::bigint,'verified uploader can clean its unbound unused image');
reset role;
select is((select avatar_path from private.merchants where id='13410000-0000-4000-8000-000000000001'),'13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp','save binds the canonical avatar path');
select ok((select updated_at from private.merchants where id='13410000-0000-4000-8000-000000000001') is distinct from (select updated_at from profile_before),'actual image change advances the opaque revision');
create temporary table profile_saved as select id,updated_at from private.merchants where id='13410000-0000-4000-8000-000000000001';
grant select on profile_saved to authenticated;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images'),2::bigint,'anonymous signing sees only saved images of eligible public profiles');
reset role;
update private.merchants set status='paused' where id='13410000-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images'),0::bigint,'private company status also revokes new anonymous image signing');
reset role;
update private.merchants set status='trial' where id='13410000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',
  '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp',
  '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000002.webp',(select updated_at from profile_before))$$,'uncertain same-path retry succeeds even with the old revision');
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',null,null,(select updated_at from profile_before))$$,'P0001','MERCHANT_PROFILE_CHANGED','stale revision cannot erase a newer profile');
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',null,null,null)$$,'P0001','MERCHANT_PROFILE_CHANGED','changed data requires a real expected revision');
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001','https://evil.example/photo.webp',null,(select updated_at from profile_saved))$$,'P0001','INVALID_MERCHANT_PROFILE_IMAGE','external photo URLs are refused');
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000001/../photo.webp',null,(select updated_at from profile_saved))$$,'P0001','INVALID_MERCHANT_PROFILE_IMAGE','path traversal is refused');
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001','',null,(select updated_at from profile_saved))$$,'P0001','INVALID_MERCHANT_PROFILE_IMAGE','empty string is not a removal request');
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000002/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp',null,(select updated_at from profile_saved))$$,'P0001','INVALID_MERCHANT_PROFILE_IMAGE','another uploader photo cannot become a new binding');
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000002_13440000-0000-4000-8000-000000000001.webp',null,(select updated_at from profile_saved))$$,'P0001','INVALID_MERCHANT_PROFILE_IMAGE','photo scoped to another merchant is refused');
select throws_ok(format($case$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',%L,null,(select updated_at from profile_saved))$case$,
  '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-'||suffix||'.webp'),
  'P0001','INVALID_MERCHANT_PROFILE_IMAGE',label)
from(values('000000000004','stored MIME mismatch is refused'),('000000000005','oversized object is refused'),('000000000006','empty image is refused'),('000000000007','unbounded forged size metadata is refused'),('000000000008','forged object owner metadata is refused'),('000000000099','missing own image is refused'))v(suffix,label);
reset role;
select is((select updated_at from private.merchants where id='13410000-0000-4000-8000-000000000001'),(select updated_at from profile_saved),'same-path retry and failed writes leave revision unchanged');
select throws_ok($$update private.merchants set avatar_path='13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000002_13440000-0000-4000-8000-000000000001.webp' where id='13410000-0000-4000-8000-000000000001'$$,'23514',null,'direct writes cannot bind a different merchant path');

update auth.users set raw_app_meta_data='{"merchant_enabled":false}' where id='13400000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"merchant_enabled":true}}',true);
set local role authenticated;
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',
  '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp',
  '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000002.webp',(select updated_at from profile_before))$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','same-path retry still checks the current NO capability');
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images' and name='13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000003.webp'),0::bigint,'NO capability revokes unbound private image preview');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values('merchant-profile-images','13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000022.webp','13400000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":3000}')$$,'42501',null,'current NO cannot upload despite stale YES JWT');
with deleted as(delete from storage.objects where bucket_id='merchant-profile-images' and name='13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000003.webp' returning id)
select is((select count(*) from deleted),0::bigint,'current NO cannot use cleanup as a mutation bypass');
reset role;
update auth.users set raw_app_meta_data='{"merchant_enabled":true}' where id='13400000-0000-4000-8000-000000000001';
update private.merchants set owner_verified_at=null where id='13410000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',null,null,(select updated_at from profile_saved))$$,'P0001','MERCHANT_OWNER_VERIFICATION_REQUIRED','unverified claimant cannot change profile photos');
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images' and name='13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000003.webp'),0::bigint,'unverified claimant cannot preview unbound uploads');
reset role;
update private.merchants set owner_verified_at=now(),owner_id='13400000-0000-4000-8000-000000000002' where id='13410000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',null,null,(select updated_at from profile_saved))$$,'P0001','MERCHANT_ACCESS_REQUIRED','former owner cannot save after actual ownership changes');
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images' and name='13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000003.webp'),0::bigint,'former owner has no stale private upload preview');
select lives_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000008',
  '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000008_13440000-0000-4000-8000-000000000001.webp',null,
  (public.get_my_merchant_profile('13410000-0000-4000-8000-000000000008')->>'updated_at')::timestamptz)$$,'owner can save a company image privately before publication');
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images' and name='13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000008_13440000-0000-4000-8000-000000000001.webp'),1::bigint,'workspace owner can sign its private saved profile photo');
reset role;
select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images' and name='13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000008_13440000-0000-4000-8000-000000000001.webp'),0::bigint,'another verified business cannot sign a private saved photo');
select lives_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',
  '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp',
  '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000002.webp',(select updated_at from profile_before))$$,'new genuine owner may retain immutable previously saved photos');
select lives_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',
  '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp',
  '13400000-0000-4000-8000-000000000002/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp',
  (public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)$$,'new owner can replace one photo while retaining another uploader saved photo');
select lives_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',
  '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp',null,
  (public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)$$,'explicit null removes only the requested banner');
select is(public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')->'banner_path','null'::jsonb,'banner removal is confirmed in the server DTO');
select lives_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',
  '13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp',
  '13400000-0000-4000-8000-000000000002/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp',
  (public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)$$,'same immutable unused photo can be bound again by its authorized uploader');
reset role;

select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into public.blocks(blocker_id,blocked_id) values('13400000-0000-4000-8000-000000000003','13400000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images'),0::bigint,'blocked public introduction also prevents image signing for that reader');
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000002',null,null,null)$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','personal member cannot save even an unchanged empty profile');
reset role;
delete from public.blocks where blocker_id='13400000-0000-4000-8000-000000000003';
delete from public.reports where reporter_id='13400000-0000-4000-8000-000000000003';
select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000002',null,null,null)$$,'P0001','ACCOUNT_LOCKED','inactive account cannot save unchanged profile data');
reset role;

select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1","session_id":"13490000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images' and name='13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000008_13440000-0000-4000-8000-000000000001.webp'),0::bigint,'AAL1 admin cannot sign private company images');
reset role;
select set_config('request.jwt.claims','{"sub":"13400000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2","session_id":"13490000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
create temporary table profile_audit_before as select count(*) n from public.admin_access_logs where actor_id='13400000-0000-4000-8000-000000000005';
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images' and name='13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000008_13440000-0000-4000-8000-000000000001.webp'),1::bigint,'current MFA admin may sign a saved private company image under workspace scope');
select lives_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')->>'avatar_path',public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')->>'banner_path',(public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)$$,'MFA admin retains the actual company photos');
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values('merchant-profile-images','13400000-0000-4000-8000-000000000005/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000020.webp','13400000-0000-4000-8000-000000000005','{"mimetype":"image/webp","size":3000}')$$,'MFA admin can upload a business profile image');
reset role;
select ok((select count(*) from public.admin_access_logs where actor_id='13400000-0000-4000-8000-000000000005')>(select n from profile_audit_before),'private saved-photo admin authorization is audited');
update private.merchants set owner_id='13400000-0000-4000-8000-000000000005' where id='13410000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.get_my_merchant_profile('13410000-0000-4000-8000-000000000001')->>'can_edit','true','current MFA admin editing is independent of the customer YES flag');
select throws_ok($$select public.save_my_merchant_profile('13410000-0000-4000-8000-000000000001',null,null,null)$$,'P0001','MERCHANT_PROFILE_CHANGED','MFA admin still needs the current revision before changing photos');
reset role;
update private.merchants set owner_id='13400000-0000-4000-8000-000000000002' where id='13410000-0000-4000-8000-000000000001';

-- A transferred company may retain the former uploader's avatar. Erasure must
-- preserve that company asset and the new owner's independent banner.
select ok((select avatar_path is not null and banner_path is not null from private.merchants where id='13410000-0000-4000-8000-000000000001'),'erasure fixture has both saved transferred-company images');
select ok((select avatar_path is not null from private.merchants where id='13410000-0000-4000-8000-000000000008'),'erasure fixture has the deleted uploader current private company image');
update public.posts set author_id='13400000-0000-4000-8000-000000000002' where id in('13420000-0000-4000-8000-000000000001','13420000-0000-4000-8000-000000000002');
update public.profiles set account_status='deleted' where id='13400000-0000-4000-8000-000000000001';
select is((select avatar_path from private.merchants where id='13410000-0000-4000-8000-000000000001'),'13400000-0000-4000-8000-000000000001/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp','deleted uploader does not erase a surviving owner company asset');
select is((select banner_path from private.merchants where id='13410000-0000-4000-8000-000000000001'),'13400000-0000-4000-8000-000000000002/13410000-0000-4000-8000-000000000001_13440000-0000-4000-8000-000000000001.webp','erasure preserves the new active uploader independent banner');
select is((select avatar_path from private.merchants where id='13410000-0000-4000-8000-000000000008'),null::text,'deleted current owner private profile reference is erased');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_merchant_profile('13410000-0000-4000-8000-000000000001')->>'id','13410000-0000-4000-8000-000000000001','new active introduction keeps the transferred company public');
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images' and name like '13400000-0000-4000-8000-000000000001/%'),1::bigint,'surviving company asset remains public after its uploader leaves');
reset role;

select * from finish();
rollback;
