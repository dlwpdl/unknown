begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,raw_app_meta_data) values
 ('9f000000-0000-4000-8000-000000000001','cover-author@example.invalid','{"merchant_enabled":true}'),
 ('9f000000-0000-4000-8000-000000000002','cover-uploader@example.invalid','{}'),
 ('9f000000-0000-4000-8000-000000000003','cover-viewer@example.invalid','{}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'업체표지'||right(id::text,1),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '9f000000-%';
insert into public.posts(id,author_id,city_id,tag_id,title,body,image_paths,posted_on) values
 ('9f100000-0000-4000-8000-000000000001','9f000000-0000-4000-8000-000000000001','vancouver',1,'연결된 업체 표지','local fixture',
  array['9f000000-0000-4000-8000-000000000002/merchant-cover.webp','9f000000-0000-4000-8000-000000000002/merchant-detail.webp'],current_date),
 ('9f100000-0000-4000-8000-000000000002','9f000000-0000-4000-8000-000000000001','vancouver',1,'연결되지 않은 타인 사진','local fixture',
  array['9f000000-0000-4000-8000-000000000002/unbound.webp'],current_date);
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,owner_id,owner_verified_at,trial_ends_at)
values('9f300000-0000-4000-8000-000000000001','업체 표지 검사','vancouver','','trial','granted','local fixture','9f000000-0000-4000-8000-000000000001',now(),current_date+1);
insert into private.merchant_posts(post_id,merchant_id,original_url)
values('9f100000-0000-4000-8000-000000000001','9f300000-0000-4000-8000-000000000001',null);
insert into storage.objects(bucket_id,name) values
 ('post-images','9f000000-0000-4000-8000-000000000002/merchant-cover.webp'),
 ('post-images','9f000000-0000-4000-8000-000000000002/merchant-detail.webp'),
 ('post-images','9f000000-0000-4000-8000-000000000002/unbound.webp');

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select ok(public.is_public_post_image('9f000000-0000-4000-8000-000000000002/merchant-cover.webp'),'bound merchant first cover remains signable even with a different uploader');
select ok(not public.is_public_post_image('9f000000-0000-4000-8000-000000000002/merchant-detail.webp'),'bound merchant later image cannot bypass login');
select ok(not public.is_public_post_image('9f000000-0000-4000-8000-000000000002/unbound.webp'),'unbound foreign first image remains forbidden');
select is(public.get_shared_link_preview('9f100000-0000-4000-8000-000000000001')->>'imagePath','9f000000-0000-4000-8000-000000000002/merchant-cover.webp','metadata preserves an approved cross-uploader merchant cover');
select is((select image_paths from public.get_public_post('9f100000-0000-4000-8000-000000000001')),array['9f000000-0000-4000-8000-000000000002/merchant-cover.webp'],'anonymous discovery preserves the bound merchant first cover');
select is(public.get_shared_link_preview('9f100000-0000-4000-8000-000000000002')->>'imagePath',null,'metadata does not expose an unbound foreign cover');
select results_eq($$select name from storage.objects where bucket_id='post-images' and name like '9f000000-%' order by name$$,
 array['9f000000-0000-4000-8000-000000000002/merchant-cover.webp'],'anonymous storage RLS reveals only the bound first cover');
reset role;

select set_config('request.jwt.claims','{"sub":"9f000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select ok(public.can_read_merchant_post_image('9f000000-0000-4000-8000-000000000002/merchant-cover.webp'),'logged-in non-uploader can read the bound cover through the production delegate');
select ok(public.can_read_merchant_post_image('9f000000-0000-4000-8000-000000000002/merchant-detail.webp'),'logged-in non-uploader can sign additional photos through the production delegate');
select ok(not public.can_read_merchant_post_image('9f000000-0000-4000-8000-000000000002/unbound.webp'),'login does not expose an unbound foreign photo');
select results_eq($$select name from storage.objects where bucket_id='post-images' and name like '9f000000-%' order by name$$,
 array['9f000000-0000-4000-8000-000000000002/merchant-cover.webp','9f000000-0000-4000-8000-000000000002/merchant-detail.webp'],'authenticated storage RLS preserves cover and detail photos for a non-uploader');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);

update public.posts set status='removed' where id='9f100000-0000-4000-8000-000000000001';
set local role anon;
select ok(not public.is_public_post_image('9f000000-0000-4000-8000-000000000002/merchant-cover.webp'),'removed merchant post cannot keep its cover public');
reset role;
update public.posts set status='published' where id='9f100000-0000-4000-8000-000000000001';
update public.profiles set account_status='suspended' where id='9f000000-0000-4000-8000-000000000001';
set local role anon;
select ok(not public.is_public_post_image('9f000000-0000-4000-8000-000000000002/merchant-cover.webp'),'inactive author cannot keep a merchant cover public');
reset role;
update public.profiles set account_status='active' where id='9f000000-0000-4000-8000-000000000001';
delete from private.merchant_posts where post_id='9f100000-0000-4000-8000-000000000001';
set local role anon;
select ok(not public.is_public_post_image('9f000000-0000-4000-8000-000000000002/merchant-cover.webp'),'removing merchant binding closes foreign cover access');
reset role;
select * from finish();
rollback;
