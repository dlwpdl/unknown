-- Meetup scale follows the host's personal membership: seats 10/30/100/500 and cohosts 0/1/3/5 (free/plus/pro/premium).
-- The operator account keeps the validator maximum. Cohosts may now also invite from the waitlist; every role change is audited.

create or replace function private.meetup_capacity_limit(p_user_id uuid) returns integer
language sql stable security definer set search_path='' as $$
  select case when not private.is_active_account(p_user_id) then 10
    else case private.meetup_tool_tier(p_user_id) when 'admin' then 5000 when 'premium' then 500 when 'pro' then 100 when 'plus' then 30 else 10 end end;
$$;

create function private.meetup_cohost_limit(p_user_id uuid) returns integer
language sql stable security definer set search_path='' as $$
  select case when not private.is_active_account(p_user_id) then 0
    else case private.meetup_tool_tier(p_user_id) when 'admin' then 1000 when 'premium' then 5 when 'pro' then 3 when 'plus' then 1 else 0 end end;
$$;
revoke all on function private.meetup_cohost_limit(uuid) from public,anon,authenticated,service_role;

create table private.meetup_role_audit (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null check(action in('cohost_invite','cohost_accept','cohost_decline','cohost_remove','waitlist_invite')),
  target_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create index meetup_role_audit_post on private.meetup_role_audit(post_id,created_at desc);
alter table private.meetup_role_audit enable row level security;
revoke all on private.meetup_role_audit from public,anon,authenticated,service_role;

-- Only the first N accepted cohosts (by acceptance time) act, so a host downgrade can't leave extra cohosts with powers.
create or replace function private.meetup_tool_cohost(p_post_id uuid,p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from (
      select c.user_id,row_number() over(order by c.accepted_at,c.user_id) n from private.meetup_cohosts c
      where c.post_id=p_post_id and c.status='accepted' and private.meetup_tool_member(c.post_id,c.user_id)) s
    where s.user_id=p_user_id and s.n<=private.meetup_cohost_limit((select author_id from public.posts where id=p_post_id)));
$$;

create or replace function public.invite_meetup_cohost(p_post_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; cap integer;
begin
  perform private.lock_relationships();
  event:=private.meetup_tool_context(p_post_id,u);
  if event.author_id<>u then raise exception 'HOST_REQUIRED'; end if;
  cap:=private.meetup_cohost_limit(u);
  if cap=0 then raise exception 'PLUS_REQUIRED'; end if;
  if p_user_id is null or p_user_id=u or not private.meetup_tool_member(event.id,p_user_id) then raise exception 'APPROVED_MEMBER_REQUIRED'; end if;
  if exists(select 1 from private.meetup_cohosts where post_id=event.id and user_id=p_user_id and status in('pending','accepted')) then return; end if;
  if (select count(*) from private.meetup_cohosts where post_id=event.id and status in('pending','accepted'))>=cap then raise exception 'MEETUP_COHOST_LIMIT'; end if;
  perform private.enforce_rate_limit('meetup_cohost_invite',20,interval '1 day',interval '2 seconds');
  insert into private.meetup_cohosts(post_id,user_id,status) values(event.id,p_user_id,'pending')
    on conflict(post_id,user_id) do update set status='pending',invited_at=clock_timestamp(),accepted_at=null;
  insert into private.meetup_role_audit(post_id,actor_id,action,target_id) values(event.id,u,'cohost_invite',p_user_id);
  perform private.create_notification(p_user_id,'meetup_request',u,'post',event.id,
    '공동 호스트 초대가 왔어요. 수락하면 회차·참석 확인과 대기자 초대를 함께 해요. 비공개 신청 답변과 계정 관리는 공유되지 않아요.','/post/'||event.id::text);
end;
$$;

create or replace function public.respond_meetup_cohost(p_post_id uuid,p_accept boolean) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts;
begin
  perform private.lock_relationships();
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_accept is null then raise exception 'INVALID_RESPONSE'; end if;
  if not p_accept then
    update private.meetup_cohosts set status='revoked' where post_id=p_post_id and user_id=u and status in('pending','accepted');
    if found then insert into private.meetup_role_audit(post_id,actor_id,action,target_id) values(p_post_id,u,'cohost_decline',u); end if;
    return;
  end if;
  event:=private.meetup_tool_context(p_post_id,u);
  if private.meetup_cohost_limit(event.author_id)=0 then raise exception 'PLUS_REQUIRED'; end if;
  if not private.meetup_tool_member(event.id,u) then raise exception 'APPROVED_MEMBER_REQUIRED'; end if;
  if exists(select 1 from private.meetup_cohosts where post_id=event.id and user_id=u and status='accepted') then return; end if;
  if (select count(*) from private.meetup_cohosts where post_id=event.id and status='accepted')>=private.meetup_cohost_limit(event.author_id) then
    raise exception 'MEETUP_COHOST_LIMIT'; end if;
  update private.meetup_cohosts set status='accepted',accepted_at=clock_timestamp() where post_id=event.id and user_id=u and status='pending';
  if not found then raise exception 'COHOST_INVITATION_REQUIRED'; end if;
  insert into private.meetup_role_audit(post_id,actor_id,action,target_id) values(event.id,u,'cohost_accept',u);
end;
$$;

create or replace function public.remove_meetup_cohost(p_post_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  perform private.lock_relationships();
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_user_id is distinct from u and not exists(select 1 from public.posts where id=p_post_id and author_id=u) then raise exception 'HOST_REQUIRED'; end if;
  update private.meetup_cohosts set status='revoked' where post_id=p_post_id and user_id=p_user_id and status<>'revoked';
  if found then insert into private.meetup_role_audit(post_id,actor_id,action,target_id) values(p_post_id,u,'cohost_remove',p_user_id); end if;
end;
$$;

-- Waitlist invitations (a Pro tool) can now come from an acting cohost as well as the host.
do $$
declare d text;
begin
  d:=pg_get_functiondef('public.invite_next_meetup_waitlist(uuid)'::regprocedure);
  if strpos(d,'if event.author_id<>u then raise exception ''HOST_REQUIRED''; end if;')=0
    or strpos(d,'perform private.require_meetup_tool_tier(u,''pro'');')=0
    or strpos(d,'update private.meetup_waitlist set invited_at=clock_timestamp() where id=entry.id;')=0 then raise exception 'waitlist invite anchors missing'; end if;
  d:=replace(d,'if event.author_id<>u then raise exception ''HOST_REQUIRED''; end if;',
    'if event.author_id<>u and not private.meetup_tool_cohost(event.id,u) then raise exception ''HOST_REQUIRED''; end if;');
  d:=replace(d,'perform private.require_meetup_tool_tier(u,''pro'');','perform private.require_meetup_tool_tier(event.author_id,''pro'');');
  d:=replace(d,'update private.meetup_waitlist set invited_at=clock_timestamp() where id=entry.id;',
    'update private.meetup_waitlist set invited_at=clock_timestamp() where id=entry.id;
  insert into private.meetup_role_audit(post_id,actor_id,action,target_id) values(event.id,u,''waitlist_invite'',entry.user_id);');
  execute d;

  d:=pg_get_functiondef('public.get_meetup_host_tools(uuid)'::regprocedure);
  if strpos(d,'pro:=private.meetup_tool_tier(event.author_id) in(''pro'',''premium'');')=0
    or strpos(d,'''canInvite'',available and pro and owner,')=0
    or strpos(d,'''waitlistCount'',case when owner then')=0 then raise exception 'host tools anchors missing'; end if;
  d:=replace(d,'pro:=private.meetup_tool_tier(event.author_id) in(''pro'',''premium'');',
    'pro:=private.meetup_tool_tier(event.author_id) in(''pro'',''premium'',''admin'');');
  -- canInvite keeps its meaning (waitlist invitations) for published clients; cohost invitations get their own flag.
  d:=replace(d,'''canInvite'',available and pro and owner,',
    '''canInvite'',available and pro and (owner or cohost),''canInviteCohost'',available and owner and private.meetup_cohost_limit(event.author_id)>(select count(*) from private.meetup_cohosts c where c.post_id=event.id and c.status in(''pending'',''accepted'')),''cohostLimit'',private.meetup_cohost_limit(event.author_id),');
  d:=replace(d,'''waitlistCount'',case when owner then','''waitlistCount'',case when owner or cohost then');
  execute d;
end;
$$;
