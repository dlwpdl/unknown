begin;

select plan(4);

select has_function('public', 'reserve_ai_draft', array[]::text[], 'AI draft quota is server controlled');

insert into auth.users (id, email, raw_app_meta_data)
values ('55555555-5555-5555-5555-555555555555', 'ai-draft@example.com', '{}');

select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}',
  true
);
set local role authenticated;

select results_eq(
  $$select public.reserve_ai_draft()$$,
  array[1::smallint],
  'the first daily draft is reserved'
);
select results_eq(
  $$select public.reserve_ai_draft() from generate_series(2, 5)$$,
  array[2::smallint, 3::smallint, 4::smallint, 5::smallint],
  'five daily drafts are allowed'
);
select throws_ok(
  $$select public.reserve_ai_draft()$$,
  'P0001',
  'AI_DRAFT_LIMIT_REACHED',
  'the sixth daily draft is rejected'
);

select * from finish();
rollback;
