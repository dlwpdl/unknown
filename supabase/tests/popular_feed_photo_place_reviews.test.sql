begin;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values
 ('b0410000-0000-4000-8000-000000000001','photo-review-viewer@test.gling.invalid','{"nickname":"사진 후기 보는 이웃"}',now()),
 ('b0410000-0000-4000-8000-000000000002','photo-review-author@test.gling.invalid','{"nickname":"사진 후기 쓴 이웃"}',now());
insert into public.profiles(id,nickname,city_id) select id,raw_user_meta_data->>'nickname','vancouver' from auth.users
 where id in ('b0410000-0000-4000-8000-000000000001','b0410000-0000-4000-8000-000000000002')
on conflict(id) do update set nickname=excluded.nickname,city_id=excluded.city_id;

-- Same 5 likes everywhere, so only the photo + place-review pair can change the score.
insert into public.posts(id,author_id,city_id,tag_id,title,body,status,created_at,like_count,image_paths,place_review_osm_id,place_review_score) values
 ('b0420000-0000-4000-8000-000000000001','b0410000-0000-4000-8000-000000000002','vancouver',4,'사진 붙은 장소 후기',
  E'글링 평점: 8.0/10\n\n바 자리가 넉넉했어요\n\n장소 후기: https://www.openstreetmap.org/node/101','published',now()-interval '3 hours',5,array['review.jpg'],'osm:node:101',8),
 ('b0420000-0000-4000-8000-000000000002','b0410000-0000-4000-8000-000000000002','vancouver',4,'예전 방식 사진 후기',
  E'사진이랑 같이 남겨요\n\n장소 후기: https://www.openstreetmap.org/way/202\n\nGoogle 지도: https://www.google.com/maps/search/?api=1&query=49.28%2C-123.12\n위치: 개스타운','published',now()-interval '4 hours',5,array['legacy.jpg'],null,null),
 ('b0420000-0000-4000-8000-000000000003','b0410000-0000-4000-8000-000000000002','vancouver',4,'사진 없는 장소 후기',
  E'글링 평점: 7.0/10\n\n글로만 남겨요\n\n장소 후기: https://www.openstreetmap.org/node/303','published',now()-interval '5 hours',5,'{}','osm:node:303',7),
 ('b0420000-0000-4000-8000-000000000004','b0410000-0000-4000-8000-000000000002','vancouver',4,'사진만 있는 글',
  '오늘 점심','published',now()-interval '1 hour',5,array['lunch.jpg'],null,null),
 ('b0420000-0000-4000-8000-000000000005','b0410000-0000-4000-8000-000000000002','vancouver',4,'줄 중간에 붙여 넣은 주소',
  '여기 좋아요 장소 후기: https://www.openstreetmap.org/node/505','published',now()-interval '2 hours',5,array['inline.jpg'],null,null),
 ('b0420000-0000-4000-8000-000000000006','b0410000-0000-4000-8000-000000000002','vancouver',4,'반응 많은 글',
  '본문','published',now()-interval '6 hours',20,'{}',null,null),
 ('b0420000-0000-4000-8000-000000000007','b0410000-0000-4000-8000-000000000002','vancouver',4,'반응 조금 더 많은 글',
  '본문','published',now()-interval '30 minutes',12,'{}',null,null);
update public.posts set sort_at=created_at where id::text like 'b0420000-%';

select set_config('request.jwt.claims','{"sub":"b0410000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

create temp table photo_review_page as select * from public.get_public_popular_feed_page('vancouver',4::smallint,null,null,null,null,50)
 where id::text like 'b0420000-%';
select is((select popularity_score from photo_review_page where id='b0420000-0000-4000-8000-000000000001'),15::bigint,'a place review with a photo gets +10');
select is((select popularity_score from photo_review_page where id='b0420000-0000-4000-8000-000000000002'),15::bigint,'an older body-only place review with a photo gets the same +10');
select is((select popularity_score from photo_review_page where id='b0420000-0000-4000-8000-000000000003'),5::bigint,'a place review without a photo keeps its score');
select is((select popularity_score from photo_review_page where id='b0420000-0000-4000-8000-000000000004'),5::bigint,'a photo post that is not a place review keeps its score');
select is((select popularity_score from photo_review_page where id='b0420000-0000-4000-8000-000000000005'),5::bigint,'a pasted address mid-line is not a place review');
select results_eq($$select id::text from photo_review_page order by popularity_score desc,created_at desc,id desc$$,
 array['b0420000-0000-4000-8000-000000000006','b0420000-0000-4000-8000-000000000001','b0420000-0000-4000-8000-000000000002',
       'b0420000-0000-4000-8000-000000000007','b0420000-0000-4000-8000-000000000004','b0420000-0000-4000-8000-000000000005','b0420000-0000-4000-8000-000000000003'],
 'the lift passes a slightly busier post (12) but not a clearly busier one (20)');
select results_eq($$select id::text from public.get_public_popular_feed_page('vancouver',4::smallint,15,now()-interval '3 hours','b0420000-0000-4000-8000-000000000001',now(),50)
   where id::text like 'b0420000-%' order by popularity_score desc,created_at desc,id desc$$,
 array['b0420000-0000-4000-8000-000000000002','b0420000-0000-4000-8000-000000000007','b0420000-0000-4000-8000-000000000004','b0420000-0000-4000-8000-000000000005','b0420000-0000-4000-8000-000000000003'],
 'the next page after a lifted review continues from its lifted score without repeats');
select results_eq($$select id::text from public.get_public_feed_page_v2('vancouver',4::smallint,null,null,null,50) where id::text like 'b0420000-%'$$,
 array['b0420000-0000-4000-8000-000000000007','b0420000-0000-4000-8000-000000000004','b0420000-0000-4000-8000-000000000005','b0420000-0000-4000-8000-000000000001',
       'b0420000-0000-4000-8000-000000000002','b0420000-0000-4000-8000-000000000003','b0420000-0000-4000-8000-000000000006'],
 'latest order stays newest first');

select * from finish();
rollback;
