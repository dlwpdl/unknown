-- Conversation investigation is additive: raw messages, alerts and the AI queue remain untouched.
create table public.admin_conversation_reviews (
  id uuid primary key default gen_random_uuid(),
  -- No identity/room foreign keys: account or room cleanup must retain review evidence.
  conversation_id uuid not null,
  actor_id uuid not null,
  status text not null check (status in ('new','reviewing','clear','action','closed')),
  note text not null check (note=btrim(note,E' \t\n\r\f'||chr(11)) and char_length(note) between 1 and 1000),
  last_signal_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index admin_conversation_reviews_latest_idx
  on public.admin_conversation_reviews(conversation_id,created_at desc,id desc);
alter table public.admin_conversation_reviews enable row level security;
revoke all on public.admin_conversation_reviews from public,anon,authenticated,service_role;
create policy "admins read conversation reviews" on public.admin_conversation_reviews
  for select to authenticated using ((select private.is_admin()));

create index messages_admin_body_search_idx on public.messages using gin(body extensions.gin_trgm_ops);
create index safety_alerts_conversation_signal_idx on public.safety_alerts(conversation_id,created_at desc)
  where target_type='message';

create policy "admins read sent chat photos" on storage.objects for select to authenticated
using (bucket_id='chat-images' and (select private.is_admin()) and exists(
  select 1 from public.messages m where m.image_path=name
));

create function private.admin_conversation_signals(p_conversation_id uuid)
returns table(conversation_id uuid,id text,source text,message_id uuid,message_at timestamptz,
  category text,severity text,reasons jsonb,excerpt text,created_at timestamptz)
language sql stable security definer set search_path='' as $$
  select coalesce(a.conversation_id,m.conversation_id),'keyword:'||a.id::text,'keyword',a.target_id,
    m.created_at,a.category,a.severity,to_jsonb(a.matched_terms),a.excerpt,a.created_at
  from public.safety_alerts a left join public.messages m on m.id=a.target_id
  where a.target_type='message' and coalesce(a.conversation_id,m.conversation_id) is not null
    and (p_conversation_id is null or coalesce(a.conversation_id,m.conversation_id)=p_conversation_id)
  union all
  select m.conversation_id,'ai:'||q.id::text,'ai',m.id,m.created_at,'ai',q.risk_level,
    coalesce((select jsonb_agg(reason.value) from jsonb_array_elements_text(
      case when jsonb_typeof(q.risk_reasons)='array' then q.risk_reasons else '[]'::jsonb end) reason(value)),'[]'::jsonb),
    left(m.body,500),coalesce(q.reviewed_at,q.created_at)
  from public.safety_review_queue q join public.messages m on m.id=q.target_id
  where q.target_type='message' and q.status='reviewed'
    and (p_conversation_id is null or m.conversation_id=p_conversation_id)
    and (q.risk_level in ('medium','high','critical') or (q.risk_level='low' and q.risk_score>0
      and case when jsonb_typeof(q.risk_reasons)='array' then jsonb_array_length(q.risk_reasons)>0 else false end));
$$;

create function private.admin_conversation_cases(p_conversation_id uuid)
returns table(id uuid,kind text,title text,participants jsonb,latest_message_at timestamptz,
  latest_excerpt text,message_count bigint,risk_level text,signal_count bigint,latest_signal_at timestamptz,
  pending_analysis bigint,status text,reopened boolean,review jsonb)
language sql stable security definer set search_path='' as $$
  with signals as materialized (select * from private.admin_conversation_signals(p_conversation_id)),
  totals as (
    select s.conversation_id,count(*) as signal_count,max(s.created_at) as latest_signal_at,
      max(case s.severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end) as risk
    from signals s group by s.conversation_id
  )
  select c.id,c.kind,p.title,coalesce(members.value,'[]'::jsonb),coalesce(last_message.created_at,c.created_at),
    coalesce(left(last_message.body,200),''),message_total.value,
    case coalesce(case when state.reopened then new_signals.risk else t.risk end,0)
      when 4 then 'critical' when 3 then 'high' when 2 then 'medium' when 1 then 'low' else 'none' end,
    coalesce(t.signal_count,0),t.latest_signal_at,pipeline.value,
    case when state.reopened then 'new' else coalesce(r.status,'new') end,state.reopened,
    case when r.id is null then null else to_jsonb(r)||jsonb_build_object('actor_name',actor.nickname) end
  from public.conversations c
  left join public.posts p on p.id=c.group_post_id
  left join totals t on t.conversation_id=c.id
  left join lateral (
    select x.* from public.admin_conversation_reviews x where x.conversation_id=c.id
    order by x.created_at desc,x.id desc limit 1
  ) r on true
  left join public.profiles actor on actor.id=r.actor_id
  cross join lateral (select coalesce(r.status in ('clear','closed') and t.latest_signal_at is not null
    and (r.last_signal_at is null or t.latest_signal_at>r.last_signal_at),false) as reopened) state
  left join lateral (
    select max(case s.severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end) as risk
    from signals s where s.conversation_id=c.id and (r.last_signal_at is null or s.created_at>r.last_signal_at)
  ) new_signals on state.reopened
  left join lateral (
    select m.created_at,m.body from public.messages m where m.conversation_id=c.id
    order by m.created_at desc,m.id desc limit 1
  ) last_message on true
  cross join lateral (select count(*) as value from public.messages m where m.conversation_id=c.id) message_total
  cross join lateral (
    select count(*) as value from public.messages m join public.safety_review_queue q
      on q.target_type='message' and q.target_id=m.id
    where m.conversation_id=c.id and q.status in ('pending','processing','failed')
  ) pipeline
  left join lateral (
    select jsonb_agg(jsonb_build_object('id',member.id,'nickname',coalesce(pr.nickname::text,'알 수 없음'),'city_id',pr.city_id)
      order by pr.nickname,member.id) as value
    from (
      select c.user_low_id as id where c.kind='direct'
      union select c.user_high_id where c.kind='direct'
      union select p.author_id where c.kind='group'
      union select mr.requester_id from public.meetup_requests mr
        where c.kind='group' and mr.post_id=c.group_post_id and mr.status='approved'
      union select m.sender_id from public.messages m where m.conversation_id=c.id
    ) member left join public.profiles pr on member.id=pr.id where member.id is not null
  ) members on true
  where p_conversation_id is null or c.id=p_conversation_id;
$$;

create function public.get_admin_conversations(p_city text,p_scope text,p_kind text,p_risk text,
  p_since timestamptz,p_query text,p_sort text,p_offset integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; pattern text;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_city is null or (p_city not in ('all','unknown') and not exists(select 1 from public.cities where id=p_city))
    or p_scope is null or p_scope not in ('pending','all','done')
    or p_kind is null or p_kind not in ('all','direct','group')
    or p_risk is null or p_risk not in ('all','none','low','medium','high')
    or p_sort is null or p_sort not in ('risk','recent')
    or p_offset is null or p_offset<0 or p_query is null or char_length(p_query)>200
    then raise exception 'INVALID_CONVERSATION_FILTER'; end if;
  pattern:='%'||replace(replace(replace(btrim(p_query),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  perform public.log_admin_access('conversations',null,null);
  with matching as materialized (
    select c.*,case c.risk_level when 'critical' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end as priority,
      c.status in ('clear','closed') as done,
      (c.status in ('reviewing','action') or (c.status not in ('clear','closed') and c.signal_count>0)) as pending
    from private.admin_conversation_cases(null) c
    where (p_city='all' or exists(select 1 from jsonb_array_elements(c.participants) member
      where (p_city='unknown' and member->>'city_id' is null) or member->>'city_id'=p_city))
      and (p_kind='all' or c.kind=p_kind)
      and (p_risk='all' or c.risk_level=p_risk or (p_risk='high' and c.risk_level='critical'))
      and (p_since is null or c.latest_message_at>=p_since)
      and (btrim(p_query)='' or c.id::text ilike pattern escape E'\\' or c.title ilike pattern escape E'\\'
        or exists(select 1 from jsonb_array_elements(c.participants) member where member->>'nickname' ilike pattern escape E'\\')
        or exists(select 1 from public.messages m where m.conversation_id=c.id and m.body ilike pattern escape E'\\'))
  ), page as materialized (
    select * from matching where p_scope='all' or (p_scope='done' and done) or (p_scope='pending' and pending)
    order by case when p_sort='risk' then priority else 0 end desc,latest_message_at desc,id desc
    limit 51 offset p_offset
  ), visible as (
    select * from page order by case when p_sort='risk' then priority else 0 end desc,latest_message_at desc,id desc limit 50
  )
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(v)-'priority'-'done'-'pending'
      order by case when p_sort='risk' then priority else 0 end desc,latest_message_at desc,id desc) from visible v),'[]'::jsonb),
    'counts',(select jsonb_build_object('all',count(*),'pending',count(*) filter(where pending),
      'done',count(*) filter(where done),'high',count(*) filter(where priority>=3 and pending)) from matching),
    'nextOffset',case when (select count(*) from page)>50 then p_offset+50 else null end,
    'generatedAt',clock_timestamp()) into result;
  return result;
end;
$$;

create function public.get_admin_conversation(p_conversation_id uuid,p_before timestamptz,
  p_before_id uuid,p_focus_message_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; case_data jsonb; focus public.messages;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if (p_before is null)<>(p_before_id is null) or (p_focus_message_id is not null and p_before is not null)
    then raise exception 'INVALID_CONVERSATION_CURSOR'; end if;
  if p_conversation_id is null then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  select to_jsonb(c) into case_data from private.admin_conversation_cases(p_conversation_id) c where c.id=p_conversation_id;
  if case_data is null then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if p_focus_message_id is not null then
    select * into focus from public.messages where id=p_focus_message_id and conversation_id=p_conversation_id;
    if focus.id is null then raise exception 'CONVERSATION_MESSAGE_NOT_FOUND'; end if;
  end if;
  perform public.log_admin_access('conversations',null,p_conversation_id);
  with selected as materialized (
    (select m.* from public.messages m where m.conversation_id=p_conversation_id and p_focus_message_id is null
      and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
      order by m.created_at desc,m.id desc limit 50)
    union all
    (select m.* from public.messages m where m.conversation_id=p_conversation_id and p_focus_message_id is not null
      and (m.created_at,m.id)<(focus.created_at,focus.id) order by m.created_at desc,m.id desc limit 25)
    union all
    (select m.* from public.messages m where m.id=focus.id and p_focus_message_id is not null)
    union all
    (select m.* from public.messages m where m.conversation_id=p_conversation_id and p_focus_message_id is not null
      and (m.created_at,m.id)>(focus.created_at,focus.id) order by m.created_at,m.id limit 25)
  ), first_message as (select created_at,id from selected order by created_at,id limit 1),
  last_message as (select created_at,id from selected order by created_at desc,id desc limit 1),
  signals as materialized (select * from private.admin_conversation_signals(p_conversation_id)),
  priority_signals as (
    select s.* from signals s order by case when (case_data->>'reopened')::boolean
      and ((case_data->'review'->>'last_signal_at') is null or s.created_at>(case_data->'review'->>'last_signal_at')::timestamptz)
      then 1 else 0 end desc,
      case s.severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc,
      s.created_at desc,s.id desc limit 10
  ), shown_signals as (
    select s.* from signals s where s.message_id in (select id from selected)
    union select * from priority_signals
  ), history as (
    select r.*,p.nickname::text as actor_name from public.admin_conversation_reviews r
      left join public.profiles p on p.id=r.actor_id where r.conversation_id=p_conversation_id
    order by r.created_at desc,r.id desc limit 20
  )
  select jsonb_build_object('conversation',case_data,
    'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'conversation_id',m.conversation_id,
      'sender_id',m.sender_id,'body',m.body,'created_at',m.created_at,'kind',m.kind,'image_path',m.image_path,
      'latitude',m.latitude,'longitude',m.longitude,'reply_to_id',m.reply_to_id) order by m.created_at,m.id) from selected m),'[]'::jsonb),
    'signals',coalesce((select jsonb_agg(to_jsonb(s)-'conversation_id' order by s.created_at desc,s.id desc) from shown_signals s),'[]'::jsonb),
    'review_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from history h),'[]'::jsonb),
    'nextCursor',(select jsonb_build_object('at',f.created_at,'id',f.id) from first_message f
      where exists(select 1 from public.messages m where m.conversation_id=p_conversation_id and (m.created_at,m.id)<(f.created_at,f.id))),
    'hasNewer',exists(select 1 from public.messages m,last_message l
      where m.conversation_id=p_conversation_id and (m.created_at,m.id)>(l.created_at,l.id)),
    'generatedAt',clock_timestamp()) into result;
  return result;
