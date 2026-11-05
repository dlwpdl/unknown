begin;
select no_plan();

-- A writes photo posts, B is someone else, P is an operated character.
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at) values
 ('b1500000-0000-4000-8000-000000000001','consent-author@test.gling.invalid','{}','{"nickname":"사진 이웃"}',now()),
 ('b1500000-0000-4000-8000-000000000002','consent-other@test.gling.invalid','{}','{"nickname":"다른 이웃"}',now()),
 ('b1500000-0000-4000-8000-000000000003','consent-persona@test.gling.invalid','{"gling_persona":"test"}','{"nickname":"운영 캐릭터"}',now());
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,raw_user_meta_data->>'nickname','vancouver',now(),now(),now(),'test' from auth.users where id::text like 'b1500000-%'
on conflict(id) do update set nickname=excluded.nickname,city_id=excluded.city_id;
insert into public.posts(id,author_id,city_id,tag_id,title,body,status,posted_on,image_paths) values
 ('b1520000-0000-4000-8000-000000000001','b1500000-0000-4000-8000-000000000001','vancouver',1,'동의점검 사진 글','사진 있는 글','published',current_date,array['b1500000-0000-4000-8000-000000000001/a.jpg']),
 ('b1520000-0000-4000-8000-000000000002','b1500000-0000-4000-8000-000000000001','vancouver',1,'동의점검 글만','사진 없는 글','published',current_date,'{}'),
 ('b1520000-0000-4000-8000-000000000003','b1500000-0000-4000-8000-000000000003','vancouver',1,'동의점검 캐릭터 글','캐릭터 사진 글','published',current_date,array['b1500000-0000-4000-8000-000000000003/a.jpg']);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.set_post_photo_consent('b1520000-0000-4000-8000-000000000001',true)$$,'P0001','POST_NOT_FOUND','someone else cannot consent for the author');
select set_config('request.jwt.claims','{"sub":"b1500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.set_post_photo_consent('b1520000-0000-4000-8000-000000000002',true)$$,'P0001','POST_NOT_FOUND','a post without photos cannot be ticked');
select is(public.set_post_photo_consent('b1520000-0000-4000-8000-000000000001',true)->>'consent','true','the author ticks a photo post');
select is((public.get_photo_consent_default()->>'consentedPosts')::integer,1,'the setting counts the ticked post');
select throws_ok($$select public.get_photo_consent_candidates()$$,'P0001','ADMIN_REQUIRED','a member cannot read the candidate list');
select set_config('request.jwt.claims','{"sub":"b1500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is(public.set_post_photo_consent('b1520000-0000-4000-8000-000000000003',true)->>'consent','true','an operated character row can exist');

reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select jsonb_agg(e->>'postId') from jsonb_array_elements(public.get_photo_consent_candidates()) e
  where e->>'postId' like 'b1520000-%'),'["b1520000-0000-4000-8000-000000000001"]'::jsonb,'only the real member''s ticked photo post is a candidate');

reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.set_photo_consent_default(true)->>'photoConsentDefault','true','the author turns the default on');
select is((public.set_photo_consent_default(false)->>'consentedPosts')::integer,0,'turning it off withdraws every earlier yes');
select is(public.set_post_photo_consent('b1520000-0000-4000-8000-000000000001',false)->>'consent','false','withdrawing one post works without a row');

reset role;
set local role anon;
select throws_ok($$select public.get_photo_consent_default()$$,'42501',null,'a signed-out visitor cannot read the setting');
select * from finish();
rollback;
