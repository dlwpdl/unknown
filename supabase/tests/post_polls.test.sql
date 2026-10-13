begin;
select no_plan();
select has_function('public','get_post_poll',array['uuid'],'poll results API exists');
select has_function('public','vote_post_poll',array['uuid','integer','uuid'],'single vote API exists');
select has_function('public','create_post_with_poll',array['text','smallint','text','text','text[]','text[]','jsonb','text','numeric','text','text[]'],'atomic post and poll API exists');
insert into auth.users(id,email,raw_app_meta_data) values
 ('a0121000-0000-4000-8000-000000000001','poll-one@example.invalid','{}'),
 ('a0121000-0000-4000-8000-000000000002','poll-two@example.invalid','{}');
insert into public.profiles(id,nickname,city_id) values
 ('a0121000-0000-4000-8000-000000000001','투표가나다','vancouver'),
 ('a0121000-0000-4000-8000-000000000002','투표라마바','vancouver')
on conflict(id) do update set nickname=excluded.nickname,city_id=excluded.city_id,account_status='active';
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
 ('a0121000-0000-4000-8000-000000000010','a0121000-0000-4000-8000-000000000001','vancouver',(select id from public.tags where slug='life'),'투표 검증','실제 운영에 등록하지 않는 로컬 투표 검증 본문입니다.');
insert into public.post_polls(post_id,question,options) values
 ('a0121000-0000-4000-8000-000000000010','어느 쪽이야?',array['남 이해','남 불가','여 이해','여 불가']);
select isnt((select content_hash from public.safety_review_queue where target_type='post' and target_id='a0121000-0000-4000-8000-000000000010'),
 encode(extensions.digest(convert_to(concat_ws(E'\n','투표 검증','실제 운영에 등록하지 않는 로컬 투표 검증 본문입니다.','[]'), 'UTF8'),'sha256'),'hex'),
 'poll question and choices change the post safety hash');
