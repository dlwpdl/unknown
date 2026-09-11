begin;
select plan(16);
select has_function('public','search_admin_users',array['text','integer'],'admin directory RPC exists');
select has_function('public','get_admin_user_overview',array['uuid'],'admin identity RPC exists');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('77770000-1111-1111-1111-111111111111','identity-test@example.test','{}','{"full_name":"Editable Name","access_token":"must-not-leak","birthdate":"1990-01-01"}'),
('77770000-2222-2222-2222-222222222222','identity-admin@example.test','{"role":"admin"}','{}'),
('77770000-3333-3333-3333-333333333333','identity-peer@example.test','{}','{}');
insert into public.profiles(id,nickname,city_id) values
('77770000-1111-1111-1111-111111111111','식별검사회원','vancouver'),
('77770000-2222-2222-2222-222222222222','식별검사관리자','vancouver'),
('77770000-3333-3333-3333-333333333333','식별검사상대','vancouver');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on) values
('77770000-4444-4444-4444-444444444444','77770000-1111-1111-1111-111111111111','vancouver',(select id from public.tags limit 1),'활동검사 글','검사 내용',current_date);
insert into public.comments(id,post_id,author_id,body,created_at)
select ('77770000-5555-5555-5555-'||lpad(n::text,12,'0'))::uuid,'77770000-4444-4444-4444-444444444444','77770000-1111-1111-1111-111111111111','동일시각 댓글 '||n,'2026-09-01 12:00:00+00'::timestamptz from generate_series(1,105) n;
insert into public.conversations(id,user_low_id,user_high_id) values
('77770000-6666-6666-6666-666666666666','77770000-1111-1111-1111-111111111111','77770000-3333-3333-3333-333333333333');
insert into public.messages(conversation_id,sender_id,body) values
('77770000-6666-6666-6666-666666666666','77770000-1111-1111-1111-111111111111','본인 메시지'),
('77770000-6666-6666-6666-666666666666','77770000-3333-3333-3333-333333333333','상대 메시지');
select set_config('request.jwt.claims','{"sub":"77770000-1111-1111-1111-111111111111","role":"authenticated","user_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.search_admin_users()$$,'P0001','ADMIN_REQUIRED','editable metadata cannot grant directory access');
select throws_ok($$select public.get_admin_user_overview('77770000-1111-1111-1111-111111111111')$$,'P0001','ADMIN_REQUIRED','members cannot read private identity');
select throws_ok($$select public.get_admin_user_activity('77770000-1111-1111-1111-111111111111')$$,'P0001','ADMIN_REQUIRED','members cannot read an activity timeline');
reset role;
set local role anon;
select throws_ok($$select public.search_admin_users()$$,'42501',null,'anonymous users cannot call directory');
reset role;
select set_config('request.jwt.claims','{"sub":"77770000-2222-2222-2222-222222222222","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.search_admin_users('identity-test@example.test')->>'total','1','email search identifies exact account');
select is(public.search_admin_users('Editable Name')->>'total','1','profile name can be searched');
select ok(not (public.get_admin_user_overview('77770000-1111-1111-1111-111111111111')::text like '%must-not-leak%'),'raw metadata and tokens are not returned');
select is(public.get_admin_user_overview('77770000-1111-1111-1111-111111111111')->>'identity_verified','false','editable identity is never labeled verified');
select is((public.get_admin_user_activity('77770000-1111-1111-1111-111111111111','comment')->>'total')::int,105,'total is not truncated at old 100 row limit');
create temp table first_page as select public.get_admin_user_activity('77770000-1111-1111-1111-111111111111','comment') data;
create temp table second_page as select public.get_admin_user_activity('77770000-1111-1111-1111-111111111111','comment',p_before=>(data#>>'{nextCursor,at}')::timestamptz,p_before_key=>data#>>'{nextCursor,key}') data from first_page;
create temp table third_page as select public.get_admin_user_activity('77770000-1111-1111-1111-111111111111','comment',p_before=>(data#>>'{nextCursor,at}')::timestamptz,p_before_key=>data#>>'{nextCursor,key}') data from second_page;
select is((select count(distinct item->>'event_key')::int from (select jsonb_array_elements(data->'rows') item from first_page union all select jsonb_array_elements(data->'rows') from second_page union all select jsonb_array_elements(data->'rows') from third_page) x),105,'same-timestamp cursor reaches every record once');
select is((public.get_admin_user_activity('77770000-1111-1111-1111-111111111111','comment',p_from=>'2026-09-02') ->>'total')::int,0,'date filter runs across the complete history');
select is((public.get_admin_user_activity('77770000-1111-1111-1111-111111111111','message')->>'total')::int,1,'own activity excludes peer messages');
select is((public.get_admin_user_activity('77770000-1111-1111-1111-111111111111',p_conversation_id=>'77770000-6666-6666-6666-666666666666')->>'total')::int,2,'conversation context includes both speakers');
select ok(exists(select 1 from public.admin_access_logs where actor_id=auth.uid() and subject_user_id='77770000-1111-1111-1111-111111111111' and scope='user_detail'),'identity and timeline reads are attributable');
select * from finish();
rollback;
