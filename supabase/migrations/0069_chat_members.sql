-- Participant-facing roster. Admin evidence access stays on existing audited admin RPCs.
create or replace function public.get_conversation_members(p_conversation_id uuid)
returns table(id uuid,nickname text,avatar_path text,is_host boolean)
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if not private.can_read_conversation(p_conversation_id,u) then
    raise exception 'CONVERSATION_ACCESS_DENIED';
  end if;
  return query
  select p.id,p.nickname::text,p.avatar_path,p.id=post.author_id
  from public.conversations c
  join public.posts post on post.id=c.group_post_id
  join lateral (
    select post.author_id as id
    union
    select r.requester_id from public.meetup_requests r where r.post_id=post.id and r.status='approved'
  ) member on true
  join public.profiles p on p.id=member.id
  where c.id=p_conversation_id and c.kind='group' and c.status in ('active','ended')
    and not private.is_blocked_between(u,p.id)
  order by (p.id=post.author_id) desc,p.nickname,p.id;
end;
$$;
revoke all on function public.get_conversation_members(uuid) from public,anon;
grant execute on function public.get_conversation_members(uuid) to authenticated;
