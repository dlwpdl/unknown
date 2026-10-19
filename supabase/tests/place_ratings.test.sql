begin;
select no_plan();

insert into auth.users(id,email) values
 ('8b980000-0000-4000-8000-000000000001','place-rating-a@example.test'),
 ('8b980000-0000-4000-8000-000000000002','place-rating-b@example.test'),
 ('8b980000-0000-4000-8000-000000000003','place-rating-c@example.test');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'평점검사'||right(id::text,2),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '8b980000-%';
create temp table rating_test_ids(name text primary key,id uuid);
grant select on rating_test_ids to authenticated,anon;

select set_config('request.jwt.claims','{"sub":"8b980000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into rating_test_ids select 'a',(public.write_place_rating('vancouver','osm:node:703754423',8.5,'Gastown',
 E'글링 평점: 8.5/10\n\n해질 때 산책하기 좋아요.\n\n장소 후기: https://www.openstreetmap.org/node/703754423',
 (select id from public.tags where slug='life'))->>'id')::uuid;
select is((public.get_place_rating_summaries('vancouver',array['osm:node:703754423'])->0->>'average')::numeric,8.5::numeric,'first rating is genuine');
select is((public.get_place_rating_summaries('vancouver',array['osm:node:703754423'])->0->>'count')::integer,1,'one member contributes one rating');
select ok(exists(select 1 from public.safety_review_queue q join rating_test_ids f on q.target_id=f.id where f.name='a' and q.target_type='post'),'unreported rating enters normal safety monitoring');
select is((public.write_place_rating('vancouver','osm:node:703754423',9,'Gastown',
 E'글링 평점: 9.0/10\n\n다시 가 보니 더 좋았어요.\n\n장소 후기: https://www.openstreetmap.org/node/703754423',
 (select id from public.tags where slug='life'))->>'id')::uuid,(select id from rating_test_ids where name='a'),'editing returns the same post ID');
select is((public.get_place_rating_summaries('vancouver',array['osm:node:703754423'])->0->>'count')::integer,1,'editing never inflates review count');

select set_config('request.jwt.claims','{"sub":"8b980000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into rating_test_ids select 'b',(public.write_place_rating('vancouver','osm:node:703754423',7,'Gastown',
 E'글링 평점: 7.0/10\n\n낮에도 둘러보기 좋아요.\n\n장소 후기: https://www.openstreetmap.org/node/703754423',
 (select id from public.tags where slug='life'))->>'id')::uuid;
select is((public.get_place_rating_summaries('vancouver',array['osm:node:703754423'])->0->>'average')::numeric,8::numeric,'two Gling scores have their own average');
select is((public.get_place_rating_state('vancouver','osm:node:703754423',array(select id from rating_test_ids))->'myReview'->>'id')::uuid,
 (select id from rating_test_ids where name='b'),'private state returns only the current member draft');
select is((select count(*)::integer from jsonb_object_keys(public.get_place_rating_state('vancouver','osm:node:703754423',array(select id from rating_test_ids))->'scores')),2,'requested visible rows get individual ratings');

select set_config('request.jwt.claims','{"sub":"8b980000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.blocks(blocker_id,blocked_id) values('8b980000-0000-4000-8000-000000000001','8b980000-0000-4000-8000-000000000002');
select is((public.get_place_rating_summaries('vancouver',array['osm:node:703754423'])->0->>'count')::integer,1,'blocked authors are excluded through the existing post boundary');
select ok(not ((public.get_place_rating_state('vancouver','osm:node:703754423',array(select id from rating_test_ids))->'scores') ? (select id::text from rating_test_ids where name='b')),'blocked row ratings stay hidden');
delete from public.blocks where blocker_id='8b980000-0000-4000-8000-000000000001' and blocked_id='8b980000-0000-4000-8000-000000000002';
update public.posts set status='removed' where id=(select id from rating_test_ids where name='b');
select is((public.get_place_rating_summaries('vancouver',array['osm:node:703754423'])->0->>'count')::integer,1,'removed posts leave the average');
select set_config('request.jwt.claims','{"sub":"8b980000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($q$select public.write_place_rating('vancouver','osm:node:703754423',8,'Gastown',
 E'글링 평점: 8.0/10\n\n새 점수\n\n장소 후기: https://www.openstreetmap.org/node/703754423',(select id from public.tags where slug='life'))$q$,
 'P0001','PLACE_REVIEW_REMOVED','a removed review cannot be republished through score updates');

