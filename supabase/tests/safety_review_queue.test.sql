begin;

select plan(5);

select has_table('public', 'safety_review_queue', 'safety review queue exists');
select results_eq(
  $$select count(*)::integer from public.safety_review_queue$$,
  $$select (select count(*) from public.posts)::integer + (select count(*) from public.comments)::integer + (select count(*) from public.messages)::integer$$,
  'all existing user content is queued'
);
select ok(
  not has_table_privilege('authenticated', 'public.safety_review_queue', 'insert'),
  'clients cannot enqueue or forge safety reviews'
);

insert into public.comments (id, post_id, author_id, body)
values (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'trigger check'
);

select results_eq(
  $$select count(*)::integer from public.safety_review_queue where target_type = 'comment' and target_id = '40000000-0000-0000-0000-000000000001'$$,
  array[1],
  'new content is queued by trigger'
);
select results_eq(
  $$select count(*)::integer from public.profiles where id between '10000000-0000-0000-0000-000000000001'::uuid and '10000000-0000-0000-0000-000000000017'::uuid and verification_level = 3$$,
  array[0],
  'fictional seed hosts do not claim L3 identity verification'
);

select * from finish();
rollback;
