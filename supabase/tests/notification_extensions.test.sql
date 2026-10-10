begin;
select no_plan();
select has_column('public','notification_preferences','merchant_updates','business news has a global preference');
select has_column('public','notification_preferences','merchant_operations','business problems have a global preference');
select has_column('public','notification_preferences','account_security','account security has a global preference');
select has_column('private','saved_merchants','notifications_enabled','each saved business requires opt-in');
insert into auth.users(id,email) values ('15000000-0000-4000-8000-000000000001','notification-extensions@example.test');
insert into public.profiles(id,nickname,city_id) values ('15000000-0000-4000-8000-000000000001','알림확장검사','vancouver');
select set_config('request.jwt.claims','{"sub":"15000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_notification_preferences()->'merchant_updates','true'::jsonb,'business news global default is on');
select is(public.get_notification_preferences()->'merchant_operations','true'::jsonb,'business problems default is on');
select is(public.get_notification_preferences()->'account_security','true'::jsonb,'account security default is on');
select lives_ok($$select public.update_notification_preferences('{"merchant_updates":false,"merchant_operations":false,"account_security":false}')$$,'all new categories accept actual user choices');
select is(public.get_notification_preferences()->'account_security','false'::jsonb,'security OFF is saved');
select is(public.get_notification_preferences()->'city_food','true'::jsonb,'new flags do not change city preferences');
select throws_ok($$select public.update_notification_preferences('{"merchant_updates":"false"}')$$,'P0001','INVALID_PREFERENCES','string boolean rejected');
select throws_ok($$select public.update_notification_preferences('{"account_security":null}')$$,'P0001','INVALID_PREFERENCES','null boolean rejected');
select throws_ok($$update public.notification_preferences set account_security=true$$,'42501',null,'direct writes remain denied');
reset role;
select is(private.notification_category('saved_merchant_post','post'),'merchant_updates','saved posts use their category');
select is(private.notification_category('merchant_review_received','merchant_review'),'merchant_reviews','incoming reviews reuse review preference');
select is(private.notification_category('merchant_operation','merchant_operation'),'merchant_operations','business errors use their category');
select is(private.notification_category('account_security','account_security'),'account_security','security uses its category');
select ok(not private.can_receive_notification('15000000-0000-4000-8000-000000000001','account_security',null),'latest security OFF blocks event creation/read');
insert into auth.users(id,email) values ('15000000-0000-4000-8000-000000000002','notification-budget@example.test');
insert into public.profiles(id,nickname,city_id) values ('15000000-0000-4000-8000-000000000002','알림공용한도검사','vancouver');
insert into public.posts(id,author_id,city_id,tag_id,title,body)
select ('15010000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'15000000-0000-4000-8000-000000000001','vancouver',
 t.id,'알림 한도 검사','검사 본문' from (values(1,'food'),(2,'travel')) v(n,slug) join public.tags t on t.slug=v.slug;
update private.trending_config set enabled=true,quiet_start_hour=0,quiet_end_hour=0 where id;
insert into public.notifications(user_id,kind,target_type,target_id,body)
values ('15000000-0000-4000-8000-000000000002','city_food','post','15010000-0000-4000-8000-000000000001','도시 소식 검사');
-- Recheck in the common insert gate even when another producer already chose its candidate.
insert into public.notifications(user_id,kind,target_type,target_id,body)
values ('15000000-0000-4000-8000-000000000002','city_places','post','15010000-0000-4000-8000-000000000002','다른 생산자 소식 검사');
select is((select count(*)::int from public.notifications where user_id='15000000-0000-4000-8000-000000000002'),1,'common insert gate rechecks shared spacing after another producer inserts');
update public.notifications set created_at=now()+interval '1 second' where user_id='15000000-0000-4000-8000-000000000002';
insert into public.notifications(user_id,kind,target_type,target_id,body)
values ('15000000-0000-4000-8000-000000000002','city_places','post','15010000-0000-4000-8000-000000000002','이전 트랜잭션의 늦은 삽입 검사');
select is((select count(*)::int from public.notifications where user_id='15000000-0000-4000-8000-000000000002'),1,'an older transaction cannot ignore a newer already inserted notice');
select finish();
rollback;
