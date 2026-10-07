begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('merchant-test','업체검사','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
('11700000-0000-0000-0000-000000000001','merchant-admin@example.com','{"role":"admin"}'),
('11700000-0000-0000-0000-000000000002','merchant-reader@example.com','{}'),
('11700000-0000-0000-0000-000000000003','merchant-seed@seed.gling.invalid','{}');
insert into auth.sessions(id,user_id,aal) values('11760000-0000-0000-0000-000000000001','11700000-0000-0000-0000-000000000001','aal2');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
('11700000-0000-0000-0000-000000000001','업체관리검사','merchant-test',now(),now(),now(),'test'),
('11700000-0000-0000-0000-000000000002','업체열람검사','merchant-test',now(),now(),now(),'test'),
('11700000-0000-0000-0000-000000000003','업체시드검사','merchant-test',now(),now(),now(),'synthetic-seed');
insert into public.posts(id,author_id,city_id,tag_id,title,body,status,view_count) values
('11710000-0000-0000-0000-000000000001','11700000-0000-0000-0000-000000000001','merchant-test',(select id from public.tags where slug='life'),'허락받은 업체 안내','검사 원고입니다.','published',135);
select set_config('request.jwt.claims','{"sub":"11700000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_merchants()$$,'P0001','ADMIN_REQUIRED','members cannot read merchant contacts');
select throws_ok($$select * from private.merchants$$,'42501',null,'raw merchants private');
select throws_ok($$select public.save_admin_merchant(null,'업체','merchant-test','','trial','granted','허락')$$,'P0001','ADMIN_REQUIRED','member cannot register merchant');
reset role;
select set_config('request.jwt.claims','{"sub":"11700000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"11760000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.save_admin_merchant(null,'업체','merchant-test','','trial','granted','')$$,'P0001','MERCHANT_CONSENT_REQUIRED','consent must have evidence');
select is(public.save_admin_merchant('11720000-0000-0000-0000-000000000001','동네 카페','merchant-test','담당자 연락 기록','trial','granted','사장님 원고·사진과 게시 범위를 허락함'),'11720000-0000-0000-0000-000000000001'::uuid,'admin registers merchant');
select is((public.get_admin_merchants('동네')->'merchants'->0->>'contact'),'담당자 연락 기록','private contact readback');
select throws_ok($$select public.link_admin_merchant_post('11720000-0000-0000-0000-000000000001','11710000-0000-0000-0000-000000000001','javascript:alert(1)')$$,'P0001','INVALID_ORIGINAL_URL','unsafe links refused by server');
select is(public.link_admin_merchant_post('11720000-0000-0000-0000-000000000001','11710000-0000-0000-0000-000000000001','https://example.com/original'),'11710000-0000-0000-0000-000000000001'::uuid,'post linked');
select throws_ok($$select public.save_admin_merchant('11720000-0000-0000-0000-000000000001','동네 카페','toronto','','trial','granted','허락')$$,'P0001','MERCHANT_CITY_LOCKED','linked posts keep merchant city consistent');
select throws_ok($$select public.get_admin_merchant('11720000-0000-0000-0000-000000000001',current_date-100,current_date)$$,'P0001','INVALID_MERCHANT_PERIOD','retained date range enforced');
select lives_ok($$select public.create_admin_merchant_post('11720000-0000-0000-0000-000000000001','카페 대행 안내','업체가 허락한 메뉴 안내입니다.','life','https://example.com/menu','story','11750000-0000-0000-0000-000000000001')$$,'approved delegate post uses normal publishing');
select lives_ok($$select public.create_admin_merchant_post('11720000-0000-0000-0000-000000000001','카페 대행 안내','업체가 허락한 메뉴 안내입니다.','life','https://example.com/menu','story','11750000-0000-0000-0000-000000000001')$$,'uncertain response retry does not duplicate post');
reset role;
select is((select count(*) from private.merchant_posts where creation_request_id='11750000-0000-0000-0000-000000000001'),1::bigint,'one post for one publishing attempt');
select ok(exists(select 1 from public.posts p join private.merchant_posts mp on mp.post_id=p.id where mp.creation_request_id='11750000-0000-0000-0000-000000000001' and p.body like '%업체의 허락을 받아%' and p.author_id='11700000-0000-0000-0000-000000000001'),'delegation disclosed and author intact');
set local role authenticated;
select lives_ok($$select public.record_merchant_source_click('11710000-0000-0000-0000-000000000001','web','qa-merchant-admin-session','11730000-0000-0000-0000-000000000001')$$,'admin click opens source without contributing');
reset role;
insert into public.post_views(post_id,user_id) values
('11710000-0000-0000-0000-000000000001','11700000-0000-0000-0000-000000000001'),
('11710000-0000-0000-0000-000000000001','11700000-0000-0000-0000-000000000002'),
('11710000-0000-0000-0000-000000000001','11700000-0000-0000-0000-000000000003');
select set_config('request.jwt.claims','{"sub":"11700000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_post_source('11710000-0000-0000-0000-000000000001')->>'original_url','https://example.com/original','public source contains only original and merchant name');
select lives_ok($$select public.record_merchant_source_click('11710000-0000-0000-0000-000000000001','ios','qa-merchant-reader-session','11730000-0000-0000-0000-000000000002')$$,'member source click');
select lives_ok($$select public.record_merchant_source_click('11710000-0000-0000-0000-000000000001','ios','qa-merchant-reader-session','11730000-0000-0000-0000-000000000002')$$,'retry idempotent');
reset role;
select set_config('request.jwt.claims','{"sub":"11700000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.record_merchant_source_click('11710000-0000-0000-0000-000000000001','web','qa-merchant-seed-session','11730000-0000-0000-0000-000000000003')$$,'seed click excluded');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select lives_ok($$select public.record_merchant_source_click('11710000-0000-0000-0000-000000000001','web','qa-merchant-anonymous-session','11730000-0000-0000-0000-000000000004')$$,'anonymous click accepted');
select throws_ok($$select * from private.merchant_source_clicks$$,'42501',null,'click identities private');
select throws_ok($$select public.record_merchant_source_click('11710000-0000-0000-0000-000000000001','web','email@example.com','11730000-0000-0000-0000-000000000005')$$,'P0001','INVALID_MERCHANT_CLICK','arbitrary identifiers rejected');
reset role;
select is((select count(*) from private.merchant_source_clicks where merchant_id='11720000-0000-0000-0000-000000000001'),2::bigint,'real two clicks only');
select set_config('request.jwt.claims','{"sub":"11700000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"11760000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((public.get_admin_merchant('11720000-0000-0000-0000-000000000001',(now() at time zone 'America/Vancouver')::date,(now() at time zone 'America/Vancouver')::date)->'metrics'->>'displayed_views')::int,135,'adjusted display counter included with its own identity');
select is((public.get_admin_merchant('11720000-0000-0000-0000-000000000001',(now() at time zone 'America/Vancouver')::date,(now() at time zone 'America/Vancouver')::date)->'metrics'->>'first_reads')::int,1,'actual reads exclude admin and seed');
select is((public.get_admin_merchant('11720000-0000-0000-0000-000000000001',(now() at time zone 'America/Vancouver')::date,(now() at time zone 'America/Vancouver')::date)->'metrics'->>'anonymous_sessions')::int,1,'anonymous sessions separate');
select is((public.save_admin_merchant_report('11740000-0000-0000-0000-000000000001','11720000-0000-0000-0000-000000000001',(now() at time zone 'America/Vancouver')::date,(now() at time zone 'America/Vancouver')::date,'결과 보고','반응 설명','다음 제안','month',49,'세금 별도')->'metrics'->>'source_clicks')::int,2,'server creates actual snapshot');
select is(public.get_admin_merchant_report('11740000-0000-0000-0000-000000000001')->>'merchant_name','동네 카페','MCP reads canonical saved report');
reset role;
update public.posts set view_count=999 where id='11710000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"11700000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"11760000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((public.save_admin_merchant_report('11740000-0000-0000-0000-000000000001','11720000-0000-0000-0000-000000000001',(now() at time zone 'America/Vancouver')::date,(now() at time zone 'America/Vancouver')::date,'결과 수정','설명 수정','다음 제안','two_weeks',29,'세금 별도')->'metrics'->>'displayed_views')::int,135,'editing prose does not rewrite saved metrics');
select throws_ok($$select public.save_admin_merchant_report('11740000-0000-0000-0000-000000000001','11720000-0000-0000-0000-000000000001',null,null,'결과 수정','설명 수정','다음 제안','two_weeks',29,'세금 별도')$$,'P0001','INVALID_MERCHANT_REPORT','null dates cannot bypass saved period');
select lives_ok($$select public.save_admin_merchant('11720000-0000-0000-0000-000000000001','동네 카페','merchant-test','','paused','revoked','사장님 철회')$$,'revoke consent');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_merchant_post_source('11710000-0000-0000-0000-000000000001'),null::jsonb,'revoked source unavailable');
reset role;
update public.profiles set account_status='deleted' where id='11700000-0000-0000-0000-000000000002';
select is((select count(*) from private.merchant_source_clicks where user_id='11700000-0000-0000-0000-000000000002'),0::bigint,'account erasure removes click identity');
select ok(exists(select 1 from public.admin_access_logs where actor_id='11700000-0000-0000-0000-000000000001' and scope='analytics'),'admin reads and writes audited');
select * from finish();
rollback;
