-- Security audit 2026-11-02 (db-business-comment-author): a comment posted as a business keeps the operator in author_id
-- (own edit/delete RLS) but, like official business posts, no other member may read that personal id.
-- Post detail and threads read comments through security definer RPCs and are unaffected; direct table reads by other
-- members (the replies-to-me inbox, notification snippets) simply no longer return business comments.
drop policy if exists "business comment actors are private" on public.comments;
create policy "business comment actors are private" on public.comments as restrictive for select to authenticated
  using (business_author_id is null or author_id = (select auth.uid()) or (select private.is_admin()));

-- The like check used to look the comment up under the liker's RLS, which now hides business comments.
-- can_view_comment is the definer check the comment lists already use (exists, not deleted, not blocked/reported).
alter policy "users create own comment likes" on public.comment_likes with check (
  user_id = (select auth.uid()) and private.is_active_account((select auth.uid())) and private.can_view_comment(comment_id));

-- The legacy batch endpoint is still granted; give it the same business masking as get_public_comments_page.
create or replace function public.get_public_comments(p_post_ids uuid[])
returns table(id uuid, post_id uuid, author_id uuid, body text, like_count integer, liked_by_me boolean, created_at timestamptz,
  author_nickname text, author_verification_level smallint)
language sql stable security definer set search_path='' as $function$
  select c.id, c.post_id, coalesce(b.id, c.author_id), c.body, c.like_count,
    exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = auth.uid()),
    c.created_at, coalesce(b.name, author.nickname)::text, case when b.id is null then author.verification_level else 0::smallint end
  from public.comments c join public.profiles author on author.id = c.author_id
  left join private.merchants b on b.id = private.public_comment_business_id_for(c.business_author_id, auth.uid())
  where coalesce(cardinality(p_post_ids), 0) between 1 and 100
    and c.post_id = any(p_post_ids) and c.deleted_at is null and private.can_view_comment(c.id)
    and (c.business_author_id is null or b.id is not null)
  order by c.created_at, c.id;
$function$;

-- Comment/reply notifications (inbox, realtime, push) never store the operator behind a business comment.
-- The post branch below is unchanged from 20261018035000_business_public_privacy.sql.
create or replace function private.mask_business_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare item record;
begin
  if new.target_type='comment' then
    if new.actor_id is not null and exists(select 1 from public.comments c
      where c.id=new.target_id and c.business_author_id is not null and c.author_id=new.actor_id) then
      new.actor_id:=null;
    end if;
    return new;
  end if;
  if new.target_type<>'post' then return new; end if;
  select p.author_id,p.title,m.name into item from public.posts p join private.merchants m on m.id=p.business_author_id where p.id=new.target_id;
  if found and (new.actor_id is null or new.actor_id=item.author_id) then
    new.actor_id:=null;
    new.body:=left(item.name||' · '||item.title,300);
  end if;
  return new;
end $$;
alter function private.mask_business_notification() owner to postgres;
revoke all on function private.mask_business_notification() from public,anon,authenticated,service_role;
-- Rows already delivered keep their text; the update only clears the stored operator id (push fires on insert only).
update public.notifications n set actor_id=n.actor_id from public.comments c
  where n.target_type='comment' and c.id=n.target_id and c.business_author_id is not null and n.actor_id=c.author_id;

-- Reports keep the comment author (reported_user_id) and a copy of the comment (evidence) for admins only.
drop policy if exists "business comment report actors are private" on public.reports;
create policy "business comment report actors are private" on public.reports as restrictive for select to authenticated
  using ((select private.is_admin()) or target_type<>'comment' or evidence->>'business_author_id' is null);
notify pgrst,'reload schema';
