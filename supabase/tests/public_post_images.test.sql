begin;
select plan(5);

-- Storage metadata is enough to exercise RLS; the transaction leaves no objects behind.
insert into storage.objects (bucket_id, name) values
  ('post-images', '10000000-0000-0000-0000-000000000021/vancouver-coal-harbour.jpg'),
  ('post-images', '10000000-0000-0000-0000-000000000021/unpublished-photo-test.jpg'),
  ('avatars', '10000000-0000-0000-0000-000000000021/vancouver-coal-harbour.jpg')
on conflict (bucket_id, name) do nothing;

set local role anon;
select results_eq(
  $$select count(*)::integer from storage.objects where bucket_id = 'post-images'
    and name = '10000000-0000-0000-0000-000000000021/vancouver-coal-harbour.jpg'$$,
  array[1], 'guests can read a published post photo'
);
select results_eq(
  $$select count(*)::integer from storage.objects where bucket_id = 'post-images'
    and name = '10000000-0000-0000-0000-000000000021/unpublished-photo-test.jpg'$$,
  array[0], 'guests cannot read an unattached upload'
);
select results_eq(
  $$select count(*)::integer from storage.objects where bucket_id = 'avatars'
    and name = '10000000-0000-0000-0000-000000000021/vancouver-coal-harbour.jpg'$$,
  array[0], 'guest post-photo access does not expose avatars'
);

reset role;
update public.posts set status = 'removed' where id = '20000000-0000-0000-0000-000000000054';
set local role anon;
select results_eq(
  $$select count(*)::integer from storage.objects where bucket_id = 'post-images'
    and name = '10000000-0000-0000-0000-000000000021/vancouver-coal-harbour.jpg'$$,
  array[0], 'removed posts cannot issue new guest photo access'
);

reset role;
update public.posts set status = 'published' where id = '20000000-0000-0000-0000-000000000054';
update public.profiles set account_status = 'suspended' where id = '10000000-0000-0000-0000-000000000021';
set local role anon;
select results_eq(
  $$select count(*)::integer from storage.objects where bucket_id = 'post-images'
    and name = '10000000-0000-0000-0000-000000000021/vancouver-coal-harbour.jpg'$$,
  array[0], 'inactive authors cannot issue new guest photo access'
);

reset role;
select * from finish();
rollback;
