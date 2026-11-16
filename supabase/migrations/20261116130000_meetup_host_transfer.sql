-- Host transfer (owner 2026-11-15, confirmed 2026-11-16): a host hands a meetup to one of its approved members,
-- and it only moves when that member accepts. One pending offer per meetup; it ends after 7 days or when a one-time meetup starts.
--
-- What moves with the meetup: posts.author_id (so the chat, tools and tier limits follow), the host profile shown on the meetup,
-- every request row's host_id (pending applicants now wait for the new host), the host id on sessions that have not ended,
-- and the next-session automation. The previous host stays as a regular approved member: the receiver's request row is turned
-- into the previous host's row, so seats, capacity and join guards never see a leave-and-rejoin.
-- What stays: past sessions and their credit, loyalty/follows, private member notes, templates, dues marks, fee, partner line, staff
-- and the meetup's settings. Scheduled announcements the previous host wrote are cancelled; the new host sends their own.
-- Slots: the receiver already holds a slot for this meetup as an approved member and the previous host keeps theirs, so no slot changes.
-- Seats: the meetup's capacity must fit the receiver's own seat cap; their cap is never raised.
create table private.meetup_host_transfers (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  to_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check(status in('pending','accepted','declined','cancelled','expired')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  check(from_user_id<>to_user_id)
);
create unique index meetup_host_transfers_one_pending on private.meetup_host_transfers(post_id) where status='pending';
create index meetup_host_transfers_to_user on private.meetup_host_transfers(to_user_id) where status='pending';
create index meetup_host_transfers_from_user on private.meetup_host_transfers(from_user_id);
alter table private.meetup_host_transfers enable row level security;
revoke all on private.meetup_host_transfers from public,anon,authenticated,service_role;
alter table private.meetup_host_transfers owner to postgres;

alter table private.meetup_role_audit drop constraint meetup_role_audit_action_check;
alter table private.meetup_role_audit add constraint meetup_role_audit_action_check
  check(action in('cohost_invite','cohost_accept','cohost_decline','cohost_remove','waitlist_invite','transfer_offer','transfer_cancel','transfer_accept','transfer_decline'));

-- The error code that stops this person from taking the meetup over, or null. Offer, answer and the screens share it.
create function private.meetup_transfer_blocker(p_event public.posts,p_user_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare capacity integer:=(p_event.room_preview->>'capacity')::integer; policy jsonb;
begin
  if not private.meetup_tool_member(p_event.id,p_user_id) then return 'APPROVED_MEMBER_REQUIRED'; end if;
  -- Language exchange seats are split by side, and the host has no side to hand over.
  if p_event.room_preview ? 'languageExchange'
    or private.is_operated_character(p_event.author_id) is distinct from private.is_operated_character(p_user_id) then return 'TRANSFER_NOT_AVAILABLE'; end if;
  if capacity is not null and capacity>private.meetup_capacity_limit(p_user_id) then return 'TRANSFER_CAPACITY_EXCEEDED'; end if;
  policy:=private.meetup_policy(p_user_id);
  if policy->>'hostBlockedUntil' is not null
    or (p_event.room_preview->>'eventKind'='once' and policy->>'createBlockedUntil' is not null) then return 'TRANSFER_RECEIVER_RESTRICTED'; end if;
  return null;
end;
$$;

create function public.offer_meetup_host_transfer(p_post_id uuid,p_user_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; blocker text; ends timestamptz; transfer_id uuid; host_name text;
begin
  perform private.lock_relationships();
  event:=private.meetup_tool_context(p_post_id,u);
  if event.author_id<>u then raise exception 'HOST_REQUIRED'; end if;
  if p_user_id is null or p_user_id=u then raise exception 'APPROVED_MEMBER_REQUIRED'; end if;
  blocker:=private.meetup_transfer_blocker(event,p_user_id);
  if blocker is not null then raise exception '%',blocker; end if;
  -- The previous host stays on as a member, so they must be allowed to join meetups.
  perform private.assert_meetup_participation(u);
  update private.meetup_host_transfers set status='expired',responded_at=clock_timestamp()
    where post_id=event.id and status='pending' and expires_at<=clock_timestamp();
  if exists(select 1 from private.meetup_host_transfers where post_id=event.id and status='pending') then raise exception 'TRANSFER_ALREADY_PENDING'; end if;
  perform private.enforce_rate_limit('meetup_host_transfer',10,interval '1 day');
  ends:=least(clock_timestamp()+interval '7 days',
    case when event.room_preview->>'eventKind'='once' then
      case when (event.room_preview->>'startsAt')::timestamptz>clock_timestamp() then (event.room_preview->>'startsAt')::timestamptz
        else (event.room_preview->>'endsAt')::timestamptz end
    else 'infinity'::timestamptz end);
  insert into private.meetup_host_transfers(post_id,from_user_id,to_user_id,expires_at) values(event.id,u,p_user_id,ends) returning id into transfer_id;
  insert into private.meetup_role_audit(post_id,actor_id,action,target_id) values(event.id,u,'transfer_offer',p_user_id);
  select nickname::text into host_name from public.profiles where id=u;
  perform private.create_notification(p_user_id,'meetup_changed',u,'post',event.id,
    host_name||'님이 「'||left(event.title,60)||'」 모임의 호스트를 넘기고 싶어 해요. 수락하면 이 모임을 넘겨받아요.','/post/'||event.id::text);
  return transfer_id;
end;
$$;

create function public.cancel_meetup_host_transfer(p_post_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); offer private.meetup_host_transfers;
begin
  perform private.lock_relationships();
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  update private.meetup_host_transfers set status='cancelled',responded_at=clock_timestamp()
    where post_id=p_post_id and from_user_id=u and status='pending' returning * into offer;
  if offer.id is not null then insert into private.meetup_role_audit(post_id,actor_id,action,target_id) values(p_post_id,u,'transfer_cancel',offer.to_user_id); end if;
end;
$$;

create function public.respond_meetup_host_transfer(p_post_id uuid,p_accept boolean,p_consent_version text default null,p_profile_revision text default null) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; offer private.meetup_host_transfers; old_host uuid; blocker text;
  snapshot jsonb; revision text; req public.meetup_requests; old_profile jsonb; old_consent text; old_consented timestamptz;
  old_name text; new_name text; headline text; person record;
begin
  perform private.lock_relationships();
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_accept is null then raise exception 'INVALID_RESPONSE'; end if;
  select * into offer from private.meetup_host_transfers where post_id=p_post_id and to_user_id=u and status='pending' for update;
  if offer.id is null then raise exception 'TRANSFER_NOT_FOUND'; end if;
  if not p_accept then
    update private.meetup_host_transfers set status=case when offer.expires_at<=clock_timestamp() then 'expired' else 'declined' end,
      responded_at=clock_timestamp() where id=offer.id;
    if offer.expires_at>clock_timestamp() then
      insert into private.meetup_role_audit(post_id,actor_id,action,target_id) values(p_post_id,u,'transfer_decline',offer.from_user_id);
      select nickname::text into new_name from public.profiles where id=u;
      perform private.create_notification(offer.from_user_id,'meetup_changed',u,'post',p_post_id,
        new_name||'님이 「'||left((select title from public.posts where id=p_post_id),60)||'」 호스트를 넘겨받지 않기로 했어요. 모임은 그대로 열려 있어요.','/post/'||p_post_id::text);
    end if;
    return;
  end if;
  if offer.expires_at<=clock_timestamp() then raise exception 'TRANSFER_EXPIRED'; end if;
  -- Re-check everything now: the host, the receiver, blocks, reports, closing and the receiver's limits can all have changed.
  event:=private.meetup_tool_context(p_post_id,u);
  select * into event from public.posts where id=event.id for update;
  old_host:=event.author_id;
  if old_host<>offer.from_user_id then raise exception 'TRANSFER_NOT_FOUND'; end if;
  blocker:=private.meetup_transfer_blocker(event,u);
  if blocker is not null then raise exception '%',blocker; end if;
  perform private.assert_meetup_participation(old_host);
  select profile,updated_at::text into snapshot,revision from private.chilling_profiles where id=u for share;
  if snapshot is null then raise exception 'CHILLING_PROFILE_REQUIRED'; end if;
  if snapshot->'version'='2'::jsonb then
    if p_consent_version is distinct from 'chilling-v2' then raise exception 'CHILLING_HOST_CONSENT_REQUIRED'; end if;
    if p_profile_revision is distinct from revision then raise exception 'CHILLING_PROFILE_CHANGED'; end if;
  end if;
  select * into req from public.meetup_requests where post_id=event.id and requester_id=u and status='approved' for update;
  if req.id is null then raise exception 'APPROVED_MEMBER_REQUIRED'; end if;

  select nickname::text into old_name from public.profiles where id=old_host;
  select nickname::text into new_name from public.profiles where id=u;
  select h.profile,h.consent_version,h.consented_at into old_profile,old_consent,old_consented
    from private.chilling_host_profiles h where h.post_id=event.id;
  -- The previous host's meetup profile becomes their member profile; the receiver's answer to the host's question is dropped from the row
  -- (an earlier revision stays in the application history like any edit).
  update private.chilling_applications set author_id=old_host,profile=coalesce(old_profile,jsonb_build_object('displayName',old_name)),
    answer='',question='',consent_version=coalesce(old_consent,'chilling-v1'),consented_at=coalesce(old_consented,clock_timestamp()) where id=req.id;
  delete from public.meetup_requests where post_id=event.id and requester_id=old_host and id<>req.id;
  -- Read everything they said in the chat from the start: they were in it as host.
  update public.meetup_requests set host_id=u,
    requester_id=case when id=req.id then old_host else requester_id end,
    message=case when id=req.id then '' else message end,
    share_history=case when id=req.id then true else share_history end,
    created_at=case when id=req.id then event.created_at else created_at end,
    responded_at=case when id=req.id then event.created_at else responded_at end
    where post_id=event.id;
  insert into private.chilling_host_profiles(post_id,author_id,profile,consent_version)
    values(event.id,u,private.chilling_host_public(snapshot),case when snapshot->'version'='2'::jsonb then 'chilling-v2' else 'chilling-v1' end)
    on conflict(post_id) do update set author_id=excluded.author_id,profile=excluded.profile,consent_version=excluded.consent_version,consented_at=clock_timestamp();
  update public.posts set author_id=u where id=event.id;
  update private.meetup_cohosts set status='revoked' where post_id=event.id and user_id=u and status<>'revoked';
  delete from private.meetup_checkin_staff where post_id=event.id and user_id=u;
  update private.meetup_sessions set host_id=u where post_id=event.id and ends_at>clock_timestamp();
  update private.meetup_auto_next set host_id=u where post_id=event.id;
  update private.meetup_announcements set cancelled_at=clock_timestamp(),failed_reason='host_transferred'
    where post_id=event.id and sent_at is null and cancelled_at is null;
  update private.meetup_host_transfers set status='accepted',responded_at=clock_timestamp() where id=offer.id;
  insert into private.meetup_role_audit(post_id,actor_id,action,target_id) values(event.id,u,'transfer_accept',old_host);

  headline:=left(event.title,60);
  -- shortcut: one notification per member inside this transaction; move to a queue if meetups routinely pass a few hundred members.
  perform private.create_notification(old_host,'meetup_changed',u,'post',event.id,new_name||'님이 「'||headline||'」 호스트를 넘겨받았어요. 이제 멤버로 함께해요.','/post/'||event.id::text);
  for person in select r.requester_id from public.meetup_requests r where r.post_id=event.id and r.status='approved' and r.requester_id not in(old_host,u) loop
    perform private.create_notification(person.requester_id,'meetup_changed',u,'post',event.id,'「'||headline||'」 모임의 호스트가 '||new_name||'님으로 바뀌었어요. 일정과 장소는 그대로예요.','/post/'||event.id::text);
  end loop;
end;
$$;

-- One read for both sides: the host sees the open offer and who can take over; the receiver sees the offer to answer.
create function public.get_meetup_host_transfer(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; available boolean; offer private.meetup_host_transfers; candidates jsonb; host_name text;
begin
  event:=private.meetup_tool_context(p_post_id,u,false);
  available:=private.meetup_is_open(event.status,event.room_preview);
  select * into offer from private.meetup_host_transfers where post_id=event.id and status='pending' and expires_at>clock_timestamp();
  if event.author_id=u then
    select coalesce(jsonb_agg(jsonb_build_object('userId',r.requester_id,'blocker',private.meetup_transfer_blocker(event,r.requester_id)) order by r.created_at,r.id),'[]')
      into candidates from public.meetup_requests r where available and r.post_id=event.id and private.meetup_tool_member(event.id,r.requester_id);
    return jsonb_build_object('isHost',true,'available',available,'candidates',candidates,
      'pending',case when offer.id is not null then jsonb_build_object('toUserId',offer.to_user_id,'expiresAt',offer.expires_at) end);
  end if;
  if offer.id is null or offer.to_user_id<>u or not available then return jsonb_build_object('isHost',false,'offer',null); end if;
  select nickname::text into host_name from public.profiles where id=event.author_id;
  return jsonb_build_object('isHost',false,'offer',jsonb_build_object('hostName',host_name,'expiresAt',offer.expires_at,
    'blocker',private.meetup_transfer_blocker(event,u),'capacity',(event.room_preview->>'capacity')::integer,
    'seatLimit',private.meetup_capacity_limit(u)));
end;
$$;

-- Account deletion removes offers the person sent or received (the hook purge_account_data and delete_my_account already call).
do $$
declare definition text; anchor text:='  delete from private.meetup_templates where owner_id=p_user_id;';
begin
  definition:=pg_get_functiondef('private.purge_meetup_tool_account_data(uuid)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'HOST_TRANSFER_PURGE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||E'\n  delete from private.meetup_host_transfers where from_user_id=p_user_id or to_user_id=p_user_id or post_id in(select id from public.posts where author_id=p_user_id);');
end;
$$;

revoke all on function private.meetup_transfer_blocker(public.posts,uuid) from public,anon,authenticated,service_role;
revoke all on function public.offer_meetup_host_transfer(uuid,uuid),public.cancel_meetup_host_transfer(uuid),
  public.respond_meetup_host_transfer(uuid,boolean,text,text),public.get_meetup_host_transfer(uuid) from public,anon,authenticated,service_role;
grant execute on function public.offer_meetup_host_transfer(uuid,uuid),public.cancel_meetup_host_transfer(uuid),
  public.respond_meetup_host_transfer(uuid,boolean,text,text),public.get_meetup_host_transfer(uuid) to authenticated;
alter function private.meetup_transfer_blocker(public.posts,uuid) owner to postgres;
alter function public.offer_meetup_host_transfer(uuid,uuid) owner to postgres;
alter function public.cancel_meetup_host_transfer(uuid) owner to postgres;
alter function public.respond_meetup_host_transfer(uuid,boolean,text,text) owner to postgres;
alter function public.get_meetup_host_transfer(uuid) owner to postgres;
-- Controls on the new screens; unregistered ids are only stored as 'unregistered'.
insert into private.behavior_targets(id) values
  ('meetup.transfer.pick'),('meetup.transfer.confirm'),('meetup.transfer.cancel'),('meetup.transfer.accept'),('meetup.transfer.decline'),('meetup.transfer.leave-offer')
on conflict (id) do nothing;
notify pgrst,'reload schema';
