begin;
set local search_path=public,extensions;
select no_plan();

select has_function('public','get_shared_link_preview',array['uuid'],'shared links expose a narrow metadata preview');

insert into auth.users(id,email) values
 ('9d000000-0000-4000-8000-000000000001','share-owner@example.invalid'),
 ('9d000000-0000-4000-8000-000000000002','share-viewer@example.invalid');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'공유검사'||right(id::text,1),'vancouver',now(),now(),now(),'test'
from auth.users where id::text like '9d000000-%';
insert into public.posts(id,author_id,city_id,tag_id,title,body,image_paths,room_preview,posted_on)
values
 ('9d100000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000001','vancouver',1,'동네 이야기',
  'private body sentinel',array['9d000000-0000-4000-8000-000000000001/cover.webp','9d000000-0000-4000-8000-000000000001/private.webp'],null,current_date),
 ('9d100000-0000-4000-8000-000000000002','9d000000-0000-4000-8000-000000000001','vancouver',(select id from public.tags where slug='festival'),'가을 페스티벌',
  'private festival body sentinel','{}',null,current_date),
 ('9d100000-0000-4000-8000-000000000003','9d000000-0000-4000-8000-000000000001','vancouver',(select id from public.tags where kind='meetup' limit 1),'페스티벌 같이 가요',
  'private exact location sentinel',array['9d000000-0000-4000-8000-000000000001/meetup.webp'],
  jsonb_build_object('eventKind','once','startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 2 hours','timezone','America/Vancouver','capacity',8,'applicationQuestion','private question sentinel','location','private venue sentinel'),current_date);
insert into public.comments(post_id,author_id,body)
values('9d100000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000002','private comment sentinel');

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000001')->>'kind','post','a normal post has a post preview');
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000002')->>'kind','festival','a festival post has a festival preview');
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000003')->>'kind','meetup','a hosted event has a meetup invitation preview');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000003'))k),
 array['city','closed','id','imagePath','kind','label','schedule','title']::text[],'preview excludes bodies, comments, identities and raw room details');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000003')->'schedule')k),
 array['cadence','endsAt','eventKind','startsAt','timezone']::text[],'only public schedule fields appear in an invitation');
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000001')->>'imagePath','9d000000-0000-4000-8000-000000000001/cover.webp','preview returns the first approved cover only');
select ok(public.is_public_post_image(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000001')->>'imagePath'),'preview cover obeys the existing storage read boundary');
select ok(position('private ' in public.get_shared_link_preview('9d100000-0000-4000-8000-000000000003')::text)=0,'private venue, question and body do not leak');
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000001')->'schedule','null'::jsonb,'regular posts have no invented schedule');
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000099'),null::jsonb,'missing post has no preview');
reset role;

update public.posts set image_paths=array['9d000000-0000-4000-8000-000000000002/not-owned.webp','9d000000-0000-4000-8000-000000000001/private.webp']
where id='9d100000-0000-4000-8000-000000000001';
set local role anon;
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000001')->'imagePath','null'::jsonb,'invalid first image never reveals another user image or later attachments');
reset role;

update public.posts set room_preview=room_preview||'{"closed":true}'::jsonb where id='9d100000-0000-4000-8000-000000000003';
set local role anon;
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000003')->>'closed','true','closed invitation remains clear without reopening membership');
reset role;
update public.posts set status='removed' where id='9d100000-0000-4000-8000-000000000002';
set local role anon;
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000002'),null::jsonb,'removed festival has no preview');
reset role;

select set_config('request.jwt.claims','{"sub":"9d000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.create_report('post','9d100000-0000-4000-8000-000000000001','other','공유 링크 신고 숨김 검사');
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000001'),null::jsonb,'reported post cannot reappear through a preview');
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000003')->>'kind','meetup','another unreported invitation remains visible');
insert into public.blocks(blocker_id,blocked_id) values('9d000000-0000-4000-8000-000000000002','9d000000-0000-4000-8000-000000000001');
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000003'),null::jsonb,'blocking hides the author invitation too');
reset role;
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code)
values('9d000000-0000-4000-8000-000000000002','9d000000-0000-4000-8000-000000000001','user','9d000000-0000-4000-8000-000000000001','other');
delete from public.blocks where blocker_id='9d000000-0000-4000-8000-000000000002';
set local role authenticated;
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000003'),null::jsonb,'reported user remains hidden even after removing a block');
reset role;

select set_config('request.jwt.claims','{"role":"anon"}',true);
update public.profiles set account_status='suspended' where id='9d000000-0000-4000-8000-000000000001';
set local role anon;
select is(public.get_shared_link_preview('9d100000-0000-4000-8000-000000000003'),null::jsonb,'inactive host has no anonymous invitation preview');
reset role;
select ok(has_function_privilege('anon','public.get_shared_link_preview(uuid)','execute'),'anonymous visitors can read metadata');
select ok(has_function_privilege('authenticated','public.get_shared_link_preview(uuid)','execute'),'signed in recipients can read metadata');
select ok(not has_function_privilege('service_role','public.get_shared_link_preview(uuid)','execute'),'preview does not add service-role access');
select ok(not has_table_privilege('anon','public.posts','select'),'preview does not grant anonymous table reads');
select is((select count(*)::integer from public.meetup_requests where post_id='9d100000-0000-4000-8000-000000000003'),0,'reading invitations creates no join request or membership');
select * from finish();
rollback;
