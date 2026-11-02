-- Rollback for 20261102140000..20261102144000 (security audit 2026-11-02): restores the production definitions read on
-- 2026-11-02. scripts/check-security-db-20261102.py applies it and checks the production fingerprints come back.
-- Not reversed: notification rows whose operator id the 140000 backfill cleared (that id is what leaked).
begin;
-- 20261102144000_profile_insert_consent
grant insert (id, nickname, city_id, avatar_path, bio, neighborhood) on public.profiles to authenticated;
drop policy if exists "users create own profile" on public.profiles;
create policy "users create own profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
-- 20261102143000_status_note_privacy
drop policy if exists "account status notes stay private" on public.profiles;
-- 20261102142000_blocked_profiles
drop policy if exists "blocked members cannot read each other's avatars" on storage.objects;
drop function if exists private.can_read_avatar(text);
drop policy if exists "blocked members cannot read each other's profiles" on public.profiles;
-- 20261102141000_comment_restore_guard
drop trigger if exists comments_guard_restore on public.comments;
drop function if exists private.guard_comment_restore();
-- 20261102140000_business_comment_actors
drop policy if exists "business comment report actors are private" on public.reports;
drop policy if exists "business comment actors are private" on public.comments;
alter policy "users create own comment likes" on public.comment_likes with check (
  user_id = (select auth.uid()) and private.is_active_account((select auth.uid()))
  and exists (select 1 from public.comments where comments.id = comment_likes.comment_id and comments.deleted_at is null));
create or replace function public.get_public_comments(p_post_ids uuid[])
 returns table(id uuid, post_id uuid, author_id uuid, body text, like_count integer, liked_by_me boolean, created_at timestamp with time zone, author_nickname text, author_verification_level smallint)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select c.id, c.post_id, c.author_id, c.body, c.like_count,
    exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = auth.uid()),
    c.created_at, author.nickname::text, author.verification_level
  from public.comments c join public.profiles author on author.id = c.author_id
  where coalesce(cardinality(p_post_ids), 0) between 1 and 100
    and c.post_id = any(p_post_ids) and c.deleted_at is null and private.can_view_comment(c.id)
  order by c.created_at, c.id;
$function$;
create or replace function private.mask_business_notification() returns trigger
language plpgsql security definer set search_path='' as $function$
declare item record;
begin
  if new.target_type<>'post' then return new; end if;
  select p.author_id,p.title,m.name into item from public.posts p join private.merchants m on m.id=p.business_author_id where p.id=new.target_id;
  if found and (new.actor_id is null or new.actor_id=item.author_id) then
    new.actor_id:=null;
    new.body:=left(item.name||' · '||item.title,300);
  end if;
  return new;
end $function$;
notify pgrst,'reload schema';
commit;