end;
$$;

create function public.save_admin_conversation_review(p_conversation_id uuid,p_status text,p_note text,
  p_expected_review_id uuid,p_expected_signal_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare latest_review uuid; signal_at timestamptz; saved public.admin_conversation_reviews; result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_status is null or p_status not in ('new','reviewing','clear','action','closed') then raise exception 'INVALID_CONVERSATION_REVIEW_STATUS'; end if;
  if p_note is null or char_length(btrim(p_note,E' \t\n\r\f'||chr(11))) not between 1 and 1000 then raise exception 'INVALID_CONVERSATION_REVIEW_NOTE'; end if;
  if p_conversation_id is null or not exists(select 1 from public.conversations where id=p_conversation_id) then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-conversation-review:'||p_conversation_id::text,0));
  select r.id into latest_review from public.admin_conversation_reviews r where r.conversation_id=p_conversation_id
    order by r.created_at desc,r.id desc limit 1;
  if latest_review is distinct from p_expected_review_id then raise exception 'CONVERSATION_REVIEW_CHANGED'; end if;
  select max(s.created_at) into signal_at from private.admin_conversation_signals(p_conversation_id) s;
  if signal_at is distinct from p_expected_signal_at then raise exception 'CONVERSATION_SIGNALS_CHANGED'; end if;
  perform public.log_admin_access('conversations',null,p_conversation_id);
  insert into public.admin_conversation_reviews(conversation_id,actor_id,status,note,last_signal_at)
    values(p_conversation_id,auth.uid(),p_status,btrim(p_note,E' \t\n\r\f'||chr(11)),signal_at) returning * into saved;
  select to_jsonb(saved)||jsonb_build_object('actor_name',p.nickname) into result from public.profiles p where p.id=saved.actor_id;
  return result;
end;
$$;

revoke all on function private.admin_conversation_signals(uuid),private.admin_conversation_cases(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.get_admin_conversations(text,text,text,text,timestamptz,text,text,integer),
  public.get_admin_conversation(uuid,timestamptz,uuid,uuid),
  public.save_admin_conversation_review(uuid,text,text,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_conversations(text,text,text,text,timestamptz,text,text,integer),
  public.get_admin_conversation(uuid,timestamptz,uuid,uuid),
  public.save_admin_conversation_review(uuid,text,text,uuid,timestamptz) to authenticated;
notify pgrst,'reload schema';

-- Non-destructive rollback (run separately in a transaction): preserve the review table/history.
-- drop function public.get_admin_conversations(text,text,text,text,timestamptz,text,text,integer);
-- drop function public.get_admin_conversation(uuid,timestamptz,uuid,uuid);
-- drop function public.save_admin_conversation_review(uuid,text,text,uuid,timestamptz);
-- drop function private.admin_conversation_cases(uuid);
-- drop function private.admin_conversation_signals(uuid);
-- drop policy "admins read sent chat photos" on storage.objects;
-- drop index public.messages_admin_body_search_idx;
-- drop index public.safety_alerts_conversation_signal_idx;
-- notify pgrst,'reload schema';
