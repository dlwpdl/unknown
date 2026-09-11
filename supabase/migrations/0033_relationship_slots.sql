-- Consent and concurrent relationship slots. Credit SQL is deferred, not deployed.
-- Existing direct rooms retain their history and active status. Unknown legacy
-- initiators stay NULL; we never invent consent or assign a retroactive penalty.
alter table public.conversations
  alter column user_low_id drop not null,
  alter column user_high_id drop not null,
  drop constraint conversations_user_low_id_user_high_id_key,
  add column kind text not null default 'direct' check (kind in ('direct','group')),
  add column status text not null default 'active' check (status in ('pending','active','ended','rejected','cancelled')),
  add column requester_id uuid references public.profiles(id),
  add column group_post_id uuid unique references public.posts(id),
  add column accepted_at timestamptz,
  add column ended_at timestamptz,
  add constraint conversation_kind_members check (
    (kind='direct' and user_low_id is not null and user_high_id is not null and group_post_id is null
      and (requester_id is null or requester_id in (user_low_id,user_high_id)))
    or (kind='group' and user_low_id is null and user_high_id is null and group_post_id is not null and requester_id is null)
  );
update public.conversations set status='ended',ended_at=now()
  where private.is_blocked_between(user_low_id,user_high_id)
    or not private.is_active_account(user_low_id) or not private.is_active_account(user_high_id);
create unique index conversations_open_pair on public.conversations(user_low_id,user_high_id)
  where kind='direct' and status in ('pending','active');

create table private.relationship_cooldowns (
  user_id uuid not null references public.profiles(id),
  pool text not null check(pool in ('direct','group')),
  relationship_id uuid not null,
  unlocks_at timestamptz not null,
  primary key(user_id,pool,relationship_id)
);
create index relationship_cooldowns_user_expiry on private.relationship_cooldowns(user_id,pool,unlocks_at);
revoke all on private.relationship_cooldowns from public,anon,authenticated;

create function private.lock_relationships()
returns void language sql security definer set search_path='' as $$
  -- ponytail: one launch-scale mutation lock; use ordered per-member locks if contention grows.
  select pg_advisory_xact_lock(810033);
$$;
create function private.lock_relationship_statement()
returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.lock_relationships(); return null; end;
$$;
-- Statement locks precede row locks, including direct post status updates and blocks.
create trigger relationships_lock before insert or delete or update of status,room_preview on public.posts
  for each statement execute function private.lock_relationship_statement();
create trigger relationships_lock before insert or update or delete on public.meetup_requests
  for each statement execute function private.lock_relationship_statement();
create trigger relationships_lock before insert or update or delete on public.conversations
  for each statement execute function private.lock_relationship_statement();
create trigger relationships_lock before insert or delete on public.blocks
  for each statement execute function private.lock_relationship_statement();

create function private.relationship_locked_count(p_user_id uuid,p_pool text)
returns integer language sql stable security definer set search_path='' as $$
  select count(*)::integer from private.relationship_cooldowns
  where user_id=p_user_id and pool=p_pool and unlocks_at>now();
$$;
create function private.direct_slot_count(p_user_id uuid)
returns integer language sql stable security definer set search_path='' as $$
  select count(*)::integer from public.conversations where kind='direct' and status='active'
    and p_user_id in (user_low_id,user_high_id);
$$;
create or replace function private.check_meetup_slot(p_user_id uuid,p_error text default 'MEETUP_LIMIT_REACHED')
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_relationships();
  if private.membership_meetup_count(p_user_id)+private.relationship_locked_count(p_user_id,'group')
    >=(private.membership_details(p_user_id)->>'meetupLimit')::integer then raise exception '%',p_error; end if;
end;
$$;
create or replace function private.guard_meetup_membership()
returns trigger language plpgsql security definer set search_path='' as $$
declare participant uuid;
begin
  if tg_table_name='posts' then
    if tg_op='UPDATE' and coalesce(old.room_preview->>'closed','false')='true'
      and coalesce(new.room_preview->>'closed','false')<>'true' then raise exception 'MEETUP_CLOSED'; end if;
    if new.status<>'published' or new.room_preview is null or coalesce(new.room_preview->>'closed','false')='true' then return new; end if;
    if tg_op='UPDATE' and old.status='published' and old.room_preview is not null
      and coalesce(old.room_preview->>'closed','false')<>'true' then return new; end if;
    for participant in select new.author_id union select requester_id from public.meetup_requests
      where post_id=new.id and status='approved' order by 1 loop
      perform private.check_meetup_slot(participant);
    end loop;
  else
    if new.status not in ('pending','approved') then return new; end if;
    if tg_op='UPDATE' and old.status=new.status then return new; end if;
    if exists(select 1 from public.posts where id=new.post_id and coalesce(room_preview->>'closed','false')='true') then raise exception 'MEETUP_CLOSED'; end if;
    perform private.assert_active_account(new.requester_id);
    -- Pending requests reserve nothing; approval rechecks actual capacity.
    if new.status='approved' then perform private.check_meetup_slot(new.requester_id,'REQUESTER_MEETUP_LIMIT_REACHED'); end if;
  end if;
  return new;
