begin;

select plan(8);

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
  $$select count(*)::integer from public.get_public_feed('vancouver', 100) where id between '20000000-0000-0000-0000-000000000001' and '20000000-0000-0000-0000-000000000035'$$,
  array[20],
  'the Vancouver seed feed is visible'
);
select ok(not exists(select 1 from public.get_public_feed(null,100) where body<>''),
  'anonymous feed discovery contains metadata without post bodies');
select throws_ok($$select * from public.get_public_comments(array(select id from public.get_public_feed(null,100)))$$,
  '42501',null,'anonymous discovery does not grant comment content');

reset role;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select results_eq(
  $$select count(*)::integer from public.get_public_comments(
      array(select id from public.get_public_feed(null, 100))
    )$$,
  array[62],
  'signed in readers retain comments through the existing function'
);

reset role;
select * from finish();
rollback;
