begin;

select plan(18);

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
  array[54],
  'fifty-four mock posts are seeded'
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

select results_eq(
  $$select count(*)::integer from (select city_id, tag_id from public.posts where id between '20000000-0000-0000-0000-000000000036' and '20000000-0000-0000-0000-000000000053' group by city_id, tag_id) as launch_examples$$,
  array[18], 'launch examples cover nine categories in each launch city'
);
select results_eq(
  $$select count(*)::integer from public.posts p join public.profiles author on author.id = p.author_id where p.id between '20000000-0000-0000-0000-000000000036' and '20000000-0000-0000-0000-000000000053' and (p.title like '[예시] %' or p.body like '%목업 게시글%' or p.body like '%예시%' or author.nickname::text like '%·예시')$$,
  array[0], 'seed display copy has no example labels'
);
select results_eq(
  $$select coalesce(sum(like_count + save_count + comment_count + view_count + share_count), 0)::integer from public.posts where id between '20000000-0000-0000-0000-000000000036' and '20000000-0000-0000-0000-000000000053'$$,
  array[0], 'new examples do not fabricate engagement'
);

select results_eq(
  $$select count(*)::integer from public.posts p
    join public.safety_review_queue q on q.target_type = 'post' and q.target_id = p.id
    where p.id = '20000000-0000-0000-0000-000000000054'
      and p.author_id = '10000000-0000-0000-0000-000000000021'
      and p.city_id = 'vancouver' and p.status = 'published'
      and p.body like '%Vlad D%Unsplash%'
      and p.image_paths = array['10000000-0000-0000-0000-000000000021/vancouver-coal-harbour.jpg']$$,
  array[1], 'real Vancouver photo has credit, the managed author and a safety queue entry'
);

select * from finish();
rollback;