end;
$$;

create function private.sync_meetup_conversation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.room_preview is not null and new.status='published' and coalesce(new.room_preview->>'closed','false')<>'true' then
    insert into public.conversations(kind,group_post_id,status,accepted_at)
      values('group',new.id,'active',now()) on conflict(group_post_id) do update set status='active',ended_at=null;
  elsif tg_op='UPDATE' and old.room_preview is not null then
    if old.status='published' and coalesce(old.room_preview->>'closed','false')<>'true' and auth.uid()=old.author_id then
      insert into private.relationship_cooldowns values(old.author_id,'group',old.id,now()+interval '24 hours') on conflict do nothing;
    end if;
    update public.conversations set status='ended',ended_at=now() where group_post_id=new.id and status='active';
  end if;
  return new;
end;
$$;
create trigger posts_group_conversation after insert or update of status,room_preview on public.posts
  for each row execute function private.sync_meetup_conversation();
insert into public.conversations(kind,group_post_id,status,accepted_at)
  select 'group',id,'active',now() from public.posts where room_preview is not null and status='published'
    and coalesce(room_preview->>'closed','false')<>'true' on conflict(group_post_id) do nothing;

create function private.can_read_conversation(p_conversation_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.conversations c where c.id=p_conversation_id and (
    (c.kind='direct' and p_user_id in(c.user_low_id,c.user_high_id)) or
    (c.kind='group' and exists(select 1 from public.posts p where p.id=c.group_post_id and
      (p.author_id=p_user_id or exists(select 1 from public.meetup_requests r where r.post_id=p.id
        and r.requester_id=p_user_id and r.status='approved'))))));
$$;
create function private.can_read_message(p_conversation_id uuid,p_user_id uuid,p_sender_id uuid,p_created_at timestamptz,p_include_blocked boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.conversations c where c.id=p_conversation_id and
    c.status in ('active','ended') and private.can_read_conversation(c.id,p_user_id) and (
      c.kind='direct' or ((p_include_blocked or not private.is_blocked_between(p_user_id,p_sender_id)) and exists(
        select 1 from public.posts p where p.id=c.group_post_id and (p.author_id=p_user_id or exists(
          select 1 from public.meetup_requests r where r.post_id=p.id and r.requester_id=p_user_id
            and r.status='approved' and p_created_at>=coalesce(r.responded_at,r.created_at)))))));
$$;
drop policy "participants and admins read conversations" on public.conversations;
create policy "participants and admins read conversations" on public.conversations for select to authenticated
  using ((select private.is_admin()) or private.can_read_conversation(id,(select auth.uid())));
drop policy "participants and admins read messages" on public.messages;
create policy "participants and admins read messages" on public.messages for select to authenticated
  using ((select private.is_admin()) or private.can_read_message(conversation_id,(select auth.uid()),sender_id,created_at));

create or replace function public.get_membership()
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); day date; details jsonb; groups integer; directs integer; gl integer; dl integer;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select (now() at time zone c.timezone)::date into day from public.profiles p join public.cities c on c.id=p.city_id where p.id=u;
  details:=private.membership_details(u); groups:=private.membership_meetup_count(u); directs:=private.direct_slot_count(u);
  gl:=private.relationship_locked_count(u,'group'); dl:=private.relationship_locked_count(u,'direct');
  return details||jsonb_build_object('postsUsed',(select count(*) from public.posts where author_id=u and posted_on=day),
    'meetupsUsed',groups,'conversationsUsed',directs,'conversationPeriod','active',
    'meetupSlotsLocked',gl,'meetupSlotsAvailable',greatest(0,(details->>'meetupLimit')::integer-groups-gl),
    'conversationSlotsLocked',dl,'conversationSlotsAvailable',greatest(0,(details->>'conversationLimit')::integer-directs-dl),
    'meetupUnlocksAt',coalesce((select jsonb_agg(unlocks_at order by unlocks_at) from private.relationship_cooldowns where user_id=u and pool='group' and unlocks_at>now()),'[]'::jsonb),
    'conversationUnlocksAt',coalesce((select jsonb_agg(unlocks_at order by unlocks_at) from private.relationship_cooldowns where user_id=u and pool='direct' and unlocks_at>now()),'[]'::jsonb));
