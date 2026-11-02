-- Security audit 2026-11-02 (db-comment-unhide): authenticated members may update comments.deleted_at, which is also how
-- report moderation and suspension hide comments. Like private.guard_post_status_change for posts, only an admin may clear
-- or move deleted_at once it is set. Own deletes (null -> time) still work; the app has no "restore my comment" action.
create or replace function private.guard_comment_restore() returns trigger
language plpgsql set search_path='' as $$
begin
  -- Server RPCs run as the function owner, so only direct app writes are limited.
  if current_user <> 'authenticated' or old.deleted_at is null or new.deleted_at is not distinct from old.deleted_at
    or private.is_admin() then return new; end if;
  raise exception 'COMMENT_RESTORE_NOT_ALLOWED';
end $$;
alter function private.guard_comment_restore() owner to postgres;
revoke all on function private.guard_comment_restore() from public,anon,authenticated,service_role;
drop trigger if exists comments_guard_restore on public.comments;
create trigger comments_guard_restore before update of deleted_at on public.comments
  for each row execute function private.guard_comment_restore();
