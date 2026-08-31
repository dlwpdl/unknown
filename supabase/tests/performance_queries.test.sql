begin;

select plan(10);

select has_function('public', 'get_public_feed_page', array['text', 'smallint', 'text', 'timestamp with time zone', 'uuid', 'integer'], 'feed cursor RPC exists');
select has_function('public', 'get_public_comments_page', array['uuid', 'timestamp with time zone', 'uuid', 'integer'], 'comment cursor RPC exists');
select has_function('public', 'get_saved_posts', array['timestamp with time zone', 'uuid', 'integer'], 'saved posts use a direct cursor query');
select has_function('public', 'get_conversation_previews', array['integer', 'timestamp with time zone', 'uuid'], 'conversation previews use one server query');

insert into auth.users (id, email, raw_app_meta_data)
values ('81111111-1111-1111-1111-111111111111', 'performance@example.com', '{}');
insert into public.profiles (id, nickname, city_id, daily_post_limit)
values ('81111111-1111-1111-1111-111111111111', '성능테스트', 'vancouver', 5);

select set_config('request.jwt.claims', '{"sub":"81111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select results_eq(
  $$select count(*)::integer from public.get_public_feed_page('vancouver', null, null, null, null, 5)$$,
  array[5],
  'feed page respects the requested limit'
);

select ok(
  exists (select 1 from public.get_public_feed_page('vancouver', null, '코퀴틀람', null, null, 30)),
  'feed search includes author neighborhood'
);
select is_empty(
  $$select id from public.get_public_feed_page('vancouver', null, '검색결과가절대없는문구', null, null, 5)$$,
  'feed search is applied by the server'
);
select results_eq(
  $$select count(*)::integer from public.get_public_comments_page('20000000-0000-0000-0000-000000000001', null, null, 1)$$,
  array[1],
  'comment page does not load the entire thread'
);

insert into public.post_reactions (post_id, user_id, kind)
values ('20000000-0000-0000-0000-000000000001', '81111111-1111-1111-1111-111111111111', 'save');
select results_eq(
  $$select id from public.get_saved_posts(null, null, 10)$$,
  array['20000000-0000-0000-0000-000000000001'::uuid],
  'saved posts are fetched directly without depending on the feed page'
);

select results_eq(
  $$select count(*)::integer from public.get_conversation_previews(20, null, null)$$,
  array[0],
  'conversation preview query handles an empty list'
);

select * from finish();
rollback;
