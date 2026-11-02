-- Security audit 2026-11-02 (db-status-note): profiles grants every column to authenticated, so a member who can read a
-- profile row (any active profile, or a suspended one they share a conversation with) also reads account_status_note.
-- Revoking the column would make the app's own-profile read (src/lib/auth.tsx selects it) and the admin select('*')
-- fail with 42501, so the row is hidden instead: a profile carrying a note is visible only to its owner and admins.
-- The admin console never writes a note when reactivating, so in practice this hides suspended/deleted rows with a
-- moderation note from conversation partners; their chat falls back to the conversation name.
drop policy if exists "account status notes stay private" on public.profiles;
create policy "account status notes stay private" on public.profiles as restrictive for select to authenticated
  using (account_status_note is null or id = (select auth.uid()) or (select private.is_admin()));
