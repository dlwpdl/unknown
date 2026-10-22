-- Keep notifications generic; derive previews only in the existing worker's send claim.
alter table public.notification_preferences add column if not exists message_preview boolean not null default false;

-- Preserve all current preference fields, validation, and recommendation claim guards.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.get_notification_preferences()'::regprocedure);
  if position('"message_preview":false' in definition)=0 then
    anchor:='"push_enabled":false';
    if position(anchor in definition)=0 then raise exception 'NOTIFICATION_DEFAULTS_CHANGED'; end if;
    execute replace(definition,anchor,anchor||',"message_preview":false');
  end if;
  definition:=pg_get_functiondef('public.update_notification_preferences(jsonb)'::regprocedure);
  if position('''message_preview''' in definition)=0 then
    anchor:='''push_enabled'') then';
    if position(anchor in definition)=0 then raise exception 'NOTIFICATION_ALLOWLIST_CHANGED'; end if;
    definition:=replace(definition,anchor,'''push_enabled'',''message_preview'') then');
    anchor:='push_enabled = coalesce((p_preferences->>''push_enabled'')::boolean, p.push_enabled),';
    if position(anchor in definition)=0 then raise exception 'NOTIFICATION_UPDATE_CHANGED'; end if;
    execute replace(definition,anchor,anchor||E'\n    message_preview = coalesce((p_preferences->>''message_preview'')::boolean, p.message_preview),');
  end if;

  definition:=pg_get_functiondef('private.notify_message()'::regprocedure);
  anchor:='nickname||''님이 메시지를 보냈어요.''';
  if position(anchor in definition)=0 then raise exception 'MESSAGE_NOTIFICATION_CHANGED'; end if;
  definition:=replace(definition,anchor,'''메시지가 도착했습니다''');
  definition:=replace(definition,'; nickname text;',';');
  execute replace(definition,'  select p.nickname::text into nickname from public.profiles p where p.id=new.sender_id;'||E'\n','');

  -- Hidden evidence stays stored for safety review, but cannot reach an OS alert.
  definition:=pg_get_functiondef('private.push_notification_eligible(uuid,uuid)'::regprocedure);
  anchor:='and n.read_at is null';
  if position(anchor in definition)=0 then raise exception 'PUSH_ELIGIBILITY_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$guard$
      and (n.category <> 'messages' or (n.kind='message' and n.target_type='message' and exists (
        select 1 from public.messages m where m.id=n.target_id and m.sender_id=n.actor_id and m.hidden_at is null
      )))$guard$);

  definition:=pg_get_functiondef('public.claim_push_notifications(text,integer)'::regprocedure);
  anchor:=$claim$d.user_id, n.id, n.category, n.body, n.route, item.ticket_id
      from private.push_devices d join public.notifications n on n.id = item.notification_id where d.id = item.device_id;$claim$;
  if position(anchor in definition)=0 then raise exception 'PUSH_CLAIM_CHANGED'; end if;
  execute replace(definition,anchor,$payload$d.user_id, n.id, n.category,
      case when n.category='messages' then
        case when p_phase='send' and coalesce(prefs.message_preview,false) and m.id is not null then
          sender.nickname::text||': '||case m.kind
            when 'image' then '사진을 보냈습니다'
            when 'location' then '위치를 보냈습니다'
            else left(trim(regexp_replace(m.body,'[[:space:][:cntrl:]]+',' ','g')),100)
              ||case when char_length(trim(regexp_replace(m.body,'[[:space:][:cntrl:]]+',' ','g')))>100 then '…' else '' end
          end
        else '메시지가 도착했습니다' end
      else n.body end,
      case when n.category='messages' then '/chat?conversationId='||m.conversation_id::text else n.route end,
      item.ticket_id
      from private.push_devices d join public.notifications n on n.id=item.notification_id
      left join public.notification_preferences prefs on prefs.user_id=d.user_id
      left join public.messages m on n.category='messages' and n.target_type='message' and m.id=n.target_id
        and m.sender_id=n.actor_id and m.hidden_at is null
        and private.can_read_message(m.conversation_id,n.user_id,m.sender_id,m.created_at)
      left join public.profiles sender on sender.id=m.sender_id
      where d.id=item.device_id and (p_phase<>'send' or private.push_notification_eligible(d.id,n.id));$payload$);
end;
$$;

revoke all on function private.notify_message(),private.push_notification_eligible(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_push_notifications(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_push_notifications(text,integer) to service_role;
revoke all on function public.get_notification_preferences(),public.update_notification_preferences(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_notification_preferences(),public.update_notification_preferences(jsonb) to authenticated;
notify pgrst, 'reload schema';
