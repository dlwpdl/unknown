-- A held listing is review evidence: its author cannot edit it until an admin decides (security review on PR #170).
-- Without this the author could PATCH the title, body, photos or listing card of a room that three people reported,
-- the admin queue (get_admin_held_listings) would show the clean version, and a restore would dismiss every report.
-- SECURITY INVOKER like private.guard_post_status_change (0053): only edits that arrive as the app user are checked.
-- The hold trigger, resolve_held_listing and account deletion run as the function owner or service role and pass.
-- The trigger name sorts after posts_guard_status_change, so a republish attempt keeps its POST_RESTORE_NOT_ALLOWED error.
create function private.guard_held_post_edit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and old.held_at is not null and not private.is_admin() then
    raise exception 'POST_HELD';
  end if;
  return new;
end $$;
revoke all on function private.guard_held_post_edit() from public, anon;

create trigger posts_held_edit_guard before update on public.posts
  for each row execute function private.guard_held_post_edit();
