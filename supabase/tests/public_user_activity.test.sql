begin;
select no_plan();
insert into auth.users(id,email) values('9c000000-0000-0000-0000-000000000001','history-owner@example.invalid'),('9c000000-0000-0000-0000-000000000002','history-viewer@example.invalid');
insert into public.profiles(id,nickname,city_id) values('9c000000-0000-0000-0000-000000000001','공개이력','vancouver'),('9c000000-0000-0000-0000-000000000002','방문자','vancouver');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,created_at)
select ('9c100000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'9c000000-0000-0000-0000-000000000001','vancouver',1,'예전 오늘 글 '||n,'공개한 이야기',current_date,now()-n*interval '1 day' from generate_series(1,34)n;
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,kind,listing_status,expires_at)
values('9c200000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001','vancouver',1,'의자 팔아요','사용한 의자',current_date,'listing','closed',now()+interval '1 day');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,status)
values('9c300000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001','vancouver',1,'삭제한 글','비공개 원문',current_date,'removed');
set local role anon;
select is(public.get_public_user_profile('9c000000-0000-0000-0000-000000000001')->>'storyCount','34','profile counts only current public stories');
select is(public.get_public_user_profile('9c000000-0000-0000-0000-000000000001')->>'completedCount','1','completed listings remain visible as author-declared history');
select ok(not(public.get_public_user_profile('9c000000-0000-0000-0000-000000000001') ?| array['email','phone','messages','reports','reviewBody']),'public profile contains no contact/message/report/private feedback fields');
select is(jsonb_array_length(public.get_public_user_activity('9c000000-0000-0000-0000-000000000001','story')),30,'first history page is bounded and includes older days');
select public.get_public_user_activity('9c000000-0000-0000-0000-000000000001','story')->29->>'created_at' as cursor_at \gset
select public.get_public_user_activity('9c000000-0000-0000-0000-000000000001','story')->29->>'id' as cursor_id \gset
select is(jsonb_array_length(public.get_public_user_activity('9c000000-0000-0000-0000-000000000001','story',:'cursor_at',:'cursor_id')),4,'cursor reveals the remaining public history without overlap');
select is(public.get_public_user_activity('9c000000-0000-0000-0000-000000000001','listing')->0->>'listing_status','closed','completed state is returned in the normal post DTO');
select throws_ok($$select public.get_public_user_activity('9c000000-0000-0000-0000-000000000001','private')$$,'P0001','INVALID_POST_KIND','arbitrary private categories are rejected');
select throws_ok($$select public.get_public_user_activity('9c000000-0000-0000-0000-000000000001','story',now(),null)$$,'P0001','INVALID_CURSOR','half a cursor is refused');
reset role;
select set_config('request.jwt.claims','{"sub":"9c000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.create_report('post','9c100000-0000-0000-0000-000000000001','other','신고 숨김 이력을 확인하는 로컬 테스트');
select is(public.get_public_user_profile('9c000000-0000-0000-0000-000000000001')->>'storyCount','33','reported stories disappear from profile counts too');
select ok(not exists(select 1 from jsonb_array_elements(public.get_public_user_activity('9c000000-0000-0000-0000-000000000001','story')) x where x->>'id'='9c100000-0000-0000-0000-000000000001'),'reported story cannot reappear through the history API');
insert into public.blocks(blocker_id,blocked_id) values('9c000000-0000-0000-0000-000000000002','9c000000-0000-0000-0000-000000000001');
select is(public.get_public_user_profile('9c000000-0000-0000-0000-000000000001'),null::jsonb,'blocked account has no public profile for this viewer');
select is(public.get_public_user_activity('9c000000-0000-0000-0000-000000000001','story'),'[]'::jsonb,'blocking also hides author activity');
reset role;
update public.profiles set account_status='deleted' where id='9c000000-0000-0000-0000-000000000001';
set local role anon;
select is(public.get_public_user_profile('9c000000-0000-0000-0000-000000000001'),null::jsonb,'deactivated author metadata is not returned to guests');
select is(public.get_public_user_activity('9c000000-0000-0000-0000-000000000001','listing'),'[]'::jsonb,'deactivated author completed listings are hidden too');
reset role;
select * from finish();
rollback;