update public.safety_review_queue set status='reviewed' where target_type='post' and target_id='a0121000-0000-4000-8000-000000000010';
update public.post_polls set question='변경한 질문',options=array['변경한 보기','다른 보기'] where post_id='a0121000-0000-4000-8000-000000000010';
select is((select status from public.safety_review_queue where target_type='post' and target_id='a0121000-0000-4000-8000-000000000010'),'pending','changed poll is reviewed again');
select is((select count(*)::integer from public.safety_review_queue where target_type='post' and target_id='a0121000-0000-4000-8000-000000000010'),1,'poll shares the existing single post review item');
update public.post_polls set question='어느 쪽이야?',options=array['남 이해','남 불가','여 이해','여 불가'] where post_id='a0121000-0000-4000-8000-000000000010';
set local role anon;
select is(public.get_post_poll('a0121000-0000-4000-8000-000000000010'),null::jsonb,'anonymous RPC exposes no authored question, options or results');
select throws_ok($$select question,options from public.post_polls where post_id='a0121000-0000-4000-8000-000000000010'$$,'42501',null,'anonymous direct reads cannot bypass the content login boundary');
select throws_ok($$select public.vote_post_poll('a0121000-0000-4000-8000-000000000010',0,'a0121000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous cannot vote');
reset role;
set local role service_role;
select is((select question from public.post_polls where post_id='a0121000-0000-4000-8000-000000000010'),'어느 쪽이야?','service safety access retains authored poll content');
reset role;
set local role authenticated;
set local request.jwt.claim.sub='a0121000-0000-4000-8000-000000000001';
select is(public.get_post_poll('a0121000-0000-4000-8000-000000000010')->>'question','어느 쪽이야?','logged-in readers receive the authored question');
select is(public.get_post_poll('a0121000-0000-4000-8000-000000000010')->'options','["남 이해","남 불가","여 이해","여 불가"]'::jsonb,'logged-in rendering receives all options');
select is(public.get_post_poll('a0121000-0000-4000-8000-000000000010')->'counts','[0,0,0,0]'::jsonb,'logged-in readers receive results before voting');
select is((select question from public.post_polls where post_id='a0121000-0000-4000-8000-000000000010'),'어느 쪽이야?','authenticated direct poll reads remain visible');
select is(public.vote_post_poll('a0121000-0000-4000-8000-000000000010',0,'a0121000-0000-4000-8000-000000000001')->'counts','[1,0,0,0]'::jsonb,'first option zero is a valid vote');
select is(public.vote_post_poll('a0121000-0000-4000-8000-000000000010',0,'a0121000-0000-4000-8000-000000000001')->'counts','[1,0,0,0]'::jsonb,'retry does not add another vote');
select is(public.vote_post_poll('a0121000-0000-4000-8000-000000000010',1,'a0121000-0000-4000-8000-000000000001')->>'my_vote','0','first vote remains authoritative');
select throws_ok($$select public.vote_post_poll('a0121000-0000-4000-8000-000000000010',0,'a0121000-0000-4000-8000-000000000002')$$,'P0001','AUTH_CHANGED','cannot vote for another account');
select throws_ok($$select public.vote_post_poll('a0121000-0000-4000-8000-000000000010',-1,'a0121000-0000-4000-8000-000000000001')$$,'P0001','INVALID_POLL_OPTION','negative option rejected');
select throws_ok($$select * from private.post_poll_votes$$,'42501',null,'voter identities are private');
set local request.jwt.claim.sub='a0121000-0000-4000-8000-000000000002';
select is(public.vote_post_poll('a0121000-0000-4000-8000-000000000010',3,'a0121000-0000-4000-8000-000000000002')->'counts','[1,0,0,1]'::jsonb,'second account counts once');
select throws_ok($$update public.post_polls set options=array['x','y']$$,'42501',null,'voters cannot rewrite options');
reset role;
update public.posts set status='removed' where id='a0121000-0000-4000-8000-000000000010';
set local role authenticated;
select is(public.get_post_poll('a0121000-0000-4000-8000-000000000010'),null::jsonb,'removed post hides poll');
select throws_ok($$select public.vote_post_poll('a0121000-0000-4000-8000-000000000010',0,'a0121000-0000-4000-8000-000000000002')$$,'P0001','POLL_NOT_FOUND','removed post cannot receive votes');
reset role;
select is((select count(*)::int from private.post_poll_votes where post_id='a0121000-0000-4000-8000-000000000010'),2,'only two actual accounts were counted');
update public.posts set status='published' where id='a0121000-0000-4000-8000-000000000010';
create temporary table poll_creation(id uuid);
grant insert,select on poll_creation to authenticated;
set local role authenticated;
insert into poll_creation select public.create_post_with_poll('vancouver',(select id::smallint from public.tags where slug='life'),
 '원자적 투표 등록','글과 투표가 한 번에 등록되는 로컬 테스트입니다.',array[]::text[],array[]::text[],null,'story',null,' 의견이 궁금해 ',array[' 찬성 ','반대']);
select is((select count(*)::int from poll_creation),1,'existing post creation returns its actual saved ID');
select throws_ok($$select public.create_post_with_poll('vancouver',(select id::smallint from public.tags where kind='meetup' order by id limit 1),
 '모임 태그 투표 우회 거부','방 정보 없이 모임 태그로 투표를 만드는 우회를 검사합니다.',array[]::text[],array[]::text[],null,'story',null,'질문',array['하나','둘'])$$,
 'P0001','INVALID_POLL_POST_KIND','meetup tag cannot create a poll through null room metadata and story kind');
select is((select count(*)::int from public.posts where title='모임 태그 투표 우회 거부'),0,'rejected meetup poll leaves no saved post');

select is(public.get_post_poll((select id from poll_creation))->'options','["찬성","반대"]'::jsonb,'the saved post has its poll');
select throws_ok($$select public.create_post_with_poll('vancouver',(select id::smallint from public.tags where slug='life'),
 '잘못된 투표','보기를 중복한 등록은 거부합니다.',array[]::text[],array[]::text[],null,'story',null,'질문',array['같음',' 같음 '])$$,
 'P0001','INVALID_POLL','duplicate answers cannot create a post');
reset role;
create function pg_temp.reject_poll() returns trigger language plpgsql as $$begin raise exception 'TEST_POLL_STORE_FAILED'; end;$$;
create trigger test_poll_store_failure before insert on public.post_polls for each row execute function pg_temp.reject_poll();
set local role authenticated;
select throws_ok($$select public.create_post_with_poll('vancouver',(select id::smallint from public.tags where slug='life'),
 '투표 실패시 글도 롤백','글 삽입 후 투표 저장 실패를 강제하는 테스트입니다.',array[]::text[],array[]::text[],null,'story',null,'질문',array['하나','둘'])$$,
 'P0001','TEST_POLL_STORE_FAILED','poll failure rolls back legacy post creation');
select is((select count(*)::int from public.posts where title='투표 실패시 글도 롤백'),0,'failed atomic creation leaves no post behind');
reset role;
drop trigger test_poll_store_failure on public.post_polls;
insert into public.blocks(blocker_id,blocked_id) values('a0121000-0000-4000-8000-000000000002','a0121000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.get_post_poll('a0121000-0000-4000-8000-000000000010'),null::jsonb,'blocking a post author hides the poll too');
select throws_ok($$select public.vote_post_poll('a0121000-0000-4000-8000-000000000010',0,'a0121000-0000-4000-8000-000000000002')$$,
 'P0001','POLL_NOT_FOUND','blocking a post author prevents a vote');
reset role;
delete from public.blocks where blocker_id='a0121000-0000-4000-8000-000000000002';
update auth.users set raw_app_meta_data='{"gling_persona":{"kind":"gling_operated_character"}}' where id='a0121000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.vote_post_poll('a0121000-0000-4000-8000-000000000010',0,'a0121000-0000-4000-8000-000000000002')$$,
 'P0001','OPERATED_PROFILE_CANNOT_VOTE','operated characters cannot inflate votes');
reset role;
update public.profiles set account_status='deleted' where id='a0121000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.get_post_poll('a0121000-0000-4000-8000-000000000010'),null::jsonb,'deleted author hides poll details and results');
select is((select count(*)::integer from public.post_polls where post_id='a0121000-0000-4000-8000-000000000010'),0,'deleted author is hidden through direct poll reads too');
reset role;
set local role service_role;
select throws_ok($$select * from private.post_poll_votes$$,'42501',null,'service API cannot list individual voters');
reset role;
select * from finish();
rollback;
