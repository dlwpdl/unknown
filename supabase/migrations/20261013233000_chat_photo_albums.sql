alter table public.messages
  add column image_paths text[] not null default '{}',
  add column client_send_id uuid,
  add constraint message_album_shape check (
    cardinality(image_paths)<=20 and array_position(image_paths,null) is null
    and (cardinality(image_paths)=0 or (kind='image' and image_path=image_paths[1]
      and array_ndims(image_paths)=1 and array_lower(image_paths,1)=1))
  );
create unique index messages_client_send_id_idx on public.messages(sender_id,client_send_id) where client_send_id is not null;
create index messages_album_paths_idx on public.messages using gin(image_paths);
create index message_history_album_paths_idx on private.message_history using gin((original->'image_paths'));

-- One existing guarded send produces one notification, unread item and safety queue entry.
create function public.send_chat_album(p_conversation_id uuid,p_image_paths text[],p_client_id uuid,p_reply_to_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); saved public.messages; original jsonb; sent uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  if not private.can_read_conversation(p_conversation_id,u) then raise exception 'CONVERSATION_ACCESS_DENIED'; end if;
  if p_client_id is null then raise exception 'INVALID_SEND_ID'; end if;
  if p_image_paths is null or cardinality(p_image_paths) not between 1 and 20
    or array_ndims(p_image_paths)<>1 or array_lower(p_image_paths,1)<>1
    or exists(select 1 from unnest(p_image_paths) path where path is null)
    or (select count(distinct path) from unnest(p_image_paths) path)<>cardinality(p_image_paths)
    then raise exception 'INVALID_CHAT_IMAGES'; end if;
  select * into saved from public.messages where sender_id=u and client_send_id=p_client_id;
  if saved.id is not null then
    original:=to_jsonb(saved);
    if saved.deleted_at is not null then
      select h.original into original from private.message_history h where h.message_id=saved.id and h.action='delete' order by h.id limit 1;
    end if;
    if saved.conversation_id<>p_conversation_id or original->'image_paths' is distinct from to_jsonb(p_image_paths)
      or (original->>'reply_to_id')::uuid is distinct from p_reply_to_id then raise exception 'SEND_ID_CONFLICT'; end if;
    return saved.id;
  end if;
  if exists(select 1 from unnest(p_image_paths) path
    where left(path,length(u::text||'/'||p_conversation_id::text||'_'))<>u::text||'/'||p_conversation_id::text||'_'
      or path !~ '\.webp$' or not exists(select 1 from storage.objects o where o.bucket_id='chat-images' and o.name=path and o.owner_id=u::text))
    then raise exception 'INVALID_CHAT_IMAGE'; end if;
  if exists(select 1 from public.messages m where m.image_path=any(p_image_paths) or m.image_paths && p_image_paths)
    then raise exception 'CHAT_IMAGE_ALREADY_SENT'; end if;
  sent:=public.send_message_v2(p_conversation_id,p_kind=>'image',p_image_path=>p_image_paths[1],p_reply_to_id=>p_reply_to_id);
  update public.messages set image_paths=p_image_paths,client_send_id=p_client_id,body='📷 사진 '||cardinality(p_image_paths)||'장' where id=sent;
  return sent;
end;
$$;
revoke all on function public.send_chat_album(uuid,text[],uuid,uuid) from public,anon;
grant execute on function public.send_chat_album(uuid,text[],uuid,uuid) to authenticated;

alter policy "participants read sent chat photos" on storage.objects
using (bucket_id='chat-images' and (owner_id=(select auth.uid())::text or exists(
  select 1 from public.messages m where (m.image_path=name or m.image_paths @> array[name])
    and private.can_read_message(m.conversation_id,(select auth.uid()),m.sender_id,m.created_at)
)));
alter policy "admins read sent chat photos" on storage.objects
using (bucket_id='chat-images' and (select private.is_admin()) and exists(
  select 1 from public.messages m where m.image_path=name or m.image_paths @> array[name]
));

create or replace function private.can_read_retained_chat_image(p_bucket text,p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare message_id uuid; sender_id uuid;
begin
  if p_bucket is distinct from 'chat-images' or not private.is_admin() then return false; end if;
  select h.message_id,(h.original->>'sender_id')::uuid into message_id,sender_id from private.message_history h
    where h.original->>'image_path'=p_path or (h.original->'image_paths') ? p_path order by h.id limit 1;
  if message_id is null then return false; end if;
  perform public.log_admin_access('messages',sender_id,message_id);
  return true;
end;
$$;
create or replace function private.can_remove_unsent_chat_image(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null or not exists(select 1 from storage.objects o where o.bucket_id='chat-images' and o.name=p_path and o.owner_id=u::text) then return false; end if;
  perform private.lock_relationships();
  return not exists(select 1 from public.messages m where m.image_path=p_path or m.image_paths @> array[p_path])
    and not exists(select 1 from private.message_history h where h.original->>'image_path'=p_path or (h.original->'image_paths') ? p_path);
end;
$$;

-- Existing audited readers and tombstones must include every path, with no change to their guards.
do $$ declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.send_chat_attachment(uuid,text,text,numeric,numeric)'::regprocedure);
  anchor:='  elsif p_kind=''location'' then';
  if array_length(string_to_array(definition,anchor),1)<>2 or strpos(definition,'perform private.lock_relationships();')=0
    then raise exception 'legacy album send boundary changed'; end if;
  execute replace(definition,anchor,$guard$
    if exists(select 1 from public.messages m where m.image_paths @> array[p_image_path])
      then raise exception 'CHAT_IMAGE_ALREADY_SENT'; end if;
$guard$||anchor);
  definition:=pg_get_functiondef('public.get_admin_conversation(uuid,timestamptz,uuid,uuid)'::regprocedure);
  anchor:='''image_path'',m.image_path,';
  if strpos(definition,anchor)=0 then raise exception 'admin album read anchor missing'; end if;
  execute replace(definition,anchor,anchor||'''image_paths'',m.image_paths,');
  definition:=pg_get_functiondef('public.delete_chat_message(uuid,timestamptz)'::regprocedure);
  anchor:='image_path=null,';
  if strpos(definition,anchor)=0 then raise exception 'album tombstone anchor missing'; end if;
  execute replace(definition,anchor,'image_path=null,image_paths=''{}'',');
end $$;
notify pgrst,'reload schema';
