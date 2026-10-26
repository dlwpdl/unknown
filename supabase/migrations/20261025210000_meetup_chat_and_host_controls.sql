-- Host-chosen chat history, chat-read notification clearing, idempotent text sends,
-- recruiting pause and member removal. Additive only: released clients keep their RPCs.

-- 1. History: by default a member reads from approval onward; the host may share earlier messages.
alter table public.meetup_requests add column share_history boolean not null default false;
grant select(share_history) on public.meetup_requests to authenticated;

do $$
declare definition text; anchor text:='and r.status=''approved'' and p_created_at>=coalesce(r.responded_at,r.created_at)';
begin
  definition:=pg_get_functiondef('private.can_read_message(uuid,uuid,uuid,timestamptz,boolean)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'MEETUP_HISTORY_ANCHOR_CHANGED'; end if;
  execute replace(definition,anchor,'and r.status=''approved'' and (r.share_history or p_created_at>=coalesce(r.responded_at,r.created_at))');
end $$;

create function public.set_meetup_history_access(p_post_id uuid, p_user_id uuid, p_share boolean)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r public.meetup_requests; room uuid; newest public.messages;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_share is null then raise exception 'INVALID_RESPONSE'; end if;
  perform private.lock_relationships();
  select * into r from public.meetup_requests where post_id=p_post_id and requester_id=p_user_id and host_id=u and status='approved' for update;
  if r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  update public.meetup_requests set share_history=p_share where id=r.id;
  if p_share then
    -- Shared history arrives as already read; only messages after joining count as unread.
    select id into room from public.conversations where group_post_id=p_post_id;
    select * into newest from public.messages where conversation_id=room and created_at<coalesce(r.responded_at,r.created_at)
      order by created_at desc,id desc limit 1;
    if newest.id is not null then
      insert into private.chat_read_positions(user_id,conversation_id,message_id,message_at)
        values(p_user_id,room,newest.id,newest.created_at) on conflict(user_id,conversation_id) do nothing;
    end if;
  end if;
end $$;

-- Approval and the history choice commit together; respond_meetup_request stays for released clients.
create function public.respond_meetup_request_v2(p_request_id uuid, p_response text, p_share_history boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare room uuid; r public.meetup_requests;
begin
  room:=public.respond_meetup_request(p_request_id,p_response);
  if p_response='approved' and coalesce(p_share_history,false) then
    select * into r from public.meetup_requests where id=p_request_id;
    perform public.set_meetup_history_access(r.post_id,r.requester_id,true);
  end if;
  return room;
end $$;

-- 2. Reading a chat also reads its message notifications, so the chat badge clears.
do $$
declare definition text; anchor text:='where (excluded.message_at,excluded.message_id)>(chat_read_positions.message_at,chat_read_positions.message_id);';
begin
  definition:=pg_get_functiondef('public.mark_chat_read(uuid,uuid)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'CHAT_READ_ANCHOR_CHANGED'; end if;
  execute replace(definition,anchor,anchor||'
  update public.notifications set read_at=now() where user_id=u and read_at is null and kind=''message'' and target_type=''message''
    and target_id in(select m.id from public.messages m where m.conversation_id=p_conversation_id and m.created_at<=message.created_at);');
end $$;

do $$
declare definition text; anchor text:='where (excluded.message_at,excluded.message_id)>(business_chat_reads.message_at,business_chat_reads.message_id);';
begin
  definition:=pg_get_functiondef('public.mark_business_chat_read(uuid,uuid,uuid)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'BUSINESS_CHAT_READ_ANCHOR_CHANGED'; end if;
  execute replace(definition,anchor,anchor||'
  update public.notifications set read_at=now() where user_id=auth.uid() and recipient_business_id is not distinct from p_as_business_id
    and read_at is null and kind=''message'' and target_type=''message''
    and target_id in(select x.id from public.messages x where x.conversation_id=c.id and x.created_at<=m.created_at);');
end $$;

-- 3. A retried send with the same client id returns the first message instead of posting twice.
create function public.send_message_v3(p_conversation_id uuid, p_client_id uuid, p_body text default '', p_kind text default 'text',
  p_image_path text default null, p_latitude numeric default null, p_longitude numeric default null,
  p_reply_to_id uuid default null, p_location_label text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); saved public.messages; sent uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_client_id is null then raise exception 'INVALID_SEND_ID'; end if;
  select * into saved from public.messages where sender_id=u and client_send_id=p_client_id;
  if saved.id is not null then
    if saved.conversation_id<>p_conversation_id or saved.kind<>coalesce(p_kind,'text') then raise exception 'SEND_ID_CONFLICT'; end if;
    return saved.id;
  end if;
  begin
    sent:=public.send_message_v2(p_conversation_id,p_body,p_kind,p_image_path,p_latitude,p_longitude,p_reply_to_id,p_location_label);
    update public.messages set client_send_id=p_client_id where id=sent;
  exception when unique_violation then
    -- A concurrent retry won; this attempt's insert is rolled back with the block.
    select id into sent from public.messages where sender_id=u and client_send_id=p_client_id and conversation_id=p_conversation_id;
    if sent is null then raise; end if;
  end;
  return sent;
end $$;

-- 4. Hosts can pause new requests without ending the meetup; existing pending requests stay reviewable.
create function private.guard_meetup_recruiting() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='pending' and (tg_op='INSERT' or old.status is distinct from 'pending')
    and exists(select 1 from public.posts where id=new.post_id and room_preview->>'recruitingClosed'='true')
    then raise exception 'MEETUP_RECRUITING_CLOSED'; end if;
  return new;
end $$;
create trigger meetup_requests_recruiting before insert or update of status on public.meetup_requests
  for each row execute function private.guard_meetup_recruiting();

create function public.set_meetup_recruiting(p_post_id uuid, p_open boolean)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); meetup public.posts;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_open is null then raise exception 'INVALID_RESPONSE'; end if;
  perform private.lock_relationships();
  select * into meetup from public.posts where id=p_post_id and author_id=u and status='published' and room_preview is not null for update;
  if meetup.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if not private.meetup_is_open(meetup.status,meetup.room_preview) then raise exception 'MEETUP_CLOSED'; end if;
  update public.posts set room_preview=case when p_open then room_preview-'recruitingClosed'
    else room_preview||'{"recruitingClosed":true}' end where id=p_post_id;
end $$;

-- 5. Removing a member ends their access like a rejection; the usual 24h request cooldown applies.
create function public.remove_meetup_member(p_post_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); meetup public.posts; r public.meetup_requests;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  select * into meetup from public.posts where id=p_post_id and author_id=u and room_preview is not null for update;
  if meetup.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  select * into r from public.meetup_requests where post_id=p_post_id and requester_id=p_user_id and status='approved' for update;
  if r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  update public.meetup_requests set status='rejected',responded_at=now(),share_history=false where id=r.id;
  update public.posts set room_preview=jsonb_set(room_preview,'{memberCount}',to_jsonb(1+(select count(*) from public.meetup_requests
    where post_id=p_post_id and status='approved'))) where id=p_post_id;
  perform private.create_notification(p_user_id,'meetup_rejected',u,'meetup_request',r.id,
    '호스트가 이 모임의 멤버 목록에서 제외했어요. 다른 모임도 둘러보세요.','/post/'||p_post_id::text);
end $$;

revoke all on function public.set_meetup_history_access(uuid,uuid,boolean), public.respond_meetup_request_v2(uuid,text,boolean),
  public.send_message_v3(uuid,uuid,text,text,text,numeric,numeric,uuid,text), public.set_meetup_recruiting(uuid,boolean),
  public.remove_meetup_member(uuid,uuid), private.guard_meetup_recruiting() from public, anon;
grant execute on function public.set_meetup_history_access(uuid,uuid,boolean), public.respond_meetup_request_v2(uuid,text,boolean),
  public.send_message_v3(uuid,uuid,text,text,text,numeric,numeric,uuid,text), public.set_meetup_recruiting(uuid,boolean),
  public.remove_meetup_member(uuid,uuid) to authenticated;

insert into private.behavior_targets(id) values
 ('meetup.manage.edit'),('meetup.manage.recruiting'),('meetup.member.remove'),('meetup.member.history'),('meetup.request.history')
on conflict do nothing;
