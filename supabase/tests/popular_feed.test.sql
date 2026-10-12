begin;
select no_plan();

select has_function('public','get_public_popular_feed_page',array['text','smallint','bigint','timestamp with time zone','uuid','timestamp with time zone','integer'],'popular feed has a bounded score cursor');
select ok(not has_table_privilege('anon','public.posts','select'),'anonymous clients still cannot query posts directly');

insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values
 ('af510000-0000-4000-8000-000000000001','sort-viewer@test.gling.invalid','{"nickname":"정렬 보는 이웃"}',now()),
 ('af510000-0000-4000-8000-000000000002','sort-author@test.gling.invalid','{"nickname":"정렬 글쓴 이웃"}',now()),
 ('af510000-0000-4000-8000-000000000003','sort-blocked@test.gling.invalid','{"nickname":"정렬 차단 이웃"}',now()),
 ('af510000-0000-4000-8000-000000000004','sort-inactive@test.gling.invalid','{"nickname":"정렬 휴면 이웃"}',now());
insert into public.profiles(id,nickname,city_id) select id,raw_user_meta_data->>'nickname','vancouver' from auth.users where id between 'af510000-0000-4000-8000-000000000001' and 'af510000-0000-4000-8000-000000000004'
on conflict(id) do update set nickname=excluded.nickname,city_id=excluded.city_id;
update public.profiles set account_status='suspended' where id='af510000-0000-4000-8000-000000000004';

insert into public.posts(id,author_id,city_id,tag_id,title,body,status,created_at,like_count,comment_count,save_count,image_paths,room_preview) values
 ('af520000-0000-4000-8000-000000000001','af510000-0000-4000-8000-000000000002','vancouver',4,'최고 반응','회원 전용 본문','published',now()-interval '1 day',100,0,0,array['private-first.jpg','private-second.jpg'],'{"id":"private-room","title":"private room title","memberCount":2,"capacity":4}'::jsonb),
 ('af520000-0000-4000-8000-000000000002','af510000-0000-4000-8000-000000000002','vancouver',4,'동점 새 글','본문','published',now()-interval '2 hours',10,2,5,'{}',null),
 ('af520000-0000-4000-8000-000000000003','af510000-0000-4000-8000-000000000002','vancouver',4,'동점 옛 글','본문','published',now()-interval '3 hours',29,0,0,'{}',null),
 ('af520000-0000-4000-8000-000000000004','af510000-0000-4000-8000-000000000002','vancouver',1,'반응 없는 글','본문','published',now()-interval '1 minute',0,0,0,'{}',null),
 ('af520000-0000-4000-8000-000000000005','af510000-0000-4000-8000-000000000002','vancouver',4,'8일 전 글','본문','published',now()-interval '8 days',1000,0,0,'{}',null),
 ('af520000-0000-4000-8000-000000000006','af510000-0000-4000-8000-000000000002','vancouver',4,'미래 글','본문','published',now()+interval '1 hour',1000,0,0,'{}',null),
 ('af520000-0000-4000-8000-000000000007','af510000-0000-4000-8000-000000000002','vancouver',4,'내려간 글','본문','removed',now()-interval '1 day',1000,0,0,'{}',null),
 ('af520000-0000-4000-8000-000000000008','af510000-0000-4000-8000-000000000004','vancouver',4,'휴면 작성자','본문','published',now()-interval '1 day',1000,0,0,'{}',null),
 ('af520000-0000-4000-8000-000000000009','af510000-0000-4000-8000-000000000002','toronto',4,'다른 도시 글','본문','published',now()-interval '1 day',1000,0,0,'{}',null),
 ('af520000-0000-4000-8000-000000000010','af510000-0000-4000-8000-000000000003','vancouver',4,'차단 작성자','본문','published',now()-interval '1 day',1000,0,0,'{}',null),
 ('af520000-0000-4000-8000-000000000011','af510000-0000-4000-8000-000000000002','vancouver',4,'신고한 글','본문','published',now()-interval '1 day',1000,0,0,'{}',null),
 ('af520000-0000-4000-8000-000000000012','af510000-0000-4000-8000-000000000002','vancouver',4,'만료 매물','본문','published',now()-interval '1 day',1000,0,0,'{}',null);
update public.posts set kind='listing',listing_status='open',expires_at=now()-interval '1 hour' where id='af520000-0000-4000-8000-000000000012';
insert into public.blocks(blocker_id,blocked_id) values('af510000-0000-4000-8000-000000000001','af510000-0000-4000-8000-000000000003');
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code) values('af510000-0000-4000-8000-000000000001','af510000-0000-4000-8000-000000000002','post','af520000-0000-4000-8000-000000000011','spam');

