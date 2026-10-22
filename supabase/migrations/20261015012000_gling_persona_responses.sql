-- Operated inbox only. The authenticated AAL2 administrator remains auth.uid().
create table private.persona_case_reads (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null,
  kind text not null,
  target_id uuid not null,
  persona_id uuid,
  eligible boolean not null,
  status text not null,
  revision text,
  created_at timestamptz not null default now()
);
create table private.persona_case_actions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  operator_id uuid not null,
  kind text not null,
  target_id uuid not null,
  persona_id uuid not null,
  revision text not null,
  action text not null check (action in ('comment_reply','message_reply','accept_conversation','hold_meetup')),
  payload_hash text not null,
  result_id uuid,
  status text not null check (status in ('performed','held')),
  created_at timestamptz not null default now(),
  unique (kind,target_id,action)
);
alter table private.persona_case_reads enable row level security;
alter table private.persona_case_actions enable row level security;
revoke all on private.persona_case_reads, private.persona_case_actions from public,anon,authenticated,service_role;

create function private.persona_is_operated(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u join public.profiles p on p.id=u.id
    where u.id=p_user_id and p.account_status='active' and p.deleted_at is null
      and coalesce(u.raw_app_meta_data->>'role','member') not in ('admin','review','reviewer','bot','seed','test','tester','system')
      and coalesce(u.raw_app_meta_data->'review_access','false'::jsonb)<>'true'::jsonb
      and u.raw_app_meta_data->'gling_persona'->>'kind'='gling_operated_character'
      and u.raw_app_meta_data->'gling_persona'->>'version'='4'
      and u.raw_app_meta_data->'gling_persona'->>'profile_id'=u.id::text
      and u.raw_app_meta_data->'gling_persona'->>'city_id'=p.city_id
      and (u.raw_app_meta_data->'gling_persona') ?& array['living','background','values','personality','interests','writing_purpose','voice','continuity']
      and not exists(select 1 from jsonb_each(u.raw_app_meta_data->'gling_persona') d
        where d.key=any(array['living','background','values','personality','interests','writing_purpose','voice','continuity'])
          and d.value in ('null'::jsonb,'{}'::jsonb,'[]'::jsonb,'""'::jsonb)));
$$;
create function private.persona_inbound_allowed(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u join public.profiles p on p.id=u.id
    where u.id=p_user_id and p.account_status='active' and p.deleted_at is null
      and coalesce(u.email,'') not like '%@seed.gling.invalid'
      and coalesce(u.raw_app_meta_data->>'role','member') not in ('admin','review','reviewer','bot','seed','test','tester','system')
      and coalesce(u.raw_app_meta_data->'review_access','false'::jsonb)<>'true'::jsonb
      and u.raw_app_meta_data->'gling_persona' is null
      and not exists(select 1 from private.admin_ids a where a.user_id=u.id));
$$;

