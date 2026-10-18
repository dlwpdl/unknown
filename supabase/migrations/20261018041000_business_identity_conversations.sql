-- Public endpoints never contain a business's private owner/operator identity.
insert into private.behavior_targets(id) values
  ('chat.identity.open'),('chat.identity.close'),('chat.identity.options'),('chat.identity.personal'),
  ('chat.identity.business'),('chat.peer-profile'),('chat.sender-profile')
on conflict(id) do nothing;
-- Deleted accounts retain scrubbed actor tombstones while auth rows are hard-deleted.
-- Active profiles still require auth, and legacy sender:profiles embeddings stay intact.
alter table public.profiles
  add column auth_reference_id uuid generated always as (case when account_status='deleted' then null::uuid else id end) stored,
  drop constraint profiles_id_fkey,
  add constraint profiles_id_fkey foreign key(auth_reference_id) references auth.users(id) on delete cascade;
-- Scrubbed tombstones can share a label; live and suspended nicknames stay unique.
alter table public.profiles drop constraint profiles_nickname_key;
create unique index profiles_nickname_key on public.profiles(nickname) where account_status<>'deleted';
alter table public.conversations
  add column business_low_id uuid references private.merchants(id),
  add column business_high_id uuid references private.merchants(id),
  drop constraint conversations_kind_check,
  drop constraint conversation_kind_members,
  add constraint conversations_kind_check check(kind in ('direct','group','business')),
  add constraint conversation_kind_members check(
    (kind='direct' and user_low_id is not null and user_high_id is not null and group_post_id is null
      and business_low_id is null and business_high_id is null and (requester_id is null or requester_id in(user_low_id,user_high_id)))
    or (kind='group' and user_low_id is null and user_high_id is null and group_post_id is not null
      and business_low_id is null and business_high_id is null and requester_id is null)
    or (kind='business' and group_post_id is null and requester_id is null
      and num_nonnulls(user_low_id,business_low_id)=1 and num_nonnulls(user_high_id,business_high_id)=1
      and num_nonnulls(business_low_id,business_high_id)>=1
      and coalesce(user_low_id,business_low_id)<coalesce(user_high_id,business_high_id)));
create unique index business_conversations_active_idx on public.conversations
  (coalesce(user_low_id,business_low_id),coalesce(user_high_id,business_high_id)) where kind='business' and status='active';
create index conversations_business_low_idx on public.conversations(business_low_id,created_at desc,id desc) where kind='business';
create index conversations_business_high_idx on public.conversations(business_high_id,created_at desc,id desc) where kind='business';
alter table public.messages add column sender_business_id uuid references private.merchants(id);
alter table public.reports add column reporter_business_id uuid references private.merchants(id);
alter table public.notifications
  add column actor_business_id uuid references private.merchants(id),
  add column recipient_business_id uuid references private.merchants(id),
  add constraint notification_business_sender_private check(actor_business_id is null or actor_id is null);

create table private.business_chat_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  endpoint_id uuid not null, message_id uuid not null, message_at timestamptz not null,
  primary key(conversation_id,endpoint_id)
);
create table private.business_chat_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  endpoint_id uuid not null, primary key(message_id,endpoint_id)
);
create table private.business_chat_blocks (
  business_id uuid not null references private.merchants(id),
  other_id uuid not null, other_kind text not null check(other_kind in ('user','business')),
  created_at timestamptz not null default now(), primary key(business_id,other_id,other_kind)
);
create table private.business_chat_sends (
  endpoint_id uuid not null, client_id uuid not null, payload jsonb not null,
  message_id uuid not null references public.messages(id) on delete cascade,
  primary key(endpoint_id,client_id)
);
create index business_reports_endpoint_idx on public.reports(reporter_business_id,target_type,target_id) where reporter_business_id is not null;
alter table private.business_chat_reads enable row level security;
alter table private.business_chat_reactions enable row level security;
alter table private.business_chat_blocks enable row level security;
alter table private.business_chat_sends enable row level security;
revoke all on private.business_chat_reads,private.business_chat_reactions,private.business_chat_blocks,private.business_chat_sends from public,anon,authenticated,service_role;

create function private.business_chat_business_ready(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.merchants m join public.profiles p on p.id=m.owner_id
    join auth.users a on a.id=p.id where m.id=p_id and m.record_kind='business' and m.deleted_at is null
      and m.status<>'paused' and m.consent='granted' and m.owner_verified_at is not null
      and p.account_status='active' and p.terms_accepted_at is not null and p.privacy_accepted_at is not null
      and p.ai_safety_consent_at is not null and a.raw_app_meta_data->'merchant_enabled'='true'::jsonb
      and not exists(select 1 from public.profiles collision where collision.id=m.id));
$$;
create function private.business_chat_can_use(p_user uuid,p_business uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join auth.users a on a.id=p.id
    where p.id=p_user and p.account_status='active' and p.terms_accepted_at is not null
      and p.privacy_accepted_at is not null and p.ai_safety_consent_at is not null
      and (p_business is null or (a.raw_app_meta_data->'merchant_enabled'='true'::jsonb
        and private.business_chat_business_ready(p_business) and exists(select 1 from private.merchants m
          where m.id=p_business and (m.owner_id=p_user or exists(select 1 from private.merchant_operators o
            where o.merchant_id=m.id and o.user_id=p_user))))));
$$;
create function private.business_chat_blocked(p_user_low uuid,p_business_low uuid,p_user_high uuid,p_business_high uuid,p_viewer uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.business_blocks where
    (user_id=p_user_low and business_id=p_business_high) or (user_id=p_user_high and business_id=p_business_low)
    or (user_id=p_viewer and business_id in(p_business_low,p_business_high)))
    or exists(select 1 from private.business_chat_blocks where
      (business_id=p_business_low and other_id=coalesce(p_user_high,p_business_high)
        and other_kind=case when p_business_high is null then 'user' else 'business' end)
      or (business_id=p_business_high and other_id=coalesce(p_user_low,p_business_low)
        and other_kind=case when p_business_low is null then 'user' else 'business' end))
    or exists(select 1 from (select coalesce(p_user_low,m.owner_id) id from private.merchants m where m.id=p_business_low
      union select p_user_low where p_user_low is not null) lo
      cross join (select coalesce(p_user_high,m.owner_id) id from private.merchants m where m.id=p_business_high
        union select p_user_high where p_user_high is not null) hi
      where private.is_blocked_between(lo.id,hi.id) or private.is_blocked_between(p_viewer,lo.id)
        or private.is_blocked_between(p_viewer,hi.id) or private.has_reported(p_viewer,'user',lo.id)
        or private.has_reported(p_viewer,'user',hi.id));
