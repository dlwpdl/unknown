begin;
select plan(10);
select is((select count(*)::int from information_schema.columns
  where table_schema='public' and table_name='notification_preferences' and column_name='weekly_ranking'),1,
  'weekly ranking has its own preference column');
select is(private.notification_category('weekly_ranking','post'),'weekly_ranking','weekly ranking keeps its own category');
select is(private.notification_category('trending_post','post'),'trending','trending posts keep the trending category');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname='notifications_kind_check')) like '%weekly_ranking%',
  'weekly_ranking is an allowed notification kind');

insert into auth.users(id,email,raw_app_meta_data) values
('66660000-0000-0000-0000-000000000001','weekly-ranking@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
('66660000-0000-0000-0000-000000000001','주간검사','vancouver');
select set_config('request.jwt.claims','{"sub":"66660000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.update_notification_preferences('{"weekly_ranking":false}'::jsonb)->>'weekly_ranking','false','members can turn weekly ranking off');
select is(public.update_notification_preferences('{"trending":false}'::jsonb)->>'trending','false','the trending toggle saves too');
reset role;
delete from public.weekly_rankings;
update public.posts set status='removed';
insert into auth.users(id,email) values('66660000-0000-0000-0000-000000000002','weekly-route-reader@example.test');
insert into public.profiles(id,nickname,city_id) values('66660000-0000-0000-0000-000000000002','주간경로검사','vancouver');
insert into public.posts(id,author_id,city_id,tag_id,title,body)
values('66660000-0000-0000-0000-000000000010','66660000-0000-0000-0000-000000000001','vancouver',
  (select id from public.tags where slug='life'),'이번 주 이야기','주간 인기글 알림 경로를 검사해요.');
insert into public.post_views(post_id,user_id) values('66660000-0000-0000-0000-000000000010','66660000-0000-0000-0000-000000000002');
select lives_ok($$select private.publish_weekly_ranking()$$,'a real ranked post generates its weekly alert');
select is((select route from public.notifications where user_id='66660000-0000-0000-0000-000000000002'
  and kind='weekly_ranking' and target_id='66660000-0000-0000-0000-000000000010'),
  '/post/66660000-0000-0000-0000-000000000010','the alert opens its actual winner in an existing app screen');
select is((select body from public.notifications where user_id='66660000-0000-0000-0000-000000000002'
  and kind='weekly_ranking' and target_id='66660000-0000-0000-0000-000000000010'),
  '이번 주 이야기','weekly ranking sends only the post title without a rank or popularity preamble');
select ok(private.notification_target_visible('66660000-0000-0000-0000-000000000002','post','66660000-0000-0000-0000-000000000010'),
  'the recipient can actually open the ranked target');
select * from finish();
rollback;
