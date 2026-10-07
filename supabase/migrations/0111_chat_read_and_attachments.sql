-- Read positions belong to a participant and survive app reinstalls and device changes.
-- Existing conversations start tracking unread messages from this migration onward.
alter table public.conversations add column unread_epoch timestamptz not null default now();

create table private.chat_read_positions (
  user_id uuid not null references public.profiles(id),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null,
  message_at timestamptz not null,
  primary key (user_id, conversation_id)
);
create index chat_read_positions_conversation_idx on private.chat_read_positions(conversation_id);
revoke all on private.chat_read_positions from public, anon, authenticated;

create function public.get_chat_read_position(p_conversation_id uuid)
returns timestamptz language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); position timestamptz;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if not private.can_read_conversation(p_conversation_id,u) then raise exception 'CONVERSATION_ACCESS_DENIED'; end if;
  select coalesce(r.message_at,c.unread_epoch) into position
  from public.conversations c left join private.chat_read_positions r
    on r.conversation_id=c.id and r.user_id=u where c.id=p_conversation_id;
  return position;
end;
$$;

create function public.mark_chat_read(p_conversation_id uuid,p_message_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); message public.messages;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select * into message from public.messages
    where id=p_message_id and conversation_id=p_conversation_id;
  if message.id is null or not private.can_read_message(p_conversation_id,u,message.sender_id,message.created_at)
    then raise exception 'MESSAGE_NOT_VISIBLE'; end if;
  insert into private.chat_read_positions(user_id,conversation_id,message_id,message_at)
  values(u,p_conversation_id,message.id,message.created_at)
  on conflict(user_id,conversation_id) do update
    set message_id=excluded.message_id,message_at=excluded.message_at
    where (excluded.message_at,excluded.message_id)>(chat_read_positions.message_at,chat_read_positions.message_id);
end;
$$;
revoke all on function public.get_chat_read_position(uuid),public.mark_chat_read(uuid,uuid) from public,anon;
grant execute on function public.get_chat_read_position(uuid),public.mark_chat_read(uuid,uuid) to authenticated;

alter table public.messages
  add column kind text not null default 'text' check (kind in ('text','image','location')),
  add column image_path text,
  add column latitude numeric(9,6),
  add column longitude numeric(9,6),
  add constraint message_attachment_shape check (
    (kind='text' and image_path is null and latitude is null and longitude is null)
    or (kind='image' and image_path is not null and latitude is null and longitude is null)
    or (kind='location' and image_path is null and latitude between -90 and 90 and longitude between -180 and 180)
  );
create unique index messages_image_path_idx on public.messages(image_path) where image_path is not null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('chat-images','chat-images',false,2097152,array['image/webp']);

create policy "participants read sent chat photos" on storage.objects for select to authenticated
using (bucket_id='chat-images' and (owner_id=(select auth.uid())::text or exists(
  select 1 from public.messages m where m.image_path=name
    and private.can_read_message(m.conversation_id,(select auth.uid()),m.sender_id,m.created_at)
)));
create policy "participants upload own chat photos" on storage.objects for insert to authenticated
with check (bucket_id='chat-images' and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists(select 1 from public.conversations c
    where c.id::text=split_part(storage.filename(name),'_',1) and c.status='active'
      and private.can_read_conversation(c.id,(select auth.uid()))));
create policy "owners remove unsent chat photos" on storage.objects for delete to authenticated
using (bucket_id='chat-images' and owner_id=(select auth.uid())::text);

-- Reuse the existing send_message guard, rate limit, moderation and notifications.
-- Its text label also keeps older app versions from rendering an empty bubble.
create function public.send_chat_attachment(p_conversation_id uuid,p_kind text,p_image_path text default null,
  p_latitude numeric default null,p_longitude numeric default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); sent uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_kind='image' then
    if p_latitude is not null or p_longitude is not null or p_image_path is null
      or left(p_image_path,length(u::text||'/'||p_conversation_id::text||'_'))<>u::text||'/'||p_conversation_id::text||'_'
      or p_image_path !~ '\.webp$'
      or not exists(select 1 from storage.objects where bucket_id='chat-images' and name=p_image_path and owner_id=u::text)
      then raise exception 'INVALID_CHAT_IMAGE'; end if;
  elsif p_kind='location' then
    if p_image_path is not null or p_latitude is null or p_longitude is null
      or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
      then raise exception 'INVALID_CHAT_LOCATION'; end if;
  else raise exception 'INVALID_CHAT_ATTACHMENT'; end if;
  sent:=public.send_message(p_conversation_id,case when p_kind='image' then '📷 사진' else '📍 위치' end);
  update public.messages set kind=p_kind,image_path=p_image_path,latitude=p_latitude,longitude=p_longitude where id=sent;
  return sent;
end;
$$;
revoke all on function public.send_chat_attachment(uuid,text,text,numeric,numeric) from public,anon;
grant execute on function public.send_chat_attachment(uuid,text,text,numeric,numeric) to authenticated;

-- Soft-deleted accounts keep their profile row; remove their private read cursor explicitly.
do $$ declare definition text; anchor text:='  delete from private.relationship_cooldowns where user_id=current_user_id;';
begin
  definition:=pg_get_functiondef('private.purge_account_data(text)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'chat read cleanup anchor missing'; end if;
  execute replace(definition,anchor,anchor||E'\n  delete from private.chat_read_positions where user_id=current_user_id;');
end $$;
