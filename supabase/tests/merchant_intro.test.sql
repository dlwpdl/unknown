begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('intro-test','Intro test','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
 ('e5200000-0000-4000-8000-000000000001','intro-owner@example.test','{"merchant_enabled":true}'),
 ('e5200000-0000-4000-8000-000000000002','intro-stranger@example.test','{"merchant_enabled":true}');
insert into public.profiles(id,nickname,city_id) values
 ('e5200000-0000-4000-8000-000000000001','IntroOwner','intro-test'),
 ('e5200000-0000-4000-8000-000000000002','IntroStranger','intro-test');
update public.profiles set terms_accepted_at=now(),privacy_accepted_at=now(),ai_safety_consent_at=now() where city_id='intro-test';
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,owner_id,owner_verified_at) values
 ('e5210000-0000-4000-8000-000000000001','Intro cafe','intro-test','trial','granted','Synthetic rollback fixture','business','e5200000-0000-4000-8000-000000000001',now());

select ok(has_function_privilege('authenticated','public.save_merchant_intro(uuid,text,text,text,timestamptz)','execute')
 and not has_function_privilege('anon','public.save_merchant_intro(uuid,text,text,text,timestamptz)','execute'),'only signed-in members can call the save');
select throws_ok($$update private.merchants set intro_tip=repeat('a',161) where id='e5210000-0000-4000-8000-000000000001'$$,'23514',null,'the table keeps 160 characters at most');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.get_my_merchant_profile('e5210000-0000-4000-8000-000000000001')->>'intro_vibe','','a business starts with an empty intro');
select set_config('test.updated',public.get_my_merchant_profile('e5210000-0000-4000-8000-000000000001')->>'updated_at',true);
select is(public.save_merchant_intro('e5210000-0000-4000-8000-000000000001','  조용하고 창가 자리가 밝아요 ','라테','',current_setting('test.updated')::timestamptz)->>'intro_vibe',
  '조용하고 창가 자리가 밝아요','the business saves its own lines, trimmed');
select is(public.get_merchant_profile('e5210000-0000-4000-8000-000000000001')->>'intro_order','라테','the public profile shows the lines');
select is(public.get_merchant_profile('e5210000-0000-4000-8000-000000000001')->>'intro_tip','','an empty line stays empty');
select throws_ok(format('select public.save_merchant_intro(%L,%L,%L,%L,%L)','e5210000-0000-4000-8000-000000000001','다른 글','라테','',current_setting('test.updated')),
  'P0001','MERCHANT_PROFILE_CHANGED','an old copy cannot overwrite a newer save');
select set_config('test.updated',public.get_my_merchant_profile('e5210000-0000-4000-8000-000000000001')->>'updated_at',true);
select throws_ok(format('select public.save_merchant_intro(%L,%L,%L,%L,%L)','e5210000-0000-4000-8000-000000000001',repeat('가',161),'','',current_setting('test.updated')),
  'P0001','INVALID_MERCHANT_INTRO','more than 160 characters is refused');
select throws_ok(format('select public.save_merchant_intro(%L,%L,%L,%L,%L)','e5210000-0000-4000-8000-000000000001','줄'||chr(10)||'바꿈','','',current_setting('test.updated')),
  'P0001','INVALID_MERCHANT_INTRO','a line break inside a line is refused');
select throws_ok(format('select public.save_merchant_intro(%L,%L,%L,%L,%L)','e5210000-0000-4000-8000-000000000001','','','https://example.test 참고',current_setting('test.updated')),
  'P0001','INVALID_MERCHANT_INTRO','links are refused');
select throws_ok(format('select public.save_merchant_intro(%L,%L,%L,%L,%L)','e5210000-0000-4000-8000-000000000001',null,'','',current_setting('test.updated')),
  'P0001','INVALID_MERCHANT_INTRO','a missing line is refused');

select set_config('request.jwt.claims','{"sub":"e5200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok(format('select public.save_merchant_intro(%L,%L,%L,%L,%L)','e5210000-0000-4000-8000-000000000001','남의 글','','',current_setting('test.updated')),
  'P0001',null,'another member cannot write the intro');
reset role;
select is((select intro_vibe from private.merchants where id='e5210000-0000-4000-8000-000000000001'),'조용하고 창가 자리가 밝아요','refused saves change nothing');
select * from finish();
rollback;
