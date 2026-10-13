-- Minimum surrounding context helps distinguish coercion/harassment from a consensual conversation.
create function public.get_message_safety_context(p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare target public.messages; context text;
begin
  if auth.role()<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  select * into target from public.messages where id=p_target_id;
  if target.id is null then return null; end if;
  select string_agg(case when m.sender_id=target.sender_id then '작성자: ' else '상대: ' end||
    case when p.ai_safety_consent_at is not null then left(m.body,1500) else '[안전 분석 동의 미확인 · 원문 제외]' end,E'\n' order by m.created_at,m.id)
    into context from(select id,sender_id,body,created_at from public.messages
      where conversation_id=target.conversation_id and (created_at,id)<(target.created_at,target.id)
      order by created_at desc,id desc limit 6) m join public.profiles p on p.id=m.sender_id;
  return jsonb_build_object('authorId',target.sender_id,'text',concat_ws(E'\n','분석할 현재 메시지:',target.body,'앞선 대화 (판단에 필요한 최소 맥락):',context));
end;
$$;
revoke all on function public.get_message_safety_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_message_safety_context(uuid) to service_role;
alter function public.get_message_safety_context(uuid) owner to postgres;
notify pgrst,'reload schema';