end;
$$;

create or replace function public.start_conversation(other_user_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); c public.conversations; low_id uuid; high_id uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if u=other_user_id then raise exception 'INVALID_RECIPIENT'; end if;
  if not private.is_active_account(other_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  if private.is_blocked_between(u,other_user_id) then raise exception 'BLOCKED'; end if;
  perform private.lock_relationships(); low_id:=least(u,other_user_id); high_id:=greatest(u,other_user_id);
  update public.conversations set status='cancelled',ended_at=created_at where kind='direct' and status='pending'
    and user_low_id=low_id and user_high_id=high_id and created_at<=now()-interval '7 days';
  select * into c from public.conversations where kind='direct' and user_low_id=low_id and user_high_id=high_id and status in ('active','pending');
  if c.id is not null then return c.id; end if;
  -- Anti-spam request pacing is separate from active relationship capacity.
  if exists(select 1 from public.conversations where kind='direct' and user_low_id=low_id and user_high_id=high_id
    and status in ('rejected','cancelled') and ended_at>now()-interval '24 hours') then raise exception 'REQUEST_COOLDOWN'; end if;
  if (select count(*) from public.conversations where requester_id=u and status='pending' and created_at>now()-interval '7 days')>=20 then raise exception 'PENDING_REQUEST_LIMIT'; end if;
  perform private.enforce_rate_limit('conversation_request',20,interval '1 hour',interval '30 seconds');
  insert into public.conversations(user_low_id,user_high_id,requester_id,status) values(low_id,high_id,u,'pending') returning * into c;
  perform private.create_notification(other_user_id,'message',u,'user',u,
    (select nickname::text from public.profiles where id=u)||'님이 1:1 대화를 요청했어요. 수락 후 대화가 시작돼요.','/chat?conversationId='||c.id::text);
  return c.id;
end;
$$;

create function public.get_admin_user_conversations(p_user_id uuid)
returns setof public.conversations language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('conversations',p_user_id,null);
  return query select c.* from public.conversations c where p_user_id in(c.user_low_id,c.user_high_id)
    or exists(select 1 from public.posts p where p.id=c.group_post_id and p.author_id=p_user_id)
    or exists(select 1 from public.meetup_requests r where r.post_id=c.group_post_id and r.requester_id=p_user_id)
    or exists(select 1 from public.messages m where m.conversation_id=c.id and m.sender_id=p_user_id)
    order by c.created_at desc limit 100;
end;
$$;
revoke all on function public.get_admin_user_conversations(uuid) from public,anon,authenticated;
grant execute on function public.get_admin_user_conversations(uuid) to authenticated;

create function public.respond_direct_conversation(p_conversation_id uuid,p_response text)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); c public.conversations; participant uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u); perform private.lock_relationships();
  if p_response is null or p_response not in ('accepted','rejected','cancelled') then raise exception 'INVALID_RESPONSE'; end if;
  select * into c from public.conversations where id=p_conversation_id and kind='direct' and u in(user_low_id,user_high_id) for update;
  if c.id is null then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if (p_response='cancelled' and u<>c.requester_id) or (p_response<>'cancelled' and u=c.requester_id) then raise exception 'RECIPIENT_REQUIRED'; end if;
  if c.status='active' and p_response='accepted' then return c.id; end if;
  if c.status<>'pending' then raise exception 'REQUEST_ALREADY_RESOLVED'; end if;
  if p_response='accepted' then
    if c.created_at<=now()-interval '7 days' then raise exception 'REQUEST_EXPIRED'; end if;
    if private.is_blocked_between(c.user_low_id,c.user_high_id) then raise exception 'BLOCKED'; end if;
    foreach participant in array array[c.user_low_id,c.user_high_id] loop
      perform private.assert_active_account(participant);
      if private.direct_slot_count(participant)+private.relationship_locked_count(participant,'direct') >=
        (private.membership_details(participant)->>'conversationLimit')::integer then
        if participant=u then raise exception 'CONVERSATION_LIMIT_REACHED'; else raise exception 'OTHER_CONVERSATION_LIMIT_REACHED'; end if;
      end if;
    end loop;
    update public.conversations set status='active',accepted_at=now() where id=c.id;
    perform private.create_notification(c.requester_id,'message',u,'user',u,'1:1 대화 요청이 수락됐어요.','/chat?conversationId='||c.id::text);
    return c.id;
  end if;
  update public.conversations set status=p_response,ended_at=now() where id=c.id;
  return null;
