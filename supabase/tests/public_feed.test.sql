begin;

select plan(6);

select has_function(
  'public',
  'get_public_feed',
  array['text', 'integer'],
  'public feed is exposed through a narrow function'
);
select has_function(
  'public',
  'get_public_comments',
  array['uuid[]'],
  'public comments are exposed through a narrow function'
);
select ok(
  has_function_privilege('anon', 'public.get_public_feed(text, integer)', 'execute'),
  'anonymous visitors can load the public feed'
);
select ok(
  not has_table_privilege('anon', 'public.posts', 'select'),
  'anonymous visitors still cannot query the posts table directly'
);

set local role anon;

select results_eq(
  $$select count(*)::integer from public.get_public_feed('vancouver', 100)$$,
  array[10],
  'the Vancouver seed feed is visible'
);
select results_eq(
  $$select count(*)::integer from public.get_public_comments(
      array(select id from public.get_public_feed(null, 100))
    )$$,
  array[22],
  'seed comments are visible through the public function'
);

select * from finish();
rollback;
