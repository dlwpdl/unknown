-- 관리자 콘솔에서 메시지 하트를 볼 수 있는 감사 경로.
-- 테이블 직접 접근은 계속 막고, 관리자 확인 + 접근 기록을 남기는 RPC 로만 연다.
create or replace function public.get_admin_message_reactions(p_user_id uuid default null, p_limit integer default 100)
returns table (
  message_id uuid,
  conversation_id uuid,
  reacted_at timestamptz,
  reactor_id uuid,
  reactor_nickname text,
  sender_id uuid,
  sender_nickname text,
  message_body text
)
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'INVALID_ADMIN_LIMIT'; end if;
  perform public.log_admin_access('user_detail', p_user_id);
  return query
    select r.message_id, m.conversation_id, r.created_at, r.user_id,
      reactor.nickname, m.sender_id, sender.nickname, left(m.body, 200)
    from private.message_reactions r
    join public.messages m on m.id = r.message_id
    join public.profiles reactor on reactor.id = r.user_id
    join public.profiles sender on sender.id = m.sender_id
    where p_user_id is null or r.user_id = p_user_id or m.sender_id = p_user_id
    order by r.created_at desc
    limit p_limit;
end;
$$;
revoke all on function public.get_admin_message_reactions(uuid,integer) from public,anon;
grant execute on function public.get_admin_message_reactions(uuid,integer) to authenticated;

notify pgrst, 'reload schema';