-- Internal resolver is inaccessible to application roles; the public read audits every outcome.
create function private.persona_case_context(p_kind text,p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  c public.comments; parent public.comments; p public.posts;
  m public.messages; room public.conversations; r public.meetup_requests;
  actor uuid; inbound uuid; candidates uuid[]; persona jsonb; recent jsonb;
  context jsonb; tail jsonb; revision text; profile public.profiles;
begin
  -- Keep audited read-then-write transactions in the same relationship lock order.
  perform private.lock_relationships();
  if p_target_id is null or p_kind is null or p_kind not in ('comment','message','conversation','meetup_request') then
    return jsonb_build_object('eligible',false,'status','unsupported_target');
  end if;
  if p_kind='comment' then
    select * into c from public.comments where id=p_target_id for share;
    if c.id is null then return jsonb_build_object('eligible',false,'status','not_found'); end if;
    select * into p from public.posts where id=c.post_id for share;
    if c.reply_to_id is not null then
      select * into parent from public.comments where id=c.reply_to_id and post_id=c.post_id for share;
    end if;
    perform 1 from public.comments where id in(c.parent_id,c.reply_to_id) order by id for share;
    actor:=case when exists(select 1 from auth.users u where u.id=parent.author_id
      and u.raw_app_meta_data->'gling_persona'->>'kind'='gling_operated_character') then parent.author_id else p.author_id end;
    inbound:=c.author_id;
    context:=jsonb_build_object('source',(to_jsonb(c)-'like_count'),'post',(to_jsonb(p)-array['like_count','save_count','comment_count','view_count','share_count','updated_at','bumped_at','bump_count','sort_at']),'reply_to',(to_jsonb(parent)-'like_count'));
  elsif p_kind in ('message','conversation') then
    if p_kind='message' then
      select * into m from public.messages where id=p_target_id for share;
      if m.id is null then return jsonb_build_object('eligible',false,'status','not_found'); end if;
      select * into room from public.conversations where id=m.conversation_id for share;
      inbound:=m.sender_id;
    else
      select * into room from public.conversations where id=p_target_id for share;
      inbound:=room.requester_id;
    end if;
    if room.id is null then return jsonb_build_object('eligible',false,'status','not_found'); end if;
    if room.kind='direct' then
      select array_agg(id order by id) into candidates from public.profiles
        where id in(room.user_low_id,room.user_high_id) and private.persona_is_operated(id);
    else
      select * into p from public.posts where id=room.group_post_id for share;
      select array_agg(id order by id) into candidates from public.profiles
        where private.persona_is_operated(id) and private.can_read_conversation(room.id,id);
    end if;
    if cardinality(candidates) is distinct from 1 then
      return jsonb_build_object('eligible',false,'status','unrelated_or_ambiguous');
    end if;
    actor:=candidates[1];
    if room.status not in ('pending','active') or not private.can_read_conversation(room.id,actor)
      or (p_kind='conversation' and (room.kind<>'direct' or room.status<>'pending' or inbound=actor))
      or (room.status='pending' and (room.kind<>'direct' or room.requester_id=actor or room.created_at<=now()-interval '7 days')) then
      return jsonb_build_object('eligible',false,'status','inactive_or_expired');
    end if;
    if room.kind='direct' and (not private.is_active_account(room.user_low_id) or not private.is_active_account(room.user_high_id)
      or private.is_blocked_between(room.user_low_id,room.user_high_id)) then
      return jsonb_build_object('eligible',false,'status','inactive_or_blocked');
    end if;
    if p_kind='message' and (m.hidden_at is not null or m.deleted_at is not null
      or not private.can_read_conversation(room.id,m.sender_id)
      or private.has_reported(actor,'message',m.id)) then
      return jsonb_build_object('eligible',false,'status','hidden_source');
    end if;
    -- Lock the bounded tail as well: another incoming message invalidates an earlier draft.
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at,t.id),'[]'::jsonb) into tail from (
      select x.* from public.messages x where x.conversation_id=room.id
        and x.hidden_at is null and x.deleted_at is null
        and not private.is_blocked_between(actor,x.sender_id)
        and not private.has_reported(actor,'message',x.id)
      order by x.created_at desc,x.id desc limit 20 for share
    ) t;
    context:=jsonb_build_object('source',case when p_kind='message' then to_jsonb(m) else (to_jsonb(room)-array['unread_epoch','updated_at','last_read_at']) end,
      'conversation',(to_jsonb(room)-array['unread_epoch','updated_at','last_read_at']),'post',(to_jsonb(p)-array['like_count','save_count','comment_count','view_count','share_count','updated_at','bumped_at','bump_count','sort_at']),'messages',tail);
  else
    select * into r from public.meetup_requests where id=p_target_id for share;
    if r.id is null then return jsonb_build_object('eligible',false,'status','not_found'); end if;
    select * into p from public.posts where id=r.post_id for share;
    actor:=r.host_id; inbound:=r.requester_id;
    if r.status<>'pending' or p.author_id is distinct from actor then
      return jsonb_build_object('eligible',false,'status','inactive_or_unrelated');
    end if;
    context:=jsonb_build_object('source',to_jsonb(r),'post',(to_jsonb(p)-array['like_count','save_count','comment_count','view_count','share_count','updated_at','bumped_at','bump_count','sort_at']),'host_verified',false);
  end if;

  -- Lock server-owned identity and account state; user-editable metadata never authorizes an actor.
  perform 1 from auth.users where id in(actor,inbound) order by id for share;
  perform 1 from public.profiles where id in(actor,inbound,p.author_id)
    or (p_kind='comment' and id in(select x.author_id from public.comments x where x.id in(c.parent_id,c.reply_to_id)))
    order by id for share;
  if not private.persona_is_operated(actor) then return jsonb_build_object('eligible',false,'status','not_operated'); end if;
  if not private.persona_inbound_allowed(inbound) or inbound=actor then
    return jsonb_build_object('eligible',false,'status','excluded_inbound');
  end if;
  if private.is_blocked_between(actor,inbound) then return jsonb_build_object('eligible',false,'status','blocked'); end if;
  if p_kind='comment' and exists(select 1 from public.comments x
    where x.reply_to_id=c.id and x.author_id=actor) then
    return jsonb_build_object('eligible',false,'status','already_answered');
  end if;
  if p_kind='message' then
    if exists(select 1 from public.messages x where x.conversation_id=room.id and x.sender_id=actor and x.created_at>=m.created_at) then
      return jsonb_build_object('eligible',false,'status','already_answered');
    end if;
    if exists(select 1 from public.messages x where x.conversation_id=room.id and x.hidden_at is null and x.deleted_at is null
      and private.persona_inbound_allowed(x.sender_id) and private.can_read_conversation(room.id,x.sender_id)
      and (x.created_at,x.id)>(m.created_at,m.id)) then
      return jsonb_build_object('eligible',false,'status','superseded');
    end if;
  end if;
  if p.id is not null and (p.status<>'published' or p.deleted_at is not null or not private.is_active_account(p.author_id)
    or (p.expires_at is not null and p.expires_at<=now()) or coalesce(p.room_preview->>'closed','false')='true'
    or private.is_blocked_between(actor,p.author_id) or private.has_reported(actor,'post',p.id)) then
    return jsonb_build_object('eligible',false,'status','hidden_or_expired');
  end if;
  if (p_kind='meetup_request' or room.kind='group') and (p.id is null or
    (p.room_preview->>'eventKind'='once' and (p.room_preview->>'endsAt')::timestamptz<=now())) then
    return jsonb_build_object('eligible',false,'status','expired_meetup');
  end if;
  if p_kind='comment' and not private.comment_visible_to(c.id,actor) then
    return jsonb_build_object('eligible',false,'status','hidden_source');
  end if;
  select * into profile from public.profiles where id=actor;
  select raw_app_meta_data->'gling_persona' into persona from auth.users where id=actor;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id desc),'[]'::jsonb) into recent from (
    select x.id,x.title,x.body,x.created_at,x.city_id from public.posts x where x.author_id=actor
      and x.status='published' and x.deleted_at is null and (x.expires_at is null or x.expires_at>now())
      order by x.created_at desc,x.id desc limit 5 for share
  ) t;
  context:=context||jsonb_build_object('profile',jsonb_build_object('id',profile.id,'nickname',profile.nickname,'bio',profile.bio,'city_id',profile.city_id));
  revision:=encode(extensions.digest(convert_to(jsonb_build_object('context',context,'persona',persona,'recent_posts',recent)::text,'UTF8'),'sha256'),'hex');
  return jsonb_build_object('eligible',true,'status',case when p_kind='meetup_request' then 'host_verification_required'
    when room.status='pending' then 'pending' else 'ready' end,'persona_id',actor,'revision',revision,
    'context',context,'persona',persona,'recent_posts',recent);
