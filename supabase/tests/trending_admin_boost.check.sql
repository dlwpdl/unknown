update private.trending_config set quiet_start_hour=0, quiet_end_hour=0, min_score=10 where id=true;
insert into auth.users(id,email) values
  ('4c000000-0000-0000-0000-000000000001','ta-author@example.test'),
  ('4c000000-0000-0000-0000-000000000002','ta-reader@example.test'),
  ('4c000000-0000-0000-0000-000000000009','ta-admin@example.test');
update auth.users set raw_app_meta_data=jsonb_build_object('role','admin') where id='4c000000-0000-0000-0000-000000000009';
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
  ('4c000000-0000-0000-0000-000000000001','작성자','vancouver',now(),now(),now(),'test'),
  ('4c000000-0000-0000-0000-000000000002','독자','vancouver',now(),now(),now(),'test'),
  ('4c000000-0000-0000-0000-000000000009','관리자','toronto',now(),now(),now(),'test');
select set_config('request.jwt.claims','{"sub":"4c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.create_post('vancouver',(select id from public.tags where slug='life'),'오래된 글','본문','{}','{}');
reset role;
select set_config('test.post_id',(select id::text from public.posts where title='오래된 글'),true);
update public.posts set created_at=now()-interval '90 days', sort_at=now()-interval '90 days' where id<>current_setting('test.post_id')::uuid;

-- 이 글도 오래되게 만들어 후보에서 빠지는 것부터 확인한다
update public.posts set created_at=now()-interval '10 days', sort_at=now()-interval '10 days'
  where id=current_setting('test.post_id')::uuid;
do $$ begin
  assert (select count(*) from private.trending_candidates('vancouver',5))=0,'an old post is not a candidate';
end $$;

-- 어드민이 조회수를 올리고 맨 위로 보내면 다시 후보가 된다
select set_config('request.jwt.claims','{"sub":"4c000000-0000-0000-0000-000000000009","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select public.set_admin_post_fields(current_setting('test.post_id')::uuid,
  jsonb_build_object('view_count',500,'sort_at',now()::text));
reset role;
do $$ begin
  assert (select count(*) from private.trending_candidates('vancouver',5))=1,'an admin boost makes it a candidate again';
  assert (select score from private.trending_candidates('vancouver',1))>10,'the boosted score clears the floor';
end $$;

-- 한 번 나간 뒤에도, 어드민이 조회수를 다시 바꾸면 후보로 돌아온다
do $$ begin
  assert private.send_trending_notifications()=1,'it is announced';
  assert (select count(*) from private.trending_candidates('vancouver',5))=0,'an announced post leaves the candidates';
end $$;
select set_config('request.jwt.claims','{"sub":"4c000000-0000-0000-0000-000000000009","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select public.set_admin_post_fields(current_setting('test.post_id')::uuid,'{"view_count":900}'::jsonb);
reset role;
do $$ begin
  assert (select count(*) from private.trending_candidates('vancouver',5))=1,'changing the view count returns it to the candidates';
end $$;

-- 해시태그만 고치면 다시 보내지 않는다
delete from private.trending_sent;
insert into private.trending_sent(post_id,city_id,score) values (current_setting('test.post_id')::uuid,'vancouver',99);
select set_config('request.jwt.claims','{"sub":"4c000000-0000-0000-0000-000000000009","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select public.set_admin_post_fields(current_setting('test.post_id')::uuid,'{"hashtags":["정리"]}'::jsonb);
reset role;
do $$ begin
  assert (select count(*) from private.trending_sent)=1,'a hashtag-only edit does not re-open the post';
end $$;

select 'ALL ADMIN TRENDING CHECKS PASSED' as result;
