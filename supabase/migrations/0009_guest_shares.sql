create or replace function public.record_post_share(p_post_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  next_count integer;
begin
  update public.posts
  set share_count = share_count + 1
  where id = p_post_id
    and status = 'published'
    and (
      current_user_id is null
      or not private.is_blocked_between(current_user_id, author_id)
    )
  returning share_count into next_count;
  if next_count is null then raise exception 'POST_NOT_FOUND'; end if;
  return next_count;
end;
$$;

revoke execute on function public.record_post_share(uuid) from public, anon, authenticated;
grant execute on function public.record_post_share(uuid) to anon, authenticated;