select set_config('request.jwt.claims','{"sub":"af510000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

create temp table popular_page as select * from public.get_public_popular_feed_page('vancouver',4::smallint,null,null,null,null,50);
select is((select popularity_score from popular_page where id='af520000-0000-4000-8000-000000000002'),29::bigint,'likes, comments and saves contribute to server rank');
select is((select body from popular_page where id='af520000-0000-4000-8000-000000000001'),'회원 전용 본문','members retain post bodies');
select is((select cardinality(image_paths) from popular_page where id='af520000-0000-4000-8000-000000000001'),2,'members retain all attachments');
select is((select room_preview->>'title' from popular_page where id='af520000-0000-4000-8000-000000000001'),'private room title','members retain room details');
select ok(not exists(select 1 from popular_page where id in ('af520000-0000-4000-8000-000000000005','af520000-0000-4000-8000-000000000006')),'old and future posts are outside the seven-day window');
select ok(not exists(select 1 from popular_page where id in ('af520000-0000-4000-8000-000000000007','af520000-0000-4000-8000-000000000008')),'hidden posts and inactive authors stay hidden');
select ok(not exists(select 1 from popular_page where id in ('af520000-0000-4000-8000-000000000010','af520000-0000-4000-8000-000000000011')),'blocked authors and reported posts stay hidden');
select ok(not exists(select 1 from popular_page where id='af520000-0000-4000-8000-000000000012'),'expired listings stay hidden');
select ok(not exists(select 1 from popular_page where city_id<>'vancouver' or tag_id<>4),'city and category are server filters');
select results_eq($$select id::text from popular_page where id in ('af520000-0000-4000-8000-000000000001','af520000-0000-4000-8000-000000000002','af520000-0000-4000-8000-000000000003') order by popularity_score desc,created_at desc,id desc$$,
 array['af520000-0000-4000-8000-000000000001','af520000-0000-4000-8000-000000000002','af520000-0000-4000-8000-000000000003'],'equal scores break ties by newest creation time');
select is((select count(distinct ranking_as_of)::integer from popular_page),1,'the page has a single eligibility timestamp');

create temp table second_page as select * from public.get_public_popular_feed_page('vancouver',4::smallint,29,now()-interval '2 hours','af520000-0000-4000-8000-000000000002',now(),50);
select ok(exists(select 1 from second_page where id='af520000-0000-4000-8000-000000000003'),'score cursor reaches equal-score older posts');
select ok(not exists(select 1 from second_page where id in ('af520000-0000-4000-8000-000000000001','af520000-0000-4000-8000-000000000002')),'next page excludes preceding score/time/id rows');
select is((select count(*)::integer from public.get_public_popular_feed_page('vancouver',null,0,now(),'ffffffff-ffff-ffff-ffff-ffffffffffff',now(),50) where id='af520000-0000-4000-8000-000000000004'),1,'zero-score cursor remains valid');
select is((select count(*)::integer from public.get_public_popular_feed_page('vancouver',null,null,null,null,null,1)),1,'requested page size is respected');
select ok((select count(*) from public.get_public_popular_feed_page('vancouver',null,null,null,null,null,9999))<=50,'oversized requests are capped');
select throws_ok($$select * from public.get_public_popular_feed_page('vancouver',null,1,null,null,now(),30)$$,'P0001','INVALID_FEED_CURSOR','partial cursors are rejected');
select throws_ok($$select * from public.get_public_popular_feed_page('vancouver',null,-1,now(),'af520000-0000-4000-8000-000000000001',now(),30)$$,'P0001','INVALID_FEED_CURSOR','negative scores are rejected');
select throws_ok($$select * from public.get_public_popular_feed_page('vancouver',null,1,now(),'af520000-0000-4000-8000-000000000001',null,30)$$,'P0001','INVALID_FEED_CURSOR','next pages must retain their eligibility timestamp');

reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
select is((select body from public.get_public_popular_feed_page('vancouver',4::smallint) where id='af520000-0000-4000-8000-000000000001'),'','guest bodies remain redacted');
select is((select image_paths from public.get_public_popular_feed_page('vancouver',4::smallint) where id='af520000-0000-4000-8000-000000000001'),'{}'::text[],'guests cannot see private attachment paths');
select is((select room_preview->>'title' from public.get_public_popular_feed_page('vancouver',4::smallint) where id='af520000-0000-4000-8000-000000000001'),null::text,'guest room titles remain redacted');
select is((select room_preview->>'memberCount' from public.get_public_popular_feed_page('vancouver',4::smallint) where id='af520000-0000-4000-8000-000000000001'),'2','guest discovery retains safe room counts');
select * from finish();
rollback;