end;
$$;

create function private.finish_direct_conversation(p_conversation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.conversations;
begin
  perform private.lock_relationships();
  select * into c from public.conversations where id=p_conversation_id and kind='direct' for update;
  if c.status='active' then
    update public.conversations set status='ended',ended_at=now() where id=c.id;
    if c.requester_id is not null then
      insert into private.relationship_cooldowns values(c.requester_id,'direct',c.id,now()+interval '24 hours') on conflict do nothing;
    end if;
  elsif c.status='pending' then
    update public.conversations set status='cancelled',ended_at=now() where id=c.id;
  end if;
end;
$$;

create or replace function public.leave_meetup(p_post_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); p public.posts; r public.meetup_requests;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Leaving remains possible even for restricted accounts.
  perform private.lock_relationships();
  select * into p from public.posts where id=p_post_id and room_preview is not null for update;
  if p.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if p.author_id=u then
    if coalesce(p.room_preview->>'closed','false')='true' then return; end if;
    update public.posts set room_preview=jsonb_set(room_preview,'{closed}','true') where id=p.id;
    update public.meetup_requests set status='cancelled',responded_at=now() where post_id=p.id and status in ('pending','approved');
  else
    select * into r from public.meetup_requests where post_id=p.id and requester_id=u for update;
    if r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
    if r.status='cancelled' then return; end if;
    if r.status not in ('approved','pending') then raise exception 'REQUEST_NOT_FOUND'; end if;
    if r.status='approved' and p.status='published' and coalesce(p.room_preview->>'closed','false')<>'true' then
      insert into private.relationship_cooldowns values(u,'group',p.id,now()+interval '24 hours')
        on conflict(user_id,pool,relationship_id) do update set unlocks_at=excluded.unlocks_at;
    end if;
    update public.meetup_requests set status='cancelled',responded_at=now() where id=r.id;
    update public.posts set room_preview=jsonb_set(room_preview,'{memberCount}',to_jsonb(1+(select count(*) from public.meetup_requests where post_id=p.id and status='approved'))) where id=p.id;
  end if;
end;
$$;
create function public.end_conversation(p_conversation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); c public.conversations;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.lock_relationships();
  select * into c from public.conversations where id=p_conversation_id;
  if c.id is null or not private.can_read_conversation(c.id,u) then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if c.kind='group' then perform public.leave_meetup(c.group_post_id);
  else perform private.finish_direct_conversation(c.id); end if;
end;
$$;
create function private.end_blocked_conversations()
returns trigger language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
  for c in select id from public.conversations where kind='direct' and status in ('active','pending')
    and user_low_id=least(new.blocker_id,new.blocked_id) and user_high_id=greatest(new.blocker_id,new.blocked_id) loop
    perform private.finish_direct_conversation(c);
  end loop;
  return new;
end;
$$;
create trigger blocks_end_direct after insert on public.blocks for each row execute function private.end_blocked_conversations();

create or replace function public.respond_meetup_request(p_request_id uuid,p_response text)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r public.meetup_requests; p public.posts; room_id uuid; approved_count integer;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u); perform private.lock_relationships();
  if p_response is null or p_response not in ('approved','rejected') then raise exception 'INVALID_RESPONSE'; end if;
  select * into r from public.meetup_requests where id=p_request_id and host_id=u for update;
  if r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status<>'pending' then raise exception 'REQUEST_ALREADY_RESOLVED'; end if;
  select * into p from public.posts where id=r.post_id and status='published' for update;
  if p.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if coalesce(p.room_preview->>'closed','false')='true' then raise exception 'MEETUP_CLOSED'; end if;
  if p_response='approved' then
    if private.is_blocked_between(u,r.requester_id) then raise exception 'BLOCKED'; end if;
    select count(*) into approved_count from public.meetup_requests where post_id=p.id and status='approved';
    if approved_count+1>=coalesce((p.room_preview->>'capacity')::integer,8) then raise exception 'MEETUP_FULL'; end if;
    update public.meetup_requests set status='approved',responded_at=now() where id=r.id;
    select id into room_id from public.conversations where group_post_id=p.id and status='active';
    if room_id is null then raise exception 'CONVERSATION_NOT_FOUND'; end if;
    update public.posts set room_preview=jsonb_set(room_preview,'{memberCount}',to_jsonb(approved_count+2)) where id=p.id;
    perform private.create_notification(r.requester_id,'meetup_approved',u,'meetup_request',r.id,
      '모임 참여 요청이 승인됐어요. 모임 대화에서 함께 이야기해요.','/chat?conversationId='||room_id::text);
  else
    update public.meetup_requests set status='rejected',responded_at=now() where id=r.id;
    perform private.create_notification(r.requester_id,'meetup_rejected',u,'meetup_request',r.id,
      '이번 모임 참여 요청은 승인되지 않았어요.','/post/'||r.post_id::text);
  end if;
  return room_id;