$$;
create function private.business_chat_access(p_conversation uuid,p_user uuid,p_business uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.business_chat_can_use(p_user,p_business) and exists(select 1 from public.conversations c
    where c.id=p_conversation and c.kind='business' and c.status in ('active','ended')
      and (case when p_business is null then p_user in(c.user_low_id,c.user_high_id)
        else p_business in(c.business_low_id,c.business_high_id) end)
      and (c.business_low_id is null or private.business_chat_business_ready(c.business_low_id))
      and (c.business_high_id is null or private.business_chat_business_ready(c.business_high_id))
      and (c.user_low_id is null or private.business_chat_can_use(c.user_low_id,null))
      and (c.user_high_id is null or private.business_chat_can_use(c.user_high_id,null))
      and not private.business_chat_blocked(c.user_low_id,c.business_low_id,c.user_high_id,c.business_high_id,p_user));
$$;
-- Read and write RPCs use the established relationship/account/connection order.
create function private.lock_business_chat(p_conversation uuid,p_business uuid) returns public.conversations
language plpgsql security definer set search_path='' as $$
declare c public.conversations;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.lock_relationships();
  select * into c from public.conversations where id=p_conversation and kind='business';
  if c.id is null then raise exception 'CONVERSATION_ACCESS_DENIED'; end if;
  perform 1 from public.profiles where id in(auth.uid(),c.user_low_id,c.user_high_id)
    or id in(select owner_id from private.merchants where id in(c.business_low_id,c.business_high_id))
    or id in(select user_id from private.merchant_operators where merchant_id in(c.business_low_id,c.business_high_id)) order by id for share;
  perform 1 from auth.users where id in(auth.uid(),c.user_low_id,c.user_high_id)
    or id in(select owner_id from private.merchants where id in(c.business_low_id,c.business_high_id))
    or id in(select user_id from private.merchant_operators where merchant_id in(c.business_low_id,c.business_high_id)) order by id for share;
  perform 1 from private.merchants where id in(c.business_low_id,c.business_high_id) order by id for share;
  perform 1 from private.merchant_operators where merchant_id in(c.business_low_id,c.business_high_id) order by merchant_id,user_id for share;
  select * into c from public.conversations where id=p_conversation for update;
  if not private.business_chat_access(c.id,auth.uid(),p_business) then raise exception 'CONVERSATION_ACCESS_DENIED'; end if;
  return c;
end;
$$;
create function private.business_chat_message_visible(m public.messages,p_user uuid,p_business uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select m.hidden_at is null and private.is_active_account(m.sender_id)
    and not private.is_blocked_between(p_user,m.sender_id) and not private.has_reported(p_user,'user',m.sender_id)
    and not exists(select 1 from public.reports r where r.target_type='message' and r.target_id=m.id
      and (case when p_business is null then r.reporter_business_id is null and r.reporter_id=p_user
        else r.reporter_business_id=p_business end));
$$;
create function private.business_chat_identity(p_user uuid,p_business uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when p_business is null then
    (select jsonb_build_object('kind','user','id',p.id,'name',p.nickname::text,'avatar_path',p.avatar_path) from public.profiles p where p.id=p_user)
    else (select jsonb_build_object('kind','business','id',m.id,'name',m.name,'avatar_path',
      case when m.avatar_path is not null then 'business-profile/'||m.id::text||'/avatar/'||md5(m.avatar_path) end)
      from private.merchants m where m.id=p_business) end;
$$;
create function private.business_chat_preview(c public.conversations,p_user uuid,p_business uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',c.id,'kind','business','status',c.status,'requester_id',null,'group_post_id',null,
    'self_identity',case when coalesce(p_business,p_user)=coalesce(c.user_low_id,c.business_low_id)
      then private.business_chat_identity(c.user_low_id,c.business_low_id) else private.business_chat_identity(c.user_high_id,c.business_high_id) end,
    'other_identity',case when coalesce(p_business,p_user)=coalesce(c.user_low_id,c.business_low_id)
      then private.business_chat_identity(c.user_high_id,c.business_high_id) else private.business_chat_identity(c.user_low_id,c.business_low_id) end,
    'latest_body',(select m.body from public.messages m where m.conversation_id=c.id and private.business_chat_message_visible(m,p_user,p_business) order by m.created_at desc,m.id desc limit 1),
    'latest_at',coalesce((select m.created_at from public.messages m where m.conversation_id=c.id and private.business_chat_message_visible(m,p_user,p_business) order by m.created_at desc,m.id desc limit 1),c.created_at),
    'unread',exists(select 1 from public.messages m where m.conversation_id=c.id and coalesce(m.sender_business_id,m.sender_id)<>coalesce(p_business,p_user)
      and private.business_chat_message_visible(m,p_user,p_business) and (m.created_at,m.id)>
        coalesce((select (r.message_at,r.message_id) from private.business_chat_reads r where r.conversation_id=c.id and r.endpoint_id=coalesce(p_business,p_user)),(c.unread_epoch,'00000000-0000-0000-0000-000000000000'::uuid))));
$$;
create function private.business_chat_message_dto(m public.messages,p_user uuid,p_business uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',m.id,'conversation_id',m.conversation_id,'sender_id',coalesce(m.sender_business_id,m.sender_id),
    'sender_kind',case when m.sender_business_id is null then 'user' else 'business' end,
    'sender_name',private.business_chat_identity(m.sender_id,m.sender_business_id)->>'name',
    'avatar_path',private.business_chat_identity(m.sender_id,m.sender_business_id)->>'avatar_path',
    'is_mine',coalesce(m.sender_business_id,m.sender_id)=coalesce(p_business,p_user),'body',m.body,'kind',m.kind,
    'created_at',m.created_at,'edited_at',m.edited_at,'deleted_at',m.deleted_at,'image_path',m.image_path,'image_paths',m.image_paths,
    'latitude',m.latitude,'longitude',m.longitude,'location_label',m.location_label,'reply_to_id',m.reply_to_id,
    'reply_to',(select jsonb_build_object('id',p.id,'sender_id',coalesce(p.sender_business_id,p.sender_id),
      'sender_kind',case when p.sender_business_id is null then 'user' else 'business' end,'kind',p.kind,'body',left(p.body,240),'deleted_at',p.deleted_at)
      from public.messages p where p.id=m.reply_to_id and p.conversation_id=m.conversation_id and private.business_chat_message_visible(p,p_user,p_business)),
    'hearts',(select count(*) from private.business_chat_reactions r where r.message_id=m.id),
    'mine_reacted',exists(select 1 from private.business_chat_reactions r where r.message_id=m.id and r.endpoint_id=coalesce(p_business,p_user)));
$$;

create function private.guard_business_chat_identity() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name='conversations' then
    if tg_op='UPDATE' and (old.kind='business' or new.kind='business') and
      (new.kind,new.user_low_id,new.user_high_id,new.business_low_id,new.business_high_id,new.requester_id,new.group_post_id)
        is distinct from (old.kind,old.user_low_id,old.user_high_id,old.business_low_id,old.business_high_id,old.requester_id,old.group_post_id)
      then raise exception 'BUSINESS_ENDPOINTS_IMMUTABLE'; end if;
  else
    if tg_op='UPDATE' and (new.sender_id,new.sender_business_id,new.conversation_id) is distinct from (old.sender_id,old.sender_business_id,old.conversation_id)
      then raise exception 'MESSAGE_IDENTITY_IMMUTABLE'; end if;
    if exists(select 1 from public.conversations c where c.id=new.conversation_id and c.kind='business'
      and not coalesce(case when new.sender_business_id is null then new.sender_id in(c.user_low_id,c.user_high_id)
        else new.sender_business_id in(c.business_low_id,c.business_high_id) end,false))
      or (new.sender_business_id is not null and not exists(select 1 from public.conversations c where c.id=new.conversation_id and c.kind='business'))
      then raise exception 'BUSINESS_ENDPOINT_MISMATCH'; end if;
  end if;
  return new;
end;
$$;
create trigger business_conversation_identity before update on public.conversations for each row execute function private.guard_business_chat_identity();
create trigger business_message_identity before insert or update on public.messages for each row execute function private.guard_business_chat_identity();
create function private.is_business_chat(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$ select exists(select 1 from public.conversations where id=p_id and kind='business'); $$;
create function private.is_business_message(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$ select exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id where m.id=p_id and c.kind='business'); $$;
create policy "business conversation raw identities private" on public.conversations as restrictive for select to anon,authenticated
  using(kind<>'business' or (select private.is_admin()));
create policy "business message raw actors private" on public.messages as restrictive for select to anon,authenticated
  using(not private.is_business_chat(conversation_id) or (select private.is_admin()));
create policy "business message reports private" on public.reports as restrictive for select to anon,authenticated
  using((select private.is_admin()) or (reporter_business_id is null and (target_type<>'message' or not private.is_business_message(target_id))));

create function public.start_business_conversation(p_as_business_id uuid,p_other_business_id uuid,p_other_user_id uuid,p_post_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); c public.conversations; a uuid:=coalesce(p_as_business_id,u); b uuid:=coalesce(p_other_business_id,p_other_user_id); found_id uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if num_nonnulls(p_other_business_id,p_other_user_id)<>1 or (p_as_business_id is null and p_other_business_id is null)
    or a=b then raise exception 'INVALID_RECIPIENT'; end if;
  perform private.lock_relationships();
  perform 1 from public.profiles where id in(u,p_other_user_id)
    or id in(select owner_id from private.merchants where id in(p_as_business_id,p_other_business_id))
    or id in(select user_id from private.merchant_operators where merchant_id in(p_as_business_id,p_other_business_id)) order by id for share;
  perform 1 from auth.users where id in(u,p_other_user_id)
    or id in(select owner_id from private.merchants where id in(p_as_business_id,p_other_business_id))
    or id in(select user_id from private.merchant_operators where merchant_id in(p_as_business_id,p_other_business_id)) order by id for share;
  perform 1 from private.merchants where id in(p_as_business_id,p_other_business_id) order by id for share;
  perform 1 from private.merchant_operators where merchant_id=p_as_business_id and user_id=u for share;
  if not private.business_chat_can_use(u,p_as_business_id)
    or (p_other_business_id is not null and not private.business_chat_business_ready(p_other_business_id))
    or (p_other_user_id is not null and not private.business_chat_can_use(p_other_user_id,null)) then raise exception 'CONVERSATION_ACCESS_DENIED'; end if;
  c.kind:='business';
  if a<b then
    c.user_low_id:=case when p_as_business_id is null then u end; c.business_low_id:=p_as_business_id;
    c.user_high_id:=p_other_user_id; c.business_high_id:=p_other_business_id;
  else
    c.user_high_id:=case when p_as_business_id is null then u end; c.business_high_id:=p_as_business_id;
    c.user_low_id:=p_other_user_id; c.business_low_id:=p_other_business_id;
  end if;
  if private.business_chat_blocked(c.user_low_id,c.business_low_id,c.user_high_id,c.business_high_id,u) then raise exception 'CONVERSATION_ACCESS_DENIED'; end if;
  if p_post_id is not null then
    perform 1 from public.posts where id=p_post_id for share;
    if p_other_business_id is not null then
      if private.public_post_business_id_for(p_post_id,u) is distinct from p_other_business_id then raise exception 'INVALID_BUSINESS_POST'; end if;
    elsif not exists(select 1 from public.posts p where p.id=p_post_id and p.author_id=p_other_user_id
      and p.business_author_id is null and p.status='published' and private.is_active_account(p.author_id)
      and not private.is_blocked_between(u,p.author_id) and not private.has_reported(u,'user',p.author_id)
      and not private.has_reported(u,'post',p.id)) then raise exception 'INVALID_BUSINESS_POST'; end if;
  end if;
  select id into found_id from public.conversations where kind='business' and status='active'
    and coalesce(user_low_id,business_low_id)=least(a,b) and coalesce(user_high_id,business_high_id)=greatest(a,b) for update;
  if found_id is not null then
    if p_post_id is not null then update public.conversations set context_post_id=p_post_id where id=found_id; end if;
    return found_id;
  end if;
  perform private.enforce_rate_limit('conversation_request',20,interval '1 hour',interval '30 seconds');
  insert into public.conversations(kind,user_low_id,user_high_id,business_low_id,business_high_id,status,accepted_at,context_post_id)
    values('business',c.user_low_id,c.user_high_id,c.business_low_id,c.business_high_id,'active',now(),p_post_id) returning id into found_id;
  return found_id;
end;
$$;

create function public.get_business_chat_messages(p_conversation_id uuid,p_as_business_id uuid,p_limit integer default 50,
  p_before_created timestamptz default null,p_before_id uuid default null,p_message_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.conversations; result jsonb; page_size integer:=greatest(1,least(coalesce(p_limit,50),50));
begin
  c:=private.lock_business_chat(p_conversation_id,p_as_business_id);
  if (p_before_created is null)<>(p_before_id is null) then raise exception 'INVALID_MESSAGE_CURSOR'; end if;
  if p_message_ids is not null and (cardinality(p_message_ids)>50 or array_position(p_message_ids,null) is not null
    or (cardinality(p_message_ids)>0 and (array_ndims(p_message_ids)<>1 or array_lower(p_message_ids,1)<>1))) then raise exception 'MESSAGE_BATCH_TOO_LARGE'; end if;
  with page as materialized (
    select m.* from public.messages m where m.conversation_id=c.id
      and private.business_chat_message_visible(m,auth.uid(),p_as_business_id)
      and (p_message_ids is null or m.id=any(p_message_ids))
      and (p_message_ids is not null or p_before_created is null or (m.created_at,m.id)<(p_before_created,p_before_id))
    order by m.created_at desc,m.id desc limit page_size+1
  ), displayed as materialized (select * from page order by created_at desc,id desc limit page_size)
  select jsonb_build_object('conversation',private.business_chat_preview(c,auth.uid(),p_as_business_id),
    'items',coalesce((select jsonb_agg(private.business_chat_message_dto(d,auth.uid(),p_as_business_id) order by d.created_at,d.id) from displayed d),'[]'::jsonb),
    'cursor',case when p_message_ids is null and (select count(*) from page)>page_size then
      (select jsonb_build_object('id',id,'createdAt',created_at) from displayed order by created_at,id limit 1) else null end,
    'read_at',coalesce((select message_at from private.business_chat_reads where conversation_id=c.id and endpoint_id=coalesce(p_as_business_id,auth.uid())),c.unread_epoch)) into result;
  return result;
end;
$$;

create function public.send_business_chat_message(p_conversation_id uuid,p_as_business_id uuid,p_client_id uuid,
  p_body text default '',p_kind text default 'text',p_image_paths text[] default '{}',p_latitude numeric default null,
  p_longitude numeric default null,p_reply_to_id uuid default null,p_location_label text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.conversations; u uuid:=auth.uid(); endpoint uuid:=coalesce(p_as_business_id,u); saved private.business_chat_sends;
  payload jsonb; body text; sent uuid; path text; parent public.messages;
begin
  c:=private.lock_business_chat(p_conversation_id,p_as_business_id);
  if p_client_id is null then raise exception 'INVALID_SEND_ID'; end if;
  if p_kind is null or p_kind not in ('text','image','location') or p_image_paths is null then raise exception 'INVALID_CHAT_ATTACHMENT'; end if;
  if p_location_label is not null and (p_kind<>'location' or char_length(btrim(p_location_label)) not between 1 and 240) then raise exception 'INVALID_CHAT_LOCATION'; end if;
  if p_kind='text' then
    if cardinality(p_image_paths)<>0 or p_latitude is not null or p_longitude is not null or char_length(btrim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'INVALID_MESSAGE'; end if;
    body:=btrim(p_body);
  elsif p_kind='image' then
    if p_latitude is not null or p_longitude is not null or cardinality(p_image_paths) not between 1 and 20
      or array_ndims(p_image_paths)<>1 or array_lower(p_image_paths,1)<>1 or array_position(p_image_paths,null) is not null
      or (select count(distinct x) from unnest(p_image_paths) x)<>cardinality(p_image_paths) then raise exception 'INVALID_CHAT_IMAGES'; end if;
    body:='📷 사진 '||cardinality(p_image_paths)||'장';
  else
    if cardinality(p_image_paths)<>0 or p_latitude is null or p_longitude is null or p_latitude not between -90 and 90
      or p_longitude not between -180 and 180 then raise exception 'INVALID_CHAT_LOCATION'; end if;
    body:=case when p_location_label is null then '📍 위치' else '📍 '||btrim(p_location_label) end;
  end if;
  payload:=jsonb_build_object('conversation',c.id,'body',body,'kind',p_kind,'images',p_image_paths,'latitude',p_latitude,'longitude',p_longitude,
    'reply',p_reply_to_id,'label',btrim(p_location_label));
  select * into saved from private.business_chat_sends where endpoint_id=endpoint and client_id=p_client_id;
  if saved.message_id is not null then
    if saved.payload is distinct from payload then raise exception 'SEND_ID_CONFLICT'; end if;
    return saved.message_id;
  end if;
  if c.status<>'active' then raise exception 'CONVERSATION_NOT_ACTIVE'; end if;
  if p_reply_to_id is not null then
    select * into parent from public.messages where id=p_reply_to_id for share;
    if parent.id is null or parent.conversation_id<>c.id or parent.deleted_at is not null
      or not private.business_chat_message_visible(parent,u,p_as_business_id) then raise exception 'MESSAGE_REPLY_UNAVAILABLE'; end if;
  end if;
  foreach path in array p_image_paths loop
    if path !~ ('^'||endpoint::text||'/'||c.id::text||'_[0-9]+-[A-Za-z0-9]+\.webp$')
      or not exists(select 1 from storage.objects where bucket_id='chat-images' and name=path and owner_id=u::text)
      then raise exception 'INVALID_CHAT_IMAGE'; end if;
    if exists(select 1 from public.messages where image_path=path or image_paths @> array[path]) then raise exception 'CHAT_IMAGE_ALREADY_SENT'; end if;
  end loop;
  perform private.enforce_rate_limit('message',30,interval '1 minute',interval '1 second');
  insert into public.messages(conversation_id,sender_id,sender_business_id,body,kind,image_path,image_paths,latitude,longitude,reply_to_id,location_label)
    values(c.id,u,p_as_business_id,body,p_kind,p_image_paths[1],p_image_paths,p_latitude,p_longitude,p_reply_to_id,btrim(p_location_label)) returning id into sent;
  insert into private.business_chat_sends(endpoint_id,client_id,payload,message_id) values(endpoint,p_client_id,payload,sent);
  return sent;
end;
$$;

create function private.change_business_chat_message(p_message uuid,p_business uuid,p_body text,p_expected timestamptz,p_delete boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.messages; c public.conversations;
begin
  select * into m from public.messages where id=p_message;
  c:=private.lock_business_chat(m.conversation_id,p_business);
  select * into m from public.messages where id=p_message for update;
  if not private.business_chat_message_visible(m,auth.uid(),p_business) then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if m.sender_business_id is distinct from p_business or (p_business is null and m.sender_id<>auth.uid()) then raise exception 'MESSAGE_OWNER_REQUIRED'; end if;
  if c.status<>'active' then raise exception 'CONVERSATION_NOT_ACTIVE'; end if;
  if p_delete and m.deleted_at is not null then return private.business_chat_message_dto(m,auth.uid(),p_business); end if;
  if m.edited_at is distinct from p_expected then raise exception 'MESSAGE_CHANGED'; end if;
  if not p_delete and (m.deleted_at is not null or m.kind<>'text') then raise exception 'MESSAGE_NOT_EDITABLE'; end if;
  if not p_delete and char_length(btrim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'INVALID_MESSAGE'; end if;
  perform private.enforce_rate_limit(case when p_delete then 'message_delete' else 'message_edit' end,30,interval '1 minute',interval '0 seconds');
  insert into private.message_history(message_id,actor_id,action,original) values(m.id,auth.uid(),case when p_delete then 'delete' else 'edit' end,to_jsonb(m));
  if p_delete then
    update public.messages set body='삭제된 메시지입니다.',kind='text',image_path=null,image_paths='{}',latitude=null,longitude=null,location_label=null,deleted_at=clock_timestamp() where id=m.id returning * into m;
  else update public.messages set body=btrim(p_body),edited_at=clock_timestamp() where id=m.id returning * into m; end if;
  return private.business_chat_message_dto(m,auth.uid(),p_business);
end;
$$;
create function public.edit_business_chat_message(p_message_id uuid,p_as_business_id uuid,p_body text,p_expected_edited_at timestamptz default null)
returns jsonb language sql security definer set search_path='' as $$ select private.change_business_chat_message(p_message_id,p_as_business_id,p_body,p_expected_edited_at,false); $$;
create function public.delete_business_chat_message(p_message_id uuid,p_as_business_id uuid,p_expected_edited_at timestamptz default null)
returns jsonb language sql security definer set search_path='' as $$ select private.change_business_chat_message(p_message_id,p_as_business_id,null,p_expected_edited_at,true); $$;
create function public.mark_business_chat_read(p_conversation_id uuid,p_as_business_id uuid,p_message_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.conversations; m public.messages;
begin
  c:=private.lock_business_chat(p_conversation_id,p_as_business_id);
  select * into m from public.messages where id=p_message_id and conversation_id=c.id;
  if m.id is null or not private.business_chat_message_visible(m,auth.uid(),p_as_business_id) then raise exception 'MESSAGE_NOT_VISIBLE'; end if;
  insert into private.business_chat_reads(conversation_id,endpoint_id,message_id,message_at) values(c.id,coalesce(p_as_business_id,auth.uid()),m.id,m.created_at)
    on conflict(conversation_id,endpoint_id) do update set message_id=excluded.message_id,message_at=excluded.message_at
      where (excluded.message_at,excluded.message_id)>(business_chat_reads.message_at,business_chat_reads.message_id);
end;
$$;
create function public.set_business_chat_reaction(p_message_id uuid,p_as_business_id uuid,p_reacted boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.messages; c public.conversations;
begin
  select * into m from public.messages where id=p_message_id;
  c:=private.lock_business_chat(m.conversation_id,p_as_business_id);
  if p_reacted is null or m.deleted_at is not null or not private.business_chat_message_visible(m,auth.uid(),p_as_business_id) then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if c.status<>'active' then raise exception 'CONVERSATION_NOT_ACTIVE'; end if;
  if p_reacted then insert into private.business_chat_reactions(message_id,endpoint_id) values(m.id,coalesce(p_as_business_id,auth.uid())) on conflict do nothing;
  else delete from private.business_chat_reactions where message_id=m.id and endpoint_id=coalesce(p_as_business_id,auth.uid()); end if;
  return jsonb_build_object('hearts',(select count(*) from private.business_chat_reactions where message_id=m.id),'mine',p_reacted);
end;
$$;
create function public.report_business_chat_message(p_message_id uuid,p_as_business_id uuid,p_reason_code text,p_details text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.conversations; m public.messages; saved uuid;
begin
  select * into m from public.messages where id=p_message_id;
  c:=private.lock_business_chat(m.conversation_id,p_as_business_id);
  if m.id is null or m.deleted_at is not null or not private.business_chat_message_visible(m,auth.uid(),p_as_business_id) then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if coalesce(m.sender_business_id,m.sender_id)=coalesce(p_as_business_id,auth.uid()) or m.sender_id=auth.uid() then raise exception 'CANNOT_REPORT_SELF'; end if;
  if p_reason_code is null or p_reason_code not in ('spam','harassment','hate','sexual','privacy','other') then raise exception 'INVALID_REASON'; end if;
  if char_length(coalesce(p_details,''))>1000 then raise exception 'INVALID_DETAILS'; end if;
  perform private.enforce_rate_limit('report',20,interval '1 day',interval '5 seconds');
  insert into public.reports(reporter_id,reporter_business_id,reported_user_id,target_type,target_id,reason_code,details)
    values(auth.uid(),p_as_business_id,m.sender_id,'message',m.id,p_reason_code,nullif(btrim(p_details),'')) returning id into saved;
  perform private.emit_business_chat_changed(c.id,m.id);
  return saved;
end;
$$;
create function public.end_business_conversation(p_conversation_id uuid,p_as_business_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.conversations;
begin
  c:=private.lock_business_chat(p_conversation_id,p_as_business_id);
  update public.conversations set status='ended',ended_at=coalesce(ended_at,now()) where id=c.id and status='active';
end;
$$;
create function public.block_business_conversation(p_conversation_id uuid,p_as_business_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.conversations; peer uuid; peer_business uuid;
begin
  c:=private.lock_business_chat(p_conversation_id,p_as_business_id);
  if coalesce(p_as_business_id,auth.uid())=coalesce(c.user_low_id,c.business_low_id) then peer:=coalesce(c.user_high_id,c.business_high_id);peer_business:=c.business_high_id;
  else peer:=coalesce(c.user_low_id,c.business_low_id);peer_business:=c.business_low_id; end if;
  if p_as_business_id is null then insert into private.business_blocks(user_id,business_id) values(auth.uid(),peer_business) on conflict do nothing;
  else insert into private.business_chat_blocks(business_id,other_id,other_kind) values(p_as_business_id,peer,case when peer_business is null then 'user' else 'business' end) on conflict do nothing; end if;
  update public.conversations set status='ended',ended_at=coalesce(ended_at,now()) where id=c.id and status='active';
end;
$$;

create function public.get_identity_conversation_inbox(p_as_business_id uuid,p_filter text default 'all',p_limit integer default 30,
  p_before_status text default null,p_before_created timestamptz default null,p_before_id uuid default null,p_conversation_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare legacy jsonb:='{"items":[],"selected":null,"pending_count":0}'; business jsonb:='[]'; c public.conversations;
  preview jsonb; result jsonb; size integer:=greatest(1,least(coalesce(p_limit,30),50));
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.lock_relationships();
  perform 1 from public.profiles where id=auth.uid()
    or id in(select owner_id from private.merchants where id=p_as_business_id)
    or id in(select user_id from private.merchant_operators where merchant_id=p_as_business_id) order by id for share;
  perform 1 from auth.users where id=auth.uid()
    or id in(select owner_id from private.merchants where id=p_as_business_id)
    or id in(select user_id from private.merchant_operators where merchant_id=p_as_business_id) order by id for share;
  if p_as_business_id is not null then
    perform 1 from private.merchants where id=p_as_business_id for share;
    perform 1 from private.merchant_operators where merchant_id=p_as_business_id and user_id=auth.uid() for share;
  end if;
  if not private.business_chat_can_use(auth.uid(),p_as_business_id) then raise exception 'CONVERSATION_ACCESS_DENIED'; end if;
  if p_filter is null or p_filter not in ('all','direct','group','requests') then raise exception 'INVALID_INBOX_FILTER'; end if;
  if num_nonnulls(p_before_status,p_before_created,p_before_id) not in (0,3)
    or (p_before_status is not null and p_before_status not in ('active','pending','ended')) then raise exception 'INVALID_INBOX_CURSOR'; end if;
  if p_as_business_id is null then
    legacy:=public.get_conversation_inbox(p_filter,50,p_before_status,p_before_created,p_before_id,p_conversation_id);
  end if;
  for c in select * from public.conversations where kind='business' and status in ('active','ended')
    and (case when p_as_business_id is null then auth.uid() in(user_low_id,user_high_id) else p_as_business_id in(business_low_id,business_high_id) end)
    and (p_filter in ('all','direct') or id=p_conversation_id) order by id
  loop
    if private.business_chat_access(c.id,auth.uid(),p_as_business_id) then
      c:=private.lock_business_chat(c.id,p_as_business_id);
      preview:=private.business_chat_preview(c,auth.uid(),p_as_business_id);
      business:=business||jsonb_build_array(preview);
    end if;
  end loop;
  with candidates as materialized (
    select value item from jsonb_array_elements(legacy->'items')
    union all select value from jsonb_array_elements(business) where p_filter in ('all','direct')
  ), page as materialized (
    select item,case when item->>'status'='active' then 0 else 1 end rank from candidates
    where p_before_created is null
      or case when item->>'status'='active' then 0 else 1 end>case when p_before_status='active' then 0 else 1 end
      or (case when item->>'status'='active' then 0 else 1 end=case when p_before_status='active' then 0 else 1 end
        and ((item->>'latest_at')::timestamptz,(item->>'id')::uuid)<(p_before_created,p_before_id))
    order by rank,(item->>'latest_at')::timestamptz desc,(item->>'id')::uuid desc limit size+1
  ), displayed as materialized (select * from page order by rank,(item->>'latest_at')::timestamptz desc,(item->>'id')::uuid desc limit size)
  select jsonb_build_object('items',coalesce((select jsonb_agg(item order by rank,(item->>'latest_at')::timestamptz desc,(item->>'id')::uuid desc) from displayed),'[]'),
    'pending_count',coalesce((legacy->>'pending_count')::integer,0),
    'selected',coalesce((select value from jsonb_array_elements(business) where value->>'id'=p_conversation_id::text),nullif(legacy->'selected','null')),
    'cursor',case when (select count(*) from page)>size or legacy->'cursor'<>'null'::jsonb then
      (select jsonb_build_object('status',item->>'status','createdAt',item->>'latest_at','id',item->>'id') from displayed
        order by rank desc,(item->>'latest_at')::timestamptz,(item->>'id')::uuid limit 1) else null end) into result;
  return result;
end;
$$;

-- Per-auth-user delivery is reauthorized at each fanout, even for old subscriptions.
create function private.business_chat_recipients(p_conversation uuid)
returns table(user_id uuid,business_id uuid) language sql stable security definer set search_path='' as $$
  with c as (select * from public.conversations where id=p_conversation and kind='business'),
  endpoints as (select user_low_id uid,business_low_id bid from c union select user_high_id,business_high_id from c),
  candidates as (select uid,bid from endpoints where bid is null
    union select m.owner_id,e.bid from endpoints e join private.merchants m on m.id=e.bid
    union select o.user_id,e.bid from endpoints e join private.merchant_operators o on o.merchant_id=e.bid)
  select uid,bid from candidates where private.business_chat_access(p_conversation,uid,bid);
$$;
create function private.emit_business_chat_changed(p_conversation uuid,p_message uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare recipient record; payload jsonb;
begin
  for recipient in select * from private.business_chat_recipients(p_conversation) loop
    perform 1 from public.profiles where id=recipient.user_id for share;
    perform 1 from auth.users where id=recipient.user_id for share;
    if not private.business_chat_access(p_conversation,recipient.user_id,recipient.business_id) then continue; end if;
    payload:=jsonb_build_object('conversation_id',p_conversation);
    if p_message is not null then payload:=payload||jsonb_build_object('message_id',p_message); end if;
    if recipient.business_id is not null then payload:=payload||jsonb_build_object('recipient_business_id',recipient.business_id); end if;
    perform realtime.send(payload,'business_chat_changed','business-chat:'||recipient.user_id::text,true);
  end loop;
end;
$$;
create function private.broadcast_business_chat_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare cid uuid; mid uuid;
begin
  if tg_table_name='conversations' then cid:=new.id;
  elsif tg_table_name='messages' then cid:=new.conversation_id;mid:=new.id;
  elsif tg_table_name='business_chat_reads' then cid:=new.conversation_id;
  else
    if tg_op='DELETE' then mid:=old.message_id; else mid:=new.message_id; end if;
    select conversation_id into cid from public.messages where id=mid;
  end if;
  if private.is_business_chat(cid) then perform private.emit_business_chat_changed(cid,mid); end if;
  return null;
end;
$$;
create trigger business_chat_conversation_changed after insert or update of status on public.conversations for each row execute function private.broadcast_business_chat_change();
create trigger business_chat_message_changed after insert or update on public.messages for each row execute function private.broadcast_business_chat_change();
create trigger business_chat_read_changed after insert or update on private.business_chat_reads for each row execute function private.broadcast_business_chat_change();
create trigger business_chat_reaction_changed after insert or delete on private.business_chat_reactions for each row execute function private.broadcast_business_chat_change();
create policy "business chat own auth topic" on realtime.messages for select to authenticated
  using(extension='broadcast' and topic='business-chat:'||(select auth.uid())::text
    and (select private.is_active_account(auth.uid())));
-- Realtime's read authorization probe omits private; transport sends still use true.
create policy "business chat topic boundary" on realtime.messages as restrictive for select to anon,authenticated
  using(topic not like 'business-chat:%' or (extension='broadcast'
    and topic='business-chat:'||(select auth.uid())::text and (select private.is_active_account(auth.uid()))));
create policy "business chat clients cannot publish" on realtime.messages as restrictive for insert to anon,authenticated
  with check(topic not like 'business-chat:%');

-- Storage operation names verified against the installed helper and Storage routes.
do $$ begin
  if to_regprocedure('storage.allow_only_operation(text)') is null or to_regprocedure('storage.operation()') is null
    or position('storage.operation' in pg_get_functiondef('storage.operation()'::regprocedure))=0 then
    raise exception 'BUSINESS_CHAT_STORAGE_OPERATION_CONTRACT_REQUIRED'; end if;
end $$;
create function private.business_chat_path_conversation(p_path text) returns uuid
language sql immutable set search_path='' as $$
  select case when split_part(split_part(p_path,'/',2),'_',1) ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then split_part(split_part(p_path,'/',2),'_',1)::uuid end;
$$;
create function private.business_chat_media(p_path text,p_operation text) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.conversations; endpoint uuid; as_business uuid; audit_message public.messages;
begin
  if auth.uid() is null or not private.is_active_account(auth.uid()) then return false; end if;
  if p_path !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}_[0-9]+-[A-Za-z0-9]+\.webp$' then return false; end if;
  endpoint:=split_part(p_path,'/',1)::uuid;
  select * into c from public.conversations where id=private.business_chat_path_conversation(p_path) and kind='business';
  if c.id is null then return false; end if;
  if endpoint not in(coalesce(c.user_low_id,c.business_low_id),coalesce(c.user_high_id,c.business_high_id)) then return false; end if;
  if private.is_admin() and p_operation='get' then
    select * into audit_message from public.messages where conversation_id=c.id and (image_path=p_path or image_paths @> array[p_path]) limit 1;
    if audit_message.id is not null then
      perform public.log_admin_access('messages',audit_message.sender_id,audit_message.id);
      return true;
    end if;
    return private.can_read_retained_chat_image('chat-images',p_path);
  end if;
  if endpoint in(c.business_low_id,c.business_high_id) and private.business_chat_can_use(auth.uid(),endpoint) then as_business:=endpoint;
  elsif auth.uid() in(c.user_low_id,c.user_high_id) then as_business:=null;
  elsif c.business_low_id is not null and private.business_chat_can_use(auth.uid(),c.business_low_id) then as_business:=c.business_low_id;
  elsif c.business_high_id is not null and private.business_chat_can_use(auth.uid(),c.business_high_id) then as_business:=c.business_high_id;
  else return false; end if;
  begin c:=private.lock_business_chat(c.id,as_business); exception when sqlstate 'P0001' then return false; end;
  if p_operation='get' then
    return exists(select 1 from public.messages m where m.conversation_id=c.id and (m.image_path=p_path or m.image_paths @> array[p_path])
      and private.business_chat_message_visible(m,auth.uid(),as_business))
      or (endpoint=coalesce(as_business,auth.uid()) and exists(select 1 from storage.objects where bucket_id='chat-images' and name=p_path and owner_id=auth.uid()::text)
        and not exists(select 1 from public.messages where image_path=p_path or image_paths @> array[p_path])
        and not exists(select 1 from private.message_history where original->>'image_path'=p_path or original->'image_paths' @> to_jsonb(array[p_path])));
  end if;
  if c.status<>'active' or endpoint<>coalesce(as_business,auth.uid()) then return false; end if;
  if p_operation='upload' then return true; end if;
  return p_operation='delete' and private.can_remove_unsent_chat_image(p_path);
end;
$$;
create policy "current endpoint uploads business chat media" on storage.objects for insert to authenticated
  with check(bucket_id='chat-images' and private.is_business_chat(private.business_chat_path_conversation(name)) and private.business_chat_media(name,'upload'));
create policy "business chat uploads require current authenticated operation" on storage.objects as restrictive for insert to anon,authenticated
  with check(bucket_id<>'chat-images' or not private.is_business_chat(private.business_chat_path_conversation(name))
    or (storage.allow_only_operation('storage.object.upload') and private.business_chat_media(name,'upload')));
create policy "current endpoint reads business chat media" on storage.objects for select to authenticated
  using(bucket_id='chat-images' and private.is_business_chat(private.business_chat_path_conversation(name)) and private.business_chat_media(name,'get'));
create policy "current endpoint removes unsent business chat media" on storage.objects for delete to authenticated
  using(bucket_id='chat-images' and owner_id=(select auth.uid())::text and private.is_business_chat(private.business_chat_path_conversation(name)) and private.business_chat_media(name,'delete'));
create policy "business chat media cannot expose storage metadata" on storage.objects as restrictive for select to anon,authenticated
  using(bucket_id<>'chat-images' or not private.is_business_chat(private.business_chat_path_conversation(name)) or (
    storage.allow_only_operation('storage.object.get_authenticated') and private.business_chat_media(name,'get'))
    or (storage.allow_any_operation(array['storage.object.delete','storage.object.delete_many'])
      and owner_id=(select auth.uid())::text and private.business_chat_media(name,'delete')));
create policy "business chat uploader cannot bypass revocation" on storage.objects as restrictive for delete to anon,authenticated
  using(bucket_id<>'chat-images' or not private.is_business_chat(private.business_chat_path_conversation(name)) or private.business_chat_media(name,'delete'));
create function private.business_chat_notification_visible(n public.notifications) returns boolean
language sql stable security definer set search_path='' as $$
  select n.kind='message' and n.target_type='message' and exists(select 1 from public.messages m
    where m.id=n.target_id and private.is_business_chat(m.conversation_id)
      and m.sender_business_id is not distinct from n.actor_business_id
      and (case when m.sender_business_id is null then n.actor_id=m.sender_id else n.actor_id is null end)
      and private.business_chat_access(m.conversation_id,n.user_id,n.recipient_business_id)
      and private.business_chat_message_visible(m,n.user_id,n.recipient_business_id));
$$;
create function private.notify_business_chat_message() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient record;
begin
  if not private.is_business_chat(new.conversation_id) then return new; end if;
  for recipient in select * from private.business_chat_recipients(new.conversation_id) loop
    if coalesce(recipient.business_id,recipient.user_id)=coalesce(new.sender_business_id,new.sender_id)
      or recipient.user_id=new.sender_id then continue; end if;
    perform 1 from public.profiles where id=recipient.user_id for share;
    perform 1 from auth.users where id=recipient.user_id for share;
    if not private.business_chat_access(new.conversation_id,recipient.user_id,recipient.business_id)
      or not private.business_chat_message_visible(new,recipient.user_id,recipient.business_id) then continue; end if;
    insert into public.notifications(user_id,kind,actor_id,actor_business_id,recipient_business_id,target_type,target_id,body,route)
      values(recipient.user_id,'message',case when new.sender_business_id is null then new.sender_id end,new.sender_business_id,
        recipient.business_id,'message',new.id,'메시지가 도착했어요.','/chat?conversationId='||new.conversation_id::text
          ||case when recipient.business_id is null then '' else '&businessId='||recipient.business_id::text end);
  end loop;
  return new;
end;
$$;
create trigger business_chat_notifications after insert on public.messages for each row execute function private.notify_business_chat_message();

-- Patch only the business branch; existing recommendation, consent and push leases remain intact.
do $$
declare definition text; anchor text; signature text;
begin
  definition:=pg_get_functiondef('private.notification_target_visible(uuid,text,uuid)'::regprocedure);
  anchor:='when ''message'' then exists (';
  if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_NOTIFICATION_TARGET_ANCHOR'; end if;
  execute replace(definition,anchor,$branch$when 'message' then exists(select 1 from public.messages bm
    cross join lateral private.business_chat_recipients(bm.conversation_id) recipient
    where bm.id=p_target_id and recipient.user_id=p_user_id
      and private.business_chat_message_visible(bm,p_user_id,recipient.business_id)) or exists ($branch$);
  definition:=pg_get_functiondef('private.can_read_notification(public.notifications)'::regprocedure);
  anchor:='and private.notification_city_matches(n)';
  if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_NOTIFICATION_READ_ANCHOR'; end if;
  execute replace(definition,anchor,anchor||' and (n.target_type<>''message'' or not private.is_business_message(n.target_id) or private.business_chat_notification_visible(n))');
  foreach signature in array array['private.push_notification_eligible(uuid,uuid)','public.claim_push_notifications(text,integer)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    anchor:='m.sender_id=n.actor_id';
    if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_PUSH_ACTOR_ANCHOR: %',signature; end if;
    definition:=replace(definition,anchor,'(m.sender_id=n.actor_id or (private.is_business_chat(m.conversation_id) and m.sender_business_id=n.actor_business_id and n.actor_id is null))');
    if signature like 'private.%' then
      anchor:='and n.read_at is null';
      if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_PUSH_CURRENT_ANCHOR'; end if;
      definition:=replace(definition,anchor,anchor||' and (n.target_type<>''message'' or not private.is_business_message(n.target_id) or private.business_chat_notification_visible(n))');
    else
      anchor:='private.can_read_message(m.conversation_id,n.user_id,m.sender_id,m.created_at)';
      if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_PUSH_READ_ANCHOR'; end if;
      definition:=replace(definition,anchor,'('||anchor||' or private.business_chat_notification_visible(n))');
      anchor:='sender.nickname::text||'': ''||case m.kind';
      if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_PUSH_NAME_ANCHOR'; end if;
      definition:=replace(definition,anchor,'(case when m.sender_business_id is null then sender.nickname::text else (select b.name from private.merchants b where b.id=m.sender_business_id) end)||'': ''||case m.kind');
      anchor:='''/chat?conversationId=''||m.conversation_id::text';
      if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_PUSH_ROUTE_ANCHOR'; end if;
      definition:=replace(definition,anchor,anchor||'||case when n.recipient_business_id is null then '''' else ''&businessId=''||n.recipient_business_id::text end');
    end if;
    execute definition;
  end loop;
end;
$$;

create or replace function public.get_merchant_profile(p_merchant_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select profile||jsonb_build_object(
    'avatar_path',case when profile->>'avatar_path' is not null then 'business-profile/'||p_merchant_id::text||'/avatar/'||md5(profile->>'avatar_path') end,
    'banner_path',case when profile->>'banner_path' is not null then 'business-profile/'||p_merchant_id::text||'/banner/'||md5(profile->>'banner_path') end,
    'can_message',false,
    'can_business_message',auth.uid() is not null and private.business_chat_can_use(auth.uid(),null)
      and private.business_chat_business_ready(m.id)
      and not private.is_blocked_between(auth.uid(),m.owner_id) and not private.has_reported(auth.uid(),'user',m.owner_id))
  from (select private.business_base_get_merchant_profile(p_merchant_id) profile)x
  join private.merchants m on m.id=p_merchant_id and m.record_kind='business' and m.deleted_at is null
    and m.consent='granted' and m.status<>'paused'
  where profile is not null and not exists(select 1 from public.profiles where id=m.id)
    and not exists(select 1 from private.business_blocks where user_id=auth.uid() and business_id=m.id);
$$;

-- Retain business evidence on personal account deletion; private actor rows remain pseudonymized.
do $$
declare definition text; anchor text; report_query text; protected_query text;
begin
  definition:=pg_get_functiondef('private.purge_account_data(text)'::regprocedure);
  anchor:='where current_user_id in (user_low_id, user_high_id) or group_post_id=any(owned_post_ids)';
  if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_PURGE_CONVERSATIONS_ANCHOR'; end if;
  definition:=replace(definition,anchor,'where kind<>''business'' and (current_user_id in (user_low_id, user_high_id) or group_post_id=any(owned_post_ids))');
  anchor:='  from public.messages where conversation_id = any(conversation_ids) or sender_id=current_user_id';
  if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_PURGE_EVIDENCE_ANCHOR'; end if;
  definition:=replace(definition,anchor,'  from public.messages where (conversation_id = any(conversation_ids) or sender_id=current_user_id) and not private.is_business_chat(conversation_id)');
  anchor:='delete from public.messages where conversation_id = any(conversation_ids) or sender_id=current_user_id;';
  if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_PURGE_MESSAGES_ANCHOR'; end if;
  definition:=replace(definition,anchor,'delete from public.messages where (conversation_id = any(conversation_ids) or sender_id=current_user_id) and not private.is_business_chat(conversation_id);');
  anchor:='from public.reports'||chr(10)||'  where current_user_id in (reporter_id, reported_user_id)';
  if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_PURGE_REPORTS_ANCHOR'; end if;
  report_query:=substring(definition from position(anchor in definition) for position(';' in substring(definition from position(anchor in definition))));
  protected_query:=replace(report_query,'  where ','  where not (target_type=''message'' and private.is_business_message(target_id)) and (');
  definition:=replace(definition,report_query,left(protected_query,length(protected_query)-1)||');');
  execute definition;
  definition:=pg_get_functiondef('public.account_image_cleanup_paths(uuid,text,text[])'::regprocedure);
  anchor:='elsif p_bucket=''merchant-profile-images'' then';
  if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_ACCOUNT_MEDIA_ANCHOR'; end if;
  execute replace(definition,anchor,$retain$elsif p_bucket='chat-images' then
    bound:=private.is_business_chat(private.business_chat_path_conversation(path)) and (
      exists(select 1 from public.messages where image_path=path or image_paths @> array[path])
      or exists(select 1 from private.message_history where original->>'image_path'=path or original->'image_paths' @> to_jsonb(array[path])));
    $retain$||anchor);
  definition:=pg_get_functiondef('private.close_inactive_relationships()'::regprocedure);
  anchor:='where kind=''direct'' and new.id in (user_low_id,user_high_id)';
  if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_INACTIVE_ACCOUNT_ANCHOR'; end if;
  execute replace(definition,anchor,'where kind in (''direct'',''business'') and new.id in (user_low_id,user_high_id)');
end;
$$;

-- Default EXECUTE is revoked from every new function, including internal helpers.
do $$
declare item record;
begin
  for item in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and (p.proname like '%business_chat%' or p.proname in ('is_business_message')))
      or (n.nspname='public' and p.proname in ('start_business_conversation','get_identity_conversation_inbox','get_business_chat_messages',
        'send_business_chat_message','edit_business_chat_message','delete_business_chat_message','mark_business_chat_read','set_business_chat_reaction',
        'report_business_chat_message','end_business_conversation','block_business_conversation'))
  loop
    execute 'alter function '||item.signature||' owner to postgres';
    execute 'revoke all on function '||item.signature||' from public,anon,authenticated,service_role';
    if item.nspname='public' then execute 'grant execute on function '||item.signature||' to authenticated'; end if;
  end loop;
  for item in select c.oid::regclass signature from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname in ('business_chat_reads','business_chat_reactions','business_chat_blocks','business_chat_sends')
  loop execute 'alter table '||item.signature||' owner to postgres'; end loop;
end;
$$;
-- Policy-only helpers never return an actor, row, or business membership list.
grant execute on function private.is_business_chat(uuid),private.is_business_message(uuid),private.business_chat_path_conversation(text),
  private.business_chat_media(text,text) to authenticated;
grant execute on function private.is_business_chat(uuid),private.is_business_message(uuid),private.business_chat_path_conversation(text) to anon;
notify pgrst,'reload schema';