end;
$$;

create function public.get_admin_persona_case(p_kind text,p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_admin() or not coalesce((auth.jwt()->>'exp')::numeric>extract(epoch from now()),false) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  result:=private.persona_case_context(p_kind,p_target_id);
  perform public.log_admin_access('safety',(result->>'persona_id')::uuid,p_target_id);
  insert into private.persona_case_reads(operator_id,kind,target_id,persona_id,eligible,status,revision)
    values(auth.uid(),coalesce(p_kind,'unknown'),coalesce(p_target_id,'00000000-0000-0000-0000-000000000000'::uuid),
      (result->>'persona_id')::uuid,(result->>'eligible')::boolean,result->>'status',result->>'revision');
  return result;
end;
$$;

create function public.act_admin_persona_case(p_kind text,p_target_id uuid,p_persona_id uuid,p_revision text,
  p_action text,p_body text,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ctx jsonb; fingerprint text; receipt private.persona_case_actions; room public.conversations;
  source public.comments; result_id uuid; rate_action text; rate_window interval; cooldown interval; rate_max integer;
begin
  if not private.is_admin() or not coalesce((auth.jwt()->>'exp')::numeric>extract(epoch from now()),false) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_idempotency_key is null or p_target_id is null or p_persona_id is null or nullif(p_revision,'') is null then
    raise exception 'INVALID_ARGUMENT';
  end if;
  if p_kind is null or p_action is null or p_kind is distinct from (case p_action
    when 'comment_reply' then 'comment' when 'message_reply' then 'message'
    when 'accept_conversation' then 'conversation' when 'hold_meetup' then 'meetup_request' else '' end) then
    raise exception 'UNSUPPORTED_ACTION';
  end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_array(auth.uid(),p_kind,p_target_id,p_persona_id,p_revision,p_action,p_body)::text,'UTF8'),'sha256'),'hex');
  -- Reuse the existing relationship lock so blocks/acceptance cannot race a scoped write.
  perform private.lock_relationships();
  perform pg_advisory_xact_lock(hashtextextended('persona-key:'||p_idempotency_key::text,0));
  perform pg_advisory_xact_lock(hashtextextended('persona-case:'||p_kind||':'||p_target_id::text,0));
  select * into receipt from private.persona_case_actions where idempotency_key=p_idempotency_key;
  if receipt.id is not null then
    if receipt.payload_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return to_jsonb(receipt)-'payload_hash'-'idempotency_key';
  end if;
  if exists(select 1 from private.persona_case_actions where kind=p_kind and target_id=p_target_id and action=p_action) then
    raise exception 'ALREADY_ACTED';
  end if;
  if p_kind='comment' then
    perform 1 from public.comments where id=p_target_id for update;
  elsif p_kind='message' then
    perform 1 from public.messages where id=p_target_id for update;
  elsif p_kind='conversation' then
    perform 1 from public.conversations where id=p_target_id for update;
  else
    perform 1 from public.meetup_requests where id=p_target_id for update;
  end if;
  ctx:=private.persona_case_context(p_kind,p_target_id);
  if not coalesce((ctx->>'eligible')::boolean,false) then raise exception 'CASE_INELIGIBLE: %',ctx->>'status'; end if;
  if (ctx->>'persona_id')::uuid is distinct from p_persona_id then raise exception 'PERSONA_MISMATCH'; end if;
  if ctx->>'revision' is distinct from p_revision then raise exception 'STALE_SOURCE'; end if;

  if p_action in ('comment_reply','message_reply') then
    if char_length(trim(coalesce(p_body,''))) not between 1 and (case when p_action='comment_reply' then 1000 else 2000 end) then
      raise exception 'INVALID_BODY';
    end if;
    rate_action:=case when p_action='comment_reply' then 'comment' else 'message' end;
    rate_window:=case when p_action='comment_reply' then interval '10 minutes' else interval '1 minute' end;
    cooldown:=case when p_action='comment_reply' then interval '5 seconds' else interval '1 second' end;
    rate_max:=case when p_action='comment_reply' then 20 else 30 end;
    -- Charge the actor under the same advisory key as the normal rate limiter; no admin exemption.
    perform pg_advisory_xact_lock(hashtextextended(p_persona_id::text||':'||rate_action,0));
    if exists(select 1 from private.action_rate_events where user_id=p_persona_id and action=rate_action and created_at>now()-cooldown)
      or (select count(*) from private.action_rate_events where user_id=p_persona_id and action=rate_action and created_at>now()-rate_window)>=rate_max then
      raise exception 'RATE_LIMITED';
    end if;
    insert into private.action_rate_events(user_id,action) values(p_persona_id,rate_action);
    if p_action='comment_reply' then
      select * into source from public.comments where id=p_target_id;
      insert into public.comments(post_id,author_id,body,parent_id,reply_to_id)
        values(source.post_id,p_persona_id,trim(p_body),coalesce(source.parent_id,source.id),source.id) returning id into result_id;
    else
      select * into room from public.conversations where id=(ctx->'context'->'conversation'->>'id')::uuid for update;
      if room.status<>'active' then raise exception 'CONVERSATION_NOT_ACTIVE'; end if;
      if room.kind='group' then perform private.assert_chilling_open((select room_preview from public.posts where id=room.group_post_id)); end if;
      insert into public.messages(conversation_id,sender_id,body,reply_to_id)
        values(room.id,p_persona_id,trim(p_body),p_target_id) returning id into result_id;
    end if;
  else
    if nullif(trim(coalesce(p_body,'')),'') is not null then raise exception 'INVALID_BODY'; end if;
    if p_action='accept_conversation' then
      select * into room from public.conversations where id=p_target_id for update;
      if room.kind<>'direct' or room.status<>'pending' or room.requester_id=p_persona_id
        or p_persona_id not in(room.user_low_id,room.user_high_id) then raise exception 'RECIPIENT_REQUIRED'; end if;
      -- Mirrors the current production respond_direct_conversation acceptance, with explicit actor.
      if room.created_at<=now()-interval '7 days' then raise exception 'REQUEST_EXPIRED'; end if;
      if private.is_blocked_between(room.user_low_id,room.user_high_id) then raise exception 'BLOCKED'; end if;
      perform private.assert_active_account(room.user_low_id); perform private.assert_active_account(room.user_high_id);
      update public.conversations set status='active',accepted_at=now() where id=room.id;
      result_id:=room.id;
    else
      -- A durable triage receipt is the entire effect: never approve or claim synthetic attendance.
      result_id:=p_target_id;
    end if;
  end if;
  insert into private.persona_case_actions(idempotency_key,operator_id,kind,target_id,persona_id,revision,action,payload_hash,result_id,status)
    values(p_idempotency_key,auth.uid(),p_kind,p_target_id,p_persona_id,p_revision,p_action,fingerprint,result_id,
      case when p_action='hold_meetup' then 'held' else 'performed' end) returning * into receipt;
  perform public.log_admin_access('safety',p_persona_id,result_id);
  return to_jsonb(receipt)-'payload_hash'-'idempotency_key';
