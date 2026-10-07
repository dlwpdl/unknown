do $$ begin
  assert (select count(*) from public.app_release_policy) = 2, 'both app platforms have a policy';
  assert (select minimum_build from public.app_release_policy where platform = 'ios') = 50, 'iOS starts at build 50';
  assert has_table_privilege('anon', 'public.app_release_policy', 'select'), 'guests can check the policy';
  assert has_table_privilege('authenticated', 'public.app_release_policy', 'select'), 'members can check the policy';
  assert not has_table_privilege('anon', 'public.app_release_policy', 'update'), 'guests cannot change the policy';
  assert not has_table_privilege('authenticated', 'public.app_release_policy', 'update'), 'members cannot change the policy';
end $$;

set local role anon;
select minimum_build from public.app_release_policy where platform = 'ios';
reset role;
