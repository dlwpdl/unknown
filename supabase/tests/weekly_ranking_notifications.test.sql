begin;
select plan(6);
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
select * from finish();
rollback;