end;
$$;
revoke all on function private.persona_is_operated(uuid),private.persona_inbound_allowed(uuid),private.persona_case_context(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_admin_persona_case(text,uuid),public.act_admin_persona_case(text,uuid,uuid,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_persona_case(text,uuid),public.act_admin_persona_case(text,uuid,uuid,text,text,text,uuid) to authenticated;


-- Recover owned inbox work independently of the short-lived monitor outbox/ACK.
create function public.get_admin_persona_pending(p_limit integer default 100)
returns table(kind text,target_id uuid)
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() or not coalesce((auth.jwt()->>'exp')::numeric>extract(epoch from now()),false) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'INVALID_LIMIT'; end if;
  perform private.lock_relationships();
  perform public.log_admin_access('safety',null,null);
  insert into private.persona_case_reads(operator_id,kind,target_id,eligible,status)
    values(auth.uid(),'pending','00000000-0000-0000-0000-000000000000',true,'metadata_scan');
  return query
    select work.kind,work.target_id from (
      select 'conversation'::text kind,c.id target_id,0 priority,c.created_at
        from public.conversations c where c.kind='direct' and c.status='pending'
          and c.created_at>now()-interval '7 days' and private.persona_inbound_allowed(c.requester_id)
          and (private.persona_is_operated(c.user_low_id) or private.persona_is_operated(c.user_high_id))
      union all
      select 'meetup_request',r.id,1,r.created_at from public.meetup_requests r
        where r.status='pending' and private.persona_is_operated(r.host_id) and private.persona_inbound_allowed(r.requester_id)
      union all
      select 'message',latest.id,2,latest.created_at from (
        select distinct on(m.conversation_id) m.id,m.created_at from public.messages m
          join public.conversations c on c.id=m.conversation_id and c.status in ('active','pending')
        where m.hidden_at is null and m.deleted_at is null and private.persona_inbound_allowed(m.sender_id)
          and private.can_read_conversation(c.id,m.sender_id)
        order by m.conversation_id,m.created_at desc,m.id desc
      ) latest
      union all
      select 'comment',c.id,3,c.created_at from public.comments c join public.posts p on p.id=c.post_id
        left join public.comments parent on parent.id=c.reply_to_id
      where c.deleted_at is null and p.status='published' and private.persona_inbound_allowed(c.author_id)
        and (private.persona_is_operated(p.author_id) or private.persona_is_operated(parent.author_id))
    ) work
    where not exists(select 1 from private.persona_case_actions a where a.kind=work.kind and a.target_id=work.target_id)
      and (private.persona_case_context(work.kind,work.target_id)->>'eligible')::boolean
    order by work.priority,work.created_at,work.target_id limit p_limit;
end;
$$;
revoke all on function public.get_admin_persona_pending(integer) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_persona_pending(integer) to authenticated;