select set_config('request.jwt.claims','{"sub":"8b980000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into rating_test_ids select 'legacy',public.create_post('vancouver',(select id from public.tags where slug='life'),'Gastown',
 E'예전에 남긴 텍스트 후기\n\n장소 후기: https://www.openstreetmap.org/node/703754423');
select is((public.get_place_rating_state('vancouver','osm:node:703754423')->'myReview'->>'id')::uuid,
 (select id from rating_test_ids where name='legacy'),'legacy text reviews remain readable and editable');
select is((public.write_place_rating('vancouver','osm:node:703754423',8,'Gastown',
 E'글링 평점: 8.0/10\n\n점수도 함께 남겨요.\n\n장소 후기: https://www.openstreetmap.org/node/703754423',
 (select id from public.tags where slug='life'))->>'id')::uuid,(select id from rating_test_ids where name='legacy'),'adding a score upgrades the legacy post without a duplicate');
select is((public.get_place_rating_summaries('toronto',array['osm:node:703754423'])->0->>'count')::integer,0,'another city never receives these scores');
select is((public.get_place_rating_summaries('vancouver',array['osm:way:703754423'])->0->>'count')::integer,0,'OSM node and way identities never collide');
select throws_ok($q$select public.write_place_rating('vancouver','osm:node:703754423',8.25,'Gastown',
 E'글링 평점: 8.3/10\n\n후기\n\n장소 후기: https://www.openstreetmap.org/node/703754423',(select id from public.tags where slug='life'))$q$,
 'P0001','INVALID_PLACE_RATING','the server rejects non-half-point scores before numeric rounding');
select throws_ok($q$select public.write_place_rating('vancouver','osm:node:703754423',10.5,'Gastown',
 E'글링 평점: 10.5/10\n\n후기\n\n장소 후기: https://www.openstreetmap.org/node/703754423',(select id from public.tags where slug='life'))$q$,
 'P0001','INVALID_PLACE_RATING','the server rejects scores above ten');
select throws_ok($q$select public.write_place_rating('vancouver','osm:node:703754423',8,'Gastown',
 E'글링 평점: 8.0/10\n\n후기\n\n장소 후기: https://www.openstreetmap.org/way/703754423',(select id from public.tags where slug='life'))$q$,
 'P0001','INVALID_PLACE_RATING','forged metadata cannot bind a score to another OSM type');

set local role authenticated;
select throws_matching($q$update public.posts set place_review_score=10 where id=(select id from rating_test_ids where name='legacy')$q$,
 'permission denied|PLACE_RATING_RPC_REQUIRED','direct client score updates cannot bypass the rating RPC');
reset role;

select set_config('request.jwt.claims','{}',true);
select ok(has_function_privilege('anon','public.get_place_rating_summaries(text,text[])','EXECUTE'),'guests can see nonidentifying rating aggregates');
select ok(not has_function_privilege('anon','public.get_place_rating_state(text,text,uuid[])','EXECUTE'),'guests cannot execute the private review state reader');
select ok(not has_function_privilege('anon','public.write_place_rating(text,text,numeric,text,text,smallint)','EXECUTE'),'guests cannot submit ratings');
select ok(not ((public.get_place_rating_summaries('vancouver',array['osm:node:703754423'])->0) ?| array['body','myReview','scores','authorId']),'public aggregate responses contain no review bodies or member identities');
update public.posts set status='removed' where id in(select id from rating_test_ids);
select is((public.get_place_rating_summaries('vancouver',array['osm:node:703754423'])->0->>'count')::integer,0,'all removed reviews produce a known empty count');
select ok((public.get_place_rating_summaries('vancouver',array['osm:node:703754423'])->0->'average')='null'::jsonb,'an empty score is null, never a manufactured zero');
select * from finish();
rollback;
