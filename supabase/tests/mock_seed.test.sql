begin;

select plan(14);

select has_column('public', 'posts', 'hashtags', 'posts preserve mock hashtags');
select has_column('public', 'posts', 'room_preview', 'posts preserve mock room previews');
select has_column('public', 'profiles', 'verification_level', 'profiles preserve verification level');
select has_column('public', 'tags', 'kind', 'tags preserve post or meetup kind');

select results_eq(
  $$select count(*)::integer from public.cities$$,
  array[6],
  'six mock cities are seeded'
);
select results_eq(
  $$select count(*)::integer from public.tags$$,
  array[9],
  'nine mock tags are seeded'
);
select results_eq(
  $$select count(*)::integer from public.profiles$$,
  array[37],
  'thirty-seven mock profiles are seeded'
);
select results_eq(
  $$select count(*)::integer from public.posts$$,
  array[35],
  'thirty-five mock posts are seeded'
);
select results_eq(
  $$select count(*)::integer from public.comments$$,
  array[62],
  'sixty-two mock comments are seeded'
);
select results_eq(
  $$select count(*)::integer from public.posts where room_preview is not null$$,
  array[6],
  'six meetup room previews are preserved'
);
select results_eq(
  $$select coalesce(sum(comment_count), 0)::integer from public.posts$$,
  array[62],
  'post comment counters match seeded comments'
);
select results_eq(
  $$select count(*)::integer
    from auth.users
    where raw_user_meta_data ->> 'seed' = 'true'
      and raw_app_meta_data ->> 'role' = 'admin'$$,
  array[0],
  'seed users never receive admin role'
);
select results_eq(
  $$select count(*)::integer
    from public.profiles
    where id between '10000000-0000-0000-0000-000000000001'::uuid
      and '10000000-0000-0000-0000-000000000037'::uuid
      and verification_level = 3$$,
  array[0],
  'seed profiles never claim identity and face verification'
);
select ok(
  not has_column_privilege(
    'authenticated',
    'public.profiles',
    'verification_level',
    'insert'
  ),
  'clients cannot self-assign verification level'
);

select * from finish();
rollback;