end;
$$;

create or replace function public.send_message(conversation_id uuid,message_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); c public.conversations; other_id uuid; message_id uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if char_length(trim(coalesce(message_body,''))) not between 1 and 2000 then raise exception 'INVALID_MESSAGE'; end if;
  perform private.lock_relationships();
  select * into c from public.conversations where id=conversation_id;
  if c.id is null or not private.can_read_conversation(c.id,u) then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if c.status<>'active' then raise exception 'CONVERSATION_NOT_ACTIVE'; end if;
  if c.kind='direct' then
    other_id:=case when c.user_low_id=u then c.user_high_id else c.user_low_id end;
    if not private.is_active_account(other_id) then raise exception 'USER_NOT_FOUND'; end if;
    if private.is_blocked_between(u,other_id) then raise exception 'BLOCKED'; end if;
  elsif not exists(select 1 from public.posts where id=c.group_post_id and status='published' and coalesce(room_preview->>'closed','false')<>'true') then
    raise exception 'MEETUP_CLOSED';
  end if;
  perform private.enforce_rate_limit('message',30,interval '1 minute',interval '1 second');
  insert into public.messages(conversation_id,sender_id,body) values(c.id,u,trim(message_body)) returning id into message_id;
  -- Existing all-message safety review trigger covers both kinds of room.
  return message_id;
end;
$$;
create or replace function private.notify_message()
returns trigger language plpgsql security definer set search_path='' as $$
declare c public.conversations; recipient uuid; nickname text;
begin
  select * into c from public.conversations where id=new.conversation_id;
  select p.nickname::text into nickname from public.profiles p where p.id=new.sender_id;
  for recipient in
    select c.user_low_id where c.kind='direct' union select c.user_high_id where c.kind='direct'
    union select author_id from public.posts where id=c.group_post_id
    union select requester_id from public.meetup_requests where post_id=c.group_post_id and status='approved'
  loop
    if recipient<>new.sender_id and private.is_active_account(recipient) and not private.is_blocked_between(recipient,new.sender_id) then
      perform private.create_notification(recipient,'message',new.sender_id,'message',new.id,
        nickname||'님이 메시지를 보냈어요.','/chat?conversationId='||c.id::text);
    end if;
  end loop;
  return new;
end;
$$;

drop function public.get_conversation_previews(integer,timestamptz,uuid);
create function public.get_conversation_previews(p_limit integer default 30,p_before_created timestamptz default null,p_before_id uuid default null)
returns table(id uuid,other_user_id uuid,other_nickname text,other_verification_level smallint,latest_body text,latest_at timestamptz,
  kind text,status text,requester_id uuid,group_post_id uuid,title text,is_group_host boolean)
language sql stable security definer set search_path='' as $$
  select c.id,other_p.id,other_p.nickname::text,other_p.verification_level,latest.body,
    coalesce(latest.created_at,c.created_at),c.kind,c.status,c.requester_id,c.group_post_id,
    coalesce(p.title,other_p.nickname::text),coalesce(p.author_id=auth.uid(),false)
  from public.conversations c left join public.posts p on p.id=c.group_post_id
  left join public.profiles other_p on other_p.id=case when c.kind='group' then p.author_id
    when c.user_low_id=auth.uid() then c.user_high_id else c.user_low_id end
  left join lateral(select m.body,m.created_at from public.messages m where m.conversation_id=c.id
    and private.can_read_message(c.id,auth.uid(),m.sender_id,m.created_at) order by m.created_at desc,m.id desc limit 1) latest on true
  where private.is_active_account(auth.uid()) and private.can_read_conversation(c.id,auth.uid())
    and c.status in ('active','pending','ended') and (c.status<>'pending' or c.created_at>now()-interval '7 days')
    and (p_before_created is null or (coalesce(latest.created_at,c.created_at),c.id)<(p_before_created,p_before_id))
  order by coalesce(latest.created_at,c.created_at) desc,c.id desc limit greatest(1,least(coalesce(p_limit,30),50));
