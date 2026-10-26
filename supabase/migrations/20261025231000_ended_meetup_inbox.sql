-- Ended meetups stay in their members' chat inbox as read-only rooms.
do $$
declare definition text;
  member_anchor text:='where r.requester_id=u and r.status=''approved''';
  status_anchor text:='case when p.room_preview->>''eventKind''=''once'' and (p.room_preview->>''endsAt'')::timestamptz<=now() then ''ended''';
begin
  definition:=pg_get_functiondef('public.get_conversation_inbox(text,integer,text,timestamptz,uuid,uuid)'::regprocedure);
  if strpos(definition,member_anchor)=0 or strpos(definition,status_anchor)=0 then raise exception 'ENDED_INBOX_ANCHOR_CHANGED'; end if;
  -- can_read_conversation still decides visibility; this only adds the candidates.
  definition:=replace(definition,member_anchor,'where r.requester_id=u and (r.status=''approved'' or r.ended_with_meetup)');
  execute replace(definition,status_anchor,'case when coalesce(p.room_preview->>''closed'',''false'')=''true''
        or (p.room_preview->>''eventKind''=''once'' and (p.room_preview->>''endsAt'')::timestamptz<=now()) then ''ended''');
end $$;
