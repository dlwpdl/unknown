-- Natural expiry removes the room from the inbox, not from retained evidence.
create or replace function private.expire_chilling_events() returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_relationships();
  update public.posts set room_preview=jsonb_set(room_preview,'{closed}','true')
    where room_preview->>'eventKind'='once' and coalesce(room_preview->>'closed','false')<>'true'
      and (room_preview->>'endsAt')::timestamptz<=now();
  update public.meetup_requests r set status='cancelled',responded_at=now()
    from public.posts p where r.post_id=p.id and r.status='pending'
      and p.room_preview->>'eventKind'='once' and (p.room_preview->>'endsAt')::timestamptz<=now();
end;
$$;

do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.get_conversation_inbox(text,integer,text,timestamptz,uuid,uuid)'::regprocedure);
  anchor:='c.kind,c.status,c.requester_id,c.group_post_id,';
  if strpos(definition,anchor)=0 then raise exception 'inbox status anchor missing'; end if;
  definition:=replace(definition,anchor,'c.kind,case when p.room_preview->>''eventKind''=''once'' and (p.room_preview->>''endsAt'')::timestamptz<=now() then ''ended'' else c.status end status,c.requester_id,c.group_post_id,');
  anchor:='    where (case when p_filter=''requests'' then r.status=''pending'' else r.status in (''active'',''ended'') end)';
  if strpos(definition,anchor)=0 then raise exception 'inbox filter anchor missing'; end if;
  -- Keep the selected deep-link row available as read-only so past messages can be reported.
  execute replace(definition,anchor,anchor||E'\n      and not exists(select 1 from public.posts expired where expired.id=r.group_post_id and expired.room_preview->>''eventKind''=''once'' and (expired.room_preview->>''endsAt'')::timestamptz<=now())');

  definition:=pg_get_functiondef('public.get_conversation_previews(integer,timestamptz,uuid)'::regprocedure);
  anchor:='and (c.kind<>''group'' or private.meetup_is_open(p.status,p.room_preview))';
  if strpos(definition,anchor)=0 then raise exception 'legacy expiry anchor missing'; end if;
  execute replace(definition,anchor,'and not coalesce(p.room_preview->>''eventKind''=''once'' and (p.room_preview->>''endsAt'')::timestamptz<=now(),false)');
end;
$$;