$$;

-- Every helper is private; only self-scoped RPCs and RLS predicates are executable by clients.
revoke all on function private.lock_relationships(),private.lock_relationship_statement(),
  private.relationship_locked_count(uuid,text),private.direct_slot_count(uuid),private.sync_meetup_conversation(),
  private.finish_direct_conversation(uuid),private.end_blocked_conversations(),
  private.can_read_conversation(uuid,uuid),private.can_read_message(uuid,uuid,uuid,timestamptz,boolean) from public,anon,authenticated;
grant execute on function private.can_read_conversation(uuid,uuid),private.can_read_message(uuid,uuid,uuid,timestamptz,boolean) to authenticated;
revoke all on function public.respond_direct_conversation(uuid,text),public.end_conversation(uuid),public.get_conversation_previews(integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.respond_direct_conversation(uuid,text),public.end_conversation(uuid),public.get_conversation_previews(integer,timestamptz,uuid) to authenticated;

-- Preserve the existing request validation, reporting, and account purge paths.
create or replace function public.request_meetup_join(p_post_id uuid, p_message text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  meetup public.posts;
  request public.meetup_requests;
  requester_level smallint;
  capacity integer;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  perform private.lock_relationships();
  if char_length(trim(coalesce(p_message, ''))) > 300 then raise exception 'INVALID_REQUEST_MESSAGE'; end if;

  select * into meetup from public.posts
  where id = p_post_id and status = 'published' and room_preview is not null
  for update;
  if meetup is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if coalesce(meetup.room_preview->>'closed','false')='true' then raise exception 'MEETUP_CLOSED'; end if;
  if meetup.author_id = current_user_id then raise exception 'OWN_MEETUP'; end if;
  if private.is_blocked_between(current_user_id, meetup.author_id) then raise exception 'BLOCKED'; end if;
  select verification_level into requester_level from public.profiles where id = current_user_id;
  if coalesce((meetup.room_preview ->> 'verifiedOnly')::boolean, false) and requester_level < 2 then
    raise exception 'VERIFICATION_REQUIRED';
  end if;

  select * into request from public.meetup_requests
  where post_id = p_post_id and requester_id = current_user_id;
  if request.id is not null then
    if request.status in ('pending', 'approved') then return request.id; end if;
    if coalesce(request.responded_at,request.created_at) > now() - interval '24 hours' then raise exception 'REQUEST_COOLDOWN'; end if;
  end if;

  capacity := coalesce((meetup.room_preview ->> 'capacity')::integer, 8);
  if 1 + (select count(*) from public.meetup_requests where post_id = p_post_id and status = 'approved') >= capacity then
    raise exception 'MEETUP_FULL';
  end if;
  perform private.enforce_rate_limit('meetup_request', 5, interval '1 day', interval '60 seconds');

  insert into public.meetup_requests (post_id, host_id, requester_id, message)
  values (p_post_id, meetup.author_id, current_user_id, trim(coalesce(p_message, '')))
  on conflict (post_id, requester_id) do update
  set status = 'pending', message = excluded.message, created_at = now(), responded_at = null
  returning * into request;

  perform private.create_notification(
    meetup.author_id, 'meetup_request', current_user_id, 'meetup_request', request.id,
    (select nickname::text from public.profiles where id = current_user_id) || '님이 모임 참여를 요청했어요.',
    '/chat?requestId=' || request.id::text
  );
  return request.id;
end;
$$;


create or replace function public.create_report(
  target_type text,
  target_id uuid,
  reason_code text,
  details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_user_id uuid;
  report_id uuid;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  if reason_code not in ('spam', 'harassment', 'hate', 'sexual', 'privacy', 'other') then raise exception 'INVALID_REASON'; end if;
  if char_length(coalesce(details, '')) > 1000 then raise exception 'INVALID_DETAILS'; end if;

  case target_type
    when 'user' then select id into target_user_id from public.profiles where id = target_id;
    when 'post' then
      select author_id into target_user_id from public.posts
      where id = target_id and (private.is_admin() or (status = 'published' and not private.is_blocked_between(current_user_id, author_id)));
    when 'comment' then
      select comment.author_id into target_user_id
      from public.comments as comment join public.posts as post on post.id = comment.post_id
      where comment.id = target_id and (private.is_admin() or (comment.deleted_at is null and post.status = 'published' and not private.is_blocked_between(current_user_id, comment.author_id)));
    when 'message' then
      select message.sender_id into target_user_id
      from public.messages as message join public.conversations as conversation on conversation.id = message.conversation_id
      where message.id = target_id and (private.is_admin() or private.can_read_message(conversation.id,current_user_id,message.sender_id,message.created_at,true));
    else raise exception 'INVALID_TARGET_TYPE';
  end case;
  if target_user_id is null then raise exception 'TARGET_NOT_FOUND'; end if;
  if target_user_id = current_user_id then raise exception 'CANNOT_REPORT_SELF'; end if;
  perform private.enforce_rate_limit('report', 20, interval '1 day', interval '5 seconds');
  insert into public.reports (reporter_id, reported_user_id, target_type, target_id, reason_code, details)
  values (current_user_id, target_user_id, target_type, target_id, reason_code, nullif(trim(details), ''))
  returning id into report_id;
  return report_id;
end;
$$;


create or replace function private.purge_account_data(p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  owned_post_ids uuid[];
  affected_comment_ids uuid[];
  conversation_ids uuid[];
  conversation_message_ids uuid[];
  meetup_request_ids uuid[];
  affected_report_ids uuid[];
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_confirmation <> '탈퇴합니다' then raise exception 'CONFIRMATION_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  perform private.lock_relationships();
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':delete-account', 0));

  select coalesce(array_agg(id), '{}'::uuid[]) into owned_post_ids
  from public.posts where author_id = current_user_id;
  select coalesce(array_agg(id), '{}'::uuid[]) into affected_comment_ids
  from public.comments
  where author_id = current_user_id or post_id = any(owned_post_ids);
  select coalesce(array_agg(id), '{}'::uuid[]) into conversation_ids
  from public.conversations
  where current_user_id in (user_low_id, user_high_id) or group_post_id=any(owned_post_ids);
  select coalesce(array_agg(id), '{}'::uuid[]) into conversation_message_ids
  from public.messages where conversation_id = any(conversation_ids) or sender_id=current_user_id;
  select coalesce(array_agg(id), '{}'::uuid[]) into meetup_request_ids
  from public.meetup_requests
  where host_id = current_user_id
     or requester_id = current_user_id
     or post_id = any(owned_post_ids);
  select coalesce(array_agg(id), '{}'::uuid[]) into affected_report_ids
  from public.reports
  where current_user_id in (reporter_id, reported_user_id)
     or resolved_by = current_user_id
     or (target_type = 'user' and target_id = current_user_id)
     or (target_type = 'post' and target_id = any(owned_post_ids))
     or (target_type = 'comment' and target_id = any(affected_comment_ids))
     or (target_type = 'message' and target_id = any(conversation_message_ids));

  delete from public.notifications
  where current_user_id in (user_id, actor_id)
     or (target_type = 'user' and target_id = current_user_id)
     or (target_type = 'post' and target_id = any(owned_post_ids))
     or (target_type = 'comment' and target_id = any(affected_comment_ids))
     or (target_type = 'message' and target_id = any(conversation_message_ids))
     or (target_type = 'meetup_request' and target_id = any(meetup_request_ids));

  delete from public.safety_review_queue
  where (target_type = 'post' and target_id = any(owned_post_ids))
     or (target_type = 'comment' and target_id = any(affected_comment_ids))
     or (target_type = 'message' and target_id = any(conversation_message_ids));

  delete from public.moderation_actions
  where report_id = any(affected_report_ids) or actor_id = current_user_id;
  delete from public.reports where id = any(affected_report_ids);
  delete from public.admin_access_logs
  where actor_id = current_user_id or subject_user_id = current_user_id;
  delete from public.meetup_requests where id = any(meetup_request_ids);
  delete from public.blocks where current_user_id in (blocker_id, blocked_id);
  delete from private.action_rate_events where user_id = current_user_id;
  delete from private.ai_draft_usage where user_id = current_user_id;
  delete from private.relationship_cooldowns where user_id=current_user_id;

  delete from public.post_reactions
  where user_id = current_user_id or post_id = any(owned_post_ids);
  delete from public.comment_likes
  where user_id = current_user_id or comment_id = any(affected_comment_ids);

  update public.posts as post
  set view_count = greatest(0, post.view_count - 1)
  where post.author_id <> current_user_id
    and exists (
      select 1 from public.post_views as post_view
      where post_view.post_id = post.id and post_view.user_id = current_user_id
    );
  delete from public.post_views
  where user_id = current_user_id or post_id = any(owned_post_ids);

  update public.posts as post
  set share_count = greatest(0, post.share_count - 1)
  where post.author_id <> current_user_id
    and exists (
      select 1 from public.post_shares as post_share
      where post_share.post_id = post.id and post_share.user_id = current_user_id
    );
  delete from public.post_shares
  where user_id = current_user_id or post_id = any(owned_post_ids);

  update public.comments
  set deleted_at = now()
  where author_id = current_user_id
    and deleted_at is null
    and not (post_id = any(owned_post_ids));
  delete from public.comments where id = any(affected_comment_ids);

  delete from public.messages where conversation_id = any(conversation_ids) or sender_id=current_user_id;
  delete from public.conversations where id = any(conversation_ids);
  delete from public.posts where id = any(owned_post_ids);

  update public.profiles
  set nickname = '탈퇴회원_' || left(replace(current_user_id::text, '-', ''), 8),
      city_id = null,
      neighborhood = null,
      bio = null,
      avatar_path = null,
      verification_level = 1,
      daily_post_limit = 1,
      account_status = 'deleted',
      account_status_note = '사용자 직접 탈퇴',
      account_status_changed_at = now(),
      deleted_at = now(),
      updated_at = now()
  where id = current_user_id;
end;
$$;

-- Moderation/account deletion ends connections without penalizing passive members.
create function private.close_inactive_relationships()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.account_status<>old.account_status and new.account_status<>'active' then
    perform private.lock_relationships();
    update public.conversations set status=case when status='pending' then 'cancelled' else 'ended' end,ended_at=now()
      where kind='direct' and new.id in (user_low_id,user_high_id) and status in ('pending','active');
    update public.meetup_requests set status='cancelled',responded_at=now() where requester_id=new.id and status in ('approved','pending');
  end if;
  return new;
end;
$$;
create trigger profiles_relationship_lock before update of account_status on public.profiles
  for each statement execute function private.lock_relationship_statement();
create trigger profiles_close_relationships after update of account_status on public.profiles
  for each row execute function private.close_inactive_relationships();
revoke all on function private.close_inactive_relationships() from public,anon,authenticated;

create or replace function public.delete_my_account(p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_status text;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_confirmation <> '탈퇴합니다' then raise exception 'CONFIRMATION_REQUIRED'; end if;
  perform private.lock_relationships();
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':delete-account', 0));
  select account_status into current_status
  from public.profiles where id = current_user_id for update;
  if current_status = 'deleted' then return; end if;
  if current_status is distinct from 'active' then raise exception 'ACCOUNT_LOCKED'; end if;
  perform private.purge_account_data(p_confirmation);
end;
$$;

revoke all on function public.delete_my_account(text) from public, anon, authenticated;
grant execute on function public.delete_my_account(text) to authenticated;


-- create_post already owns the post quota/validation; only move this common lock
-- before its profile row lock to keep account deletion/creation ordering consistent.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.create_post(text,smallint,text,text,text[],text[],jsonb)'::regprocedure) into definition;
  if position('perform private.lock_relationships();' in definition)=0 then
    definition:=replace(definition,'perform private.assert_active_account(current_user_id);',
      'perform private.assert_active_account(current_user_id); perform private.lock_relationships();');
    execute definition;
  end if;
end;
$$;

-- These existing admin operations acquire row locks before writing relationship state.
do $$
declare signature text; definition text;
begin
  foreach signature in array array['public.set_account_status(uuid,text,text)','public.moderate_report(uuid,text,text)'] loop
    select pg_get_functiondef(signature::regprocedure) into definition;
    definition:=replace(definition,'if not private.is_admin() then raise exception ''ADMIN_REQUIRED''; end if;',
      'if not private.is_admin() then raise exception ''ADMIN_REQUIRED''; end if; perform private.lock_relationships();');
    execute definition;
  end loop;
end;
$$;
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='conversations') then
    alter publication supabase_realtime add table public.conversations;
  end if;
end; $$;

do $$
declare definition text;
begin
  select pg_get_functiondef('public.create_profile_with_consent(text,text,text,text)'::regprocedure) into definition;
  definition:=replace(definition,'if current_user_id is null then raise exception ''AUTH_REQUIRED''; end if;',
    'if current_user_id is null then raise exception ''AUTH_REQUIRED''; end if; perform private.lock_relationships();');
  execute definition;
end; $$;
