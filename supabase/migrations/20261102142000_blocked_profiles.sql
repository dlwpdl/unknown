-- Security audit 2026-11-02 (db-block-profile): blocking hid each other's posts, comments and public profile page
-- (private.is_blocked_between, both directions), but a direct profiles read or avatar download still worked.
-- Same two-way rule here; own profile and admins are unchanged. App embeds of a blocked profile come back null, which every
-- direct read already handles (chat sender falls back to the conversation name, notification actors drop the avatar).
drop policy if exists "blocked members cannot read each other's profiles" on public.profiles;
create policy "blocked members cannot read each other's profiles" on public.profiles as restrictive for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()) or not private.is_blocked_between((select auth.uid()), id));

-- Avatars live under '<user id>/...' (enforced by the upload policy); other path shapes keep their current access.
create or replace function private.can_read_avatar(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select case when (storage.foldername(p_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then not private.is_blocked_between(auth.uid(), (storage.foldername(p_name))[1]::uuid) or private.is_admin()
    else true end;
$$;
alter function private.can_read_avatar(text) owner to postgres;
revoke all on function private.can_read_avatar(text) from public,anon,authenticated,service_role;
grant execute on function private.can_read_avatar(text) to authenticated;
drop policy if exists "blocked members cannot read each other's avatars" on storage.objects;
create policy "blocked members cannot read each other's avatars" on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'avatars' or private.can_read_avatar(name));
