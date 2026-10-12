alter table public.messages
  add column reply_to_id uuid references public.messages(id) on delete set null,
  add column location_label text check (char_length(location_label) between 1 and 240),
  add column edited_at timestamptz,
  add column deleted_at timestamptz;
create index messages_reply_to_id_idx on public.messages(reply_to_id) where reply_to_id is not null;

-- Ordinary reads receive a tombstone; earlier content remains private for safety review.
create table private.message_history (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.messages(id) on delete cascade,
  actor_id uuid not null,
  action text not null check (action in ('edit','delete')),
  original jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index message_history_message_idx on private.message_history(message_id,created_at);
revoke all on private.message_history from public,anon,authenticated,service_role;
revoke update,delete on public.messages from authenticated;

create function private.message_safety_content(p_message_id uuid) returns jsonb
language sql security definer set search_path='' as $$
  select jsonb_build_object('authorId',m.sender_id,'text',concat_ws(E'\n',m.body,
    (select string_agg(h.original->>'body',E'\n' order by h.created_at,h.id) from private.message_history h where h.message_id=m.id)))
  from public.messages m where m.id=p_message_id;
$$;
revoke all on function private.message_safety_content(uuid) from public,anon,authenticated,service_role;
create function public.get_message_safety_content(p_message_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare content jsonb; context jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  content:=private.message_safety_content(p_message_id);
  -- Preserve the existing consent-filtered context endpoint when it is installed.
  if content is not null and to_regprocedure('public.get_message_safety_context(uuid)') is not null then
    execute 'select public.get_message_safety_context($1)' into context using p_message_id;
    content:=jsonb_set(content,'{text}',to_jsonb(concat_ws(E'\n',content->>'text',context->>'text')));
  end if;
  return content;
end;
$$;
revoke all on function public.get_message_safety_content(uuid) from public,anon,authenticated;
grant execute on function public.get_message_safety_content(uuid) to service_role;

-- Keep edited/deleted originals in the existing worker's review path and hash.
do $$ declare definition text; anchor text:='else to_jsonb(new)->>''body''';
begin
  definition:=pg_get_functiondef('private.enqueue_safety_review()'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'message safety queue anchor missing'; end if;
  execute replace(definition,anchor,'when ''messages'' then private.message_safety_content(new.id)->>''text'' '||anchor);
end;
$$;

create function public.send_message_v2(p_conversation_id uuid,p_body text default '',p_kind text default 'text',
  p_image_path text default null,p_latitude numeric default null,p_longitude numeric default null,
  p_reply_to_id uuid default null,p_location_label text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); parent public.messages; sent uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  if p_kind is null or p_kind not in ('text','image','location') then raise exception 'INVALID_CHAT_ATTACHMENT'; end if;
  if p_location_label is not null and (p_kind<>'location' or char_length(trim(p_location_label)) not between 1 and 240)
    then raise exception 'INVALID_CHAT_LOCATION'; end if;
  if p_reply_to_id is not null then
    select * into parent from public.messages where id=p_reply_to_id for share;
    if parent.id is null or parent.conversation_id<>p_conversation_id or parent.hidden_at is not null or parent.deleted_at is not null
      or not private.can_read_message(parent.conversation_id,u,parent.sender_id,parent.created_at)
      or private.has_reported(u,'message',parent.id) then raise exception 'MESSAGE_REPLY_UNAVAILABLE'; end if;
  end if;
  if p_kind='text' then
    if p_image_path is not null or p_latitude is not null or p_longitude is not null then raise exception 'INVALID_CHAT_ATTACHMENT'; end if;
    sent:=public.send_message(p_conversation_id,p_body);
  else
    sent:=public.send_chat_attachment(p_conversation_id,p_kind,p_image_path,p_latitude,p_longitude);
  end if;
  update public.messages set reply_to_id=p_reply_to_id,location_label=trim(p_location_label),
    body=case when p_kind='location' and p_location_label is not null then '📍 '||trim(p_location_label) else body end where id=sent;
  return sent;
end;
$$;

create function public.edit_chat_message(p_message_id uuid,p_body text,p_expected_edited_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); m public.messages; c public.conversations;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  select * into m from public.messages where id=p_message_id for update;
  if m.id is null or m.hidden_at is not null or not private.can_read_message(m.conversation_id,u,m.sender_id,m.created_at)
    or private.has_reported(u,'message',m.id) then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if m.sender_id<>u then raise exception 'MESSAGE_OWNER_REQUIRED'; end if;
  select * into c from public.conversations where id=m.conversation_id;
  if c.status is distinct from 'active' then raise exception 'CONVERSATION_NOT_ACTIVE'; end if;
  if c.kind='group' then
    if not exists(select 1 from public.posts where id=c.group_post_id and status='published' and coalesce(room_preview->>'closed','false')<>'true')
      then raise exception 'MEETUP_CLOSED'; end if;
    perform private.assert_chilling_open((select room_preview from public.posts where id=c.group_post_id));
  end if;
  if m.deleted_at is not null or m.kind<>'text' then raise exception 'MESSAGE_NOT_EDITABLE'; end if;
  if m.edited_at is distinct from p_expected_edited_at then raise exception 'MESSAGE_CHANGED'; end if;
  if char_length(trim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'INVALID_MESSAGE'; end if;
  perform private.enforce_rate_limit('message_edit',30,interval '1 minute',interval '0 seconds');
  insert into private.message_history(message_id,actor_id,action,original) values(m.id,u,'edit',to_jsonb(m));
  update public.messages set body=trim(p_body),edited_at=clock_timestamp() where id=m.id returning * into m;
  return to_jsonb(m);
end;
$$;

create function public.delete_chat_message(p_message_id uuid,p_expected_edited_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); m public.messages; c public.conversations;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  select * into m from public.messages where id=p_message_id for update;
  if m.id is null or not private.can_read_message(m.conversation_id,u,m.sender_id,m.created_at)
    then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if m.sender_id<>u then raise exception 'MESSAGE_OWNER_REQUIRED'; end if;
  select * into c from public.conversations where id=m.conversation_id;
  if c.status is distinct from 'active' then raise exception 'CONVERSATION_NOT_ACTIVE'; end if;
  if c.kind='group' then
    if not exists(select 1 from public.posts where id=c.group_post_id and status='published' and coalesce(room_preview->>'closed','false')<>'true')
      then raise exception 'MEETUP_CLOSED'; end if;
    perform private.assert_chilling_open((select room_preview from public.posts where id=c.group_post_id));
  end if;
  if m.deleted_at is not null then return to_jsonb(m); end if;
  if m.edited_at is distinct from p_expected_edited_at then raise exception 'MESSAGE_CHANGED'; end if;
  perform private.enforce_rate_limit('message_delete',30,interval '1 minute',interval '0 seconds');
  insert into private.message_history(message_id,actor_id,action,original) values(m.id,u,'delete',to_jsonb(m));
  update public.messages set body='삭제된 메시지입니다.',kind='text',image_path=null,latitude=null,longitude=null,
    location_label=null,deleted_at=clock_timestamp() where id=m.id returning * into m;
  return to_jsonb(m);
end;
$$;

create function public.get_admin_message_history(p_message_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('messages',null,p_message_id);
  return coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at,h.id) from private.message_history h where h.message_id=p_message_id),'[]'::jsonb);
end;
$$;
revoke all on function public.send_message_v2(uuid,text,text,text,numeric,numeric,uuid,text),
  public.edit_chat_message(uuid,text,timestamptz),public.delete_chat_message(uuid,timestamptz),public.get_admin_message_history(uuid) from public,anon;
grant execute on function public.send_message_v2(uuid,text,text,text,numeric,numeric,uuid,text),
  public.edit_chat_message(uuid,text,timestamptz),public.delete_chat_message(uuid,timestamptz),public.get_admin_message_history(uuid) to authenticated;

-- A modified message must be scanned just as a new message is.
drop trigger if exists messages_watch_terms on public.messages;
create trigger messages_watch_terms after insert or update of body on public.messages
  for each row when (new.deleted_at is null) execute function private.scan_watch_terms();
