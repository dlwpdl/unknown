begin;
select plan(3);

insert into auth.users (id, email) values
('9bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'views-one@gling.invalid'),
('9bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'views-two@gling.invalid');

insert into public.profiles (id, nickname, city_id) values
('9bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '조회검사하나', 'vancouver'),
('9bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '조회검사둘', 'vancouver');

create temporary table viewed_post as
select id, view_count from public.posts where status = 'published' limit 1;

select set_config('request.jwt.claim.sub', '9bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', true);
select public.record_post_view(id) from viewed_post;
select public.record_post_view(id) from viewed_post;
select is((select p.view_count - v.view_count from public.posts p join viewed_post v using (id)), 1, 'reopening a post counts the same account only once');
select is((select count(*) from public.post_views where post_id = (select id from viewed_post) and user_id = auth.uid()), 1::bigint, 'one row per post and account');

select set_config('request.jwt.claim.sub', '9bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', true);
select public.record_post_view(id) from viewed_post;
select is((select p.view_count - v.view_count from public.posts p join viewed_post v using (id)), 2, 'another account counts once independently');

select * from finish();
rollback;
