-- Private structured feedback. Public aggregates never return personal review text.
create table private.trust_reviews (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in('meetup','manner')),
  author_id uuid not null references public.profiles(id),
  subject_id uuid references public.profiles(id),
  session_id uuid references private.meetup_sessions(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  score numeric(3,1) check(score between 1 and 10 and score*2=trunc(score*2)),
  signals jsonb,
  body text check(char_length(body)<=300),
  status text not null default 'pending' check(status in('pending','needs_review','published','held','removed')),
  release_at timestamptz not null,
  appeal_body text check(char_length(appeal_body)<=1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  check(num_nonnulls(session_id,conversation_id)=1),
  check((kind='meetup' and session_id is not null and subject_id is null and score is not null and signals is null)
    or (kind='manner' and subject_id is not null and subject_id<>author_id and score is null and signals is not null))
);
create unique index trust_review_session_once on private.trust_reviews(session_id,author_id,coalesce(subject_id,'00000000-0000-0000-0000-000000000000'::uuid)) where session_id is not null;
create unique index trust_review_chat_once on private.trust_reviews(conversation_id,author_id,subject_id) where conversation_id is not null;
create index trust_reviews_author_idx on private.trust_reviews(author_id,created_at desc);
create index trust_reviews_subject_idx on private.trust_reviews(subject_id,created_at desc) where kind='manner';
create index trust_reviews_session_idx on private.trust_reviews(session_id,created_at desc);
create table private.trust_review_decisions (
  id bigint generated always as identity primary key,
  target_type text not null,
  target_id uuid not null,
  admin_id uuid not null references public.profiles(id),
  decision text not null,
  note text not null check(char_length(note) between 5 and 1000),
  previous jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index trust_review_decisions_target_idx on private.trust_review_decisions(target_type,target_id,created_at);
create index trust_review_decisions_admin_idx on private.trust_review_decisions(admin_id);
alter table private.trust_reviews enable row level security;
alter table private.trust_review_decisions enable row level security;
revoke all on private.trust_reviews,private.trust_review_decisions from public,anon,authenticated,service_role;
alter table private.trust_reviews owner to postgres;
alter table private.trust_review_decisions owner to postgres;

create function private.trust_review_released(p_review private.trust_reviews) returns boolean
language sql stable security definer set search_path='' as $$
  select p_review.release_at<=now() or exists(select 1 from private.trust_reviews other
    where other.kind='manner' and other.author_id=p_review.subject_id and other.subject_id=p_review.author_id
      and other.session_id is not distinct from p_review.session_id
      and other.conversation_id is not distinct from p_review.conversation_id and other.status<>'removed');
$$;
create function private.manner_eligible(p_user uuid,p_subject uuid,p_session uuid,p_conversation uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_subject<>p_user and private.is_active_account(p_user) and private.is_active_account(p_subject)
    and num_nonnulls(p_session,p_conversation)=1 and case when p_session is not null then exists(
      select 1 from private.meetup_sessions s join private.meetup_attendance mine on mine.session_id=s.id and mine.user_id=p_user
        join private.meetup_attendance other on other.session_id=s.id and other.user_id=p_subject
      where s.id=p_session and s.ends_at<=now() and s.ends_at>now()-interval '7 days'
        and mine.confirmed_at is not null and other.confirmed_at is not null)
    else exists(select 1 from public.conversations c where c.id=p_conversation and c.kind='direct'
      and ((c.user_low_id=p_user and c.user_high_id=p_subject) or (c.user_high_id=p_user and c.user_low_id=p_subject))
      and (select count(*) from public.messages m where m.conversation_id=c.id and m.sender_id=p_user and m.kind='text')>=2
      and (select count(*) from public.messages m where m.conversation_id=c.id and m.sender_id=p_subject and m.kind='text')>=2
      and (select max(m.created_at)-min(m.created_at) from public.messages m where m.conversation_id=c.id)>=interval '1 minute') end;
$$;

create function public.write_meetup_review(p_session_id uuid,p_score numeric,p_body text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); s private.meetup_sessions; existing private.trust_reviews; id uuid; body text:=nullif(btrim(p_body),'');
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u); perform private.lock_relationships();
  select * into s from private.meetup_sessions where meetup_sessions.id=p_session_id;
  if s.id is null or not private.can_attend_session(s.id,u) then raise exception 'SESSION_NOT_FOUND'; end if;
  if not exists(select 1 from public.posts p where p.id=s.post_id and coalesce(p.room_preview->>'eventKind','group')='group') then raise exception 'REGULAR_MEETUP_REQUIRED'; end if;
  if s.host_id=u then raise exception 'CANNOT_REVIEW_OWN_MEETUP'; end if;
  if not exists(select 1 from private.meetup_attendance where session_id=s.id and user_id=u and confirmed_at is not null) then raise exception 'ATTENDANCE_REQUIRED'; end if;
  if s.ends_at>now() or s.ends_at<now()-interval '7 days' then raise exception 'REVIEW_WINDOW_CLOSED'; end if;
  if p_score is null or p_score not between 1 and 10 or p_score*2<>trunc(p_score*2) or char_length(coalesce(body,''))>300
    or (p_score<=5 and char_length(coalesce(body,''))<10) then raise exception 'INVALID_REVIEW'; end if;
  select * into existing from private.trust_reviews where kind='meetup' and session_id=s.id and author_id=u;
  if existing.id is not null then
    if existing.score=p_score and existing.body is not distinct from body then return existing.id; end if;
    raise exception 'REVIEW_ALREADY_SUBMITTED';
  end if;
  perform private.enforce_rate_limit('trust_review',10,interval '1 day',interval '5 seconds');
  insert into private.trust_reviews(kind,author_id,session_id,score,body,status,release_at)
    values('meetup',u,s.id,p_score,body,case when p_score<=5 or not exists(select 1 from auth.users a join public.profiles p on p.id=a.id where a.id=u and (a.created_at<=now()-interval '7 days' or p.verification_level>=2)) then 'needs_review' else 'pending' end,s.ends_at)
    returning trust_reviews.id into id;
  return id;
end;
$$;

create function public.write_manner_review(p_session_id uuid,p_conversation_id uuid,p_subject_id uuid,p_signals jsonb,p_body text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); existing private.trust_reviews; id uuid; body text:=nullif(btrim(p_body),''); negative boolean; release_at timestamptz;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u); perform private.lock_relationships();
  if p_subject_id is null or p_subject_id=u then raise exception 'INVALID_SUBJECT'; end if;
  if not private.manner_eligible(u,p_subject_id,p_session_id,p_conversation_id) then raise exception 'ATTENDANCE_REQUIRED'; end if;
  if p_signals is null or jsonb_typeof(p_signals)<>'object' then raise exception 'INVALID_REVIEW'; end if;
  if (select count(*) from jsonb_object_keys(p_signals))<>3
    or not (p_signals ?& array['punctual','respectful','boundaries'])
    or exists(select 1 from jsonb_each(p_signals) v where jsonb_typeof(v.value) not in('boolean','null'))
    or not exists(select 1 from jsonb_each(p_signals) v where jsonb_typeof(v.value)='boolean')
    or (p_conversation_id is not null and p_signals->'punctual'<>'null'::jsonb)
    or char_length(coalesce(body,''))>300 then raise exception 'INVALID_REVIEW'; end if;
  negative:=exists(select 1 from jsonb_each(p_signals) v where v.value='false'::jsonb);
  if negative and char_length(coalesce(body,''))<10 then raise exception 'REVIEW_REASON_REQUIRED'; end if;
  select * into existing from private.trust_reviews where kind='manner' and author_id=u and subject_id=p_subject_id
    and session_id is not distinct from p_session_id and conversation_id is not distinct from p_conversation_id;
  if existing.id is not null then
    if existing.signals=p_signals and existing.body is not distinct from body then return existing.id; end if;
    raise exception 'REVIEW_ALREADY_SUBMITTED';
  end if;
  perform private.enforce_rate_limit('manner_review',10,interval '1 day',interval '5 seconds');
  release_at:=case when p_session_id is not null then (select ends_at+interval '7 days' from private.meetup_sessions where meetup_sessions.id=p_session_id) else now()+interval '7 days' end;
  insert into private.trust_reviews(kind,author_id,subject_id,session_id,conversation_id,signals,body,status,release_at)
    values('manner',u,p_subject_id,p_session_id,p_conversation_id,p_signals,body,case when negative or not exists(select 1 from auth.users a join public.profiles p on p.id=a.id where a.id=u and (a.created_at<=now()-interval '7 days' or p.verification_level>=2)) then 'needs_review' else 'pending' end,release_at)
    returning trust_reviews.id into id;
  return id;
end;
$$;

create function public.get_manner_summary(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with latest as (
    select distinct on (r.author_id,(r.session_id is not null)) r.author_id,r.session_id,r.signals
    from private.trust_reviews r
    where r.kind='manner' and r.subject_id=p_user_id and r.status='published' and private.trust_review_released(r)
      and r.created_at>=now()-interval '30 days' and private.is_active_account(r.author_id)
      and private.is_active_account(p_user_id) and not private.is_blocked_between(auth.uid(),p_user_id)
    order by r.author_id,(r.session_id is not null),r.created_at desc,r.id desc
  ), parts as (
    select session_id is not null meeting,count(distinct author_id)::integer participants,
      round(100.0*count(*) filter(where v.value='true'::jsonb)/nullif(count(*) filter(where jsonb_typeof(v.value)='boolean'),0),0) score
    from latest cross join lateral jsonb_each(signals) v group by session_id is not null
  ) select jsonb_build_object(
    'meeting',coalesce((select jsonb_build_object('participants',participants,'score',case when participants>=5 then score end) from parts where meeting),'{"participants":0,"score":null}'::jsonb),
    'chat',coalesce((select jsonb_build_object('participants',participants,'score',case when participants>=5 then score end) from parts where not meeting),'{"participants":0,"score":null}'::jsonb));
$$;

create function public.get_meetup_reviews(p_post_id uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare average_score numeric; total integer; items jsonb;
begin
  if not exists(select 1 from public.posts p where p.id=p_post_id and p.status='published' and p.room_preview is not null
    and coalesce(p.room_preview->>'eventKind','group')='group' and private.is_active_account(p.author_id)
    and not private.is_blocked_between(auth.uid(),p.author_id) and not private.has_reported(auth.uid(),'post',p.id))
    then return jsonb_build_object('score',null,'participants',0,'reviews','[]'::jsonb); end if;
  select round(avg(score),1),count(*)::integer into average_score,total from(
    select distinct on(r.author_id) r.score from private.trust_reviews r join private.meetup_sessions s on s.id=r.session_id
    where r.kind='meetup' and s.post_id=p_post_id and r.status='published' and private.is_active_account(r.author_id)
      and not private.is_blocked_between(auth.uid(),r.author_id) and not private.has_reported(auth.uid(),'meetup_review',r.id)
    order by r.author_id,r.created_at desc,r.id desc) weighted;
  select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]'::jsonb) into items from(
    select r.created_at,r.id,jsonb_build_object('id',r.id,'authorId',r.author_id,'nickname',p.nickname,'score',r.score,'body',r.body,'createdAt',r.created_at,'sessionDate',s.starts_at) item
    from private.trust_reviews r join private.meetup_sessions s on s.id=r.session_id join public.profiles p on p.id=r.author_id
    where r.kind='meetup' and s.post_id=p_post_id and r.status='published' and p.account_status='active'
      and not private.is_blocked_between(auth.uid(),r.author_id) and not private.has_reported(auth.uid(),'meetup_review',r.id)
    order by r.created_at desc,r.id desc limit 20 offset greatest(0,least(coalesce(p_offset,0),10000))) page;
  return jsonb_build_object('score',average_score,'participants',total,'reviews',items);
end;
$$;

create function public.get_manner_review_state(p_subject_id uuid,p_session_id uuid default null,p_conversation_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); mine private.trust_reviews;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select * into mine from private.trust_reviews where kind='manner' and author_id=u and subject_id=p_subject_id
    and session_id is not distinct from p_session_id and conversation_id is not distinct from p_conversation_id;
  return jsonb_build_object('eligible',private.manner_eligible(u,p_subject_id,p_session_id,p_conversation_id),
    'submitted',mine.id is not null,'status',mine.status);
end;
$$;
-- Keep earned feedback reachable from the profile after an expiry, block or removal from a group.
create function public.get_my_meetup_review_inbox() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select coalesce(jsonb_agg(jsonb_build_object('postId',id,'title',title,'kind',kind) order by latest desc),'[]'::jsonb)
    into result from(select p.id,p.title,coalesce(p.room_preview->>'eventKind','group') kind,max(s.starts_at) latest
      from private.meetup_attendance a join private.meetup_sessions s on s.id=a.session_id join public.posts p on p.id=s.post_id
      where a.user_id=u and s.ends_at>now()-interval '30 days' group by p.id order by max(s.starts_at) desc limit 30) page;
  return result;
end;
$$;
create function public.get_my_manner_feedback() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'context',case when r.session_id is null then 'chat' else 'meeting' end,
    'signals',r.signals,'status',r.status,'createdAt',r.created_at,'appealed',r.appeal_body is not null) order by r.created_at desc),'[]'::jsonb)
    into result from(select * from private.trust_reviews x where kind='manner' and subject_id=u
      and status in('published','held') and private.trust_review_released(x) order by created_at desc limit 50) r;
  return result;
end;
$$;
create function public.appeal_manner_review(p_review_id uuid,p_body text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r private.trust_reviews;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u); perform private.lock_relationships();
  select * into r from private.trust_reviews where id=p_review_id and kind='manner' and subject_id=u for update;
  if r.id is null or r.status<>'published' or not private.trust_review_released(r) then raise exception 'REVIEW_NOT_FOUND'; end if;
  if r.appeal_body is not null then raise exception 'APPEAL_ALREADY_SUBMITTED'; end if;
  if char_length(btrim(coalesce(p_body,''))) not between 10 and 1000 then raise exception 'INVALID_APPEAL'; end if;
  perform private.enforce_rate_limit('manner_appeal',5,interval '1 day',interval '5 seconds');
  update private.trust_reviews set status='held',appeal_body=btrim(p_body),updated_at=clock_timestamp() where id=r.id;
  perform private.notify_admins('safety_alert','manner_review',r.id,'매너 평가 이의제기를 검토해주세요.','/admin?section=safety');
end;
$$;

create function private.trust_safety_content(p_type text,p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when p_type='meetup_attendance' then (select jsonb_build_object('authorId',a.user_id,'text',a.claim_body,
    'updatedAt',a.claim_updated_at,'status',a.claim_status,'sessionId',a.session_id) from private.meetup_attendance a where a.id=p_id and a.claim_body is not null)
  else (select jsonb_build_object('authorId',r.author_id,'text',concat_ws(E'\n',case when r.kind='meetup' then '정기 모임 후기' else '비공개 행동 평가 · 관계 목적 자체는 위반이 아님' end,r.score::text,r.signals::text,r.body,r.appeal_body),
    'updatedAt',r.updated_at,'status',r.status,'subjectId',r.subject_id,'sessionId',r.session_id,'conversationId',r.conversation_id,'signals',r.signals)
    from private.trust_reviews r where r.id=p_id and ((p_type='meetup_review' and r.kind='meetup') or (p_type='manner_review' and r.kind='manner'))) end;
$$;
create function public.get_trust_safety_content(p_target_type text,p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'SERVICE_REQUIRED'; end if;
  return private.trust_safety_content(p_target_type,p_target_id);
end;
$$;
create function public.get_admin_trust_content(p_target_type text,p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare content jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  content:=private.trust_safety_content(p_target_type,p_target_id);
  if content is null then raise exception 'TARGET_NOT_FOUND'; end if;
  perform public.log_admin_access('safety',(content->>'authorId')::uuid,p_target_id);
  return content;
end;
$$;
create function public.review_admin_trust_target(p_target_type text,p_target_id uuid,p_decision text,p_note text,p_expected_updated_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare content jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_decision is null or p_decision not in('published','removed') or char_length(btrim(coalesce(p_note,''))) not between 5 and 1000 then raise exception 'INVALID_REVIEW'; end if;
  perform private.lock_relationships();
  if p_target_type='meetup_attendance' then perform 1 from private.meetup_attendance where id=p_target_id for update;
  elsif p_target_type in('meetup_review','manner_review') then perform 1 from private.trust_reviews where id=p_target_id for update;
  else raise exception 'INVALID_TARGET_TYPE'; end if;
  content:=private.trust_safety_content(p_target_type,p_target_id);
  if content is null then raise exception 'TARGET_NOT_FOUND'; end if;
  if p_expected_updated_at is null or (content->>'updatedAt')::timestamptz<>p_expected_updated_at then raise exception 'STALE_REVIEW'; end if;
  perform public.log_admin_access('safety',(content->>'authorId')::uuid,p_target_id);
  insert into private.trust_review_decisions(target_type,target_id,admin_id,decision,note,previous)
    values(p_target_type,p_target_id,auth.uid(),p_decision,btrim(p_note),content);
  if p_target_type='meetup_attendance' then
    if content->>'status'<>'pending' then raise exception 'CLAIM_NOT_PENDING'; end if;
    update private.meetup_attendance set claim_status=case when p_decision='published' then 'verified' else 'rejected' end,
      confirmed_at=case when p_decision='published' then now() else confirmed_at end,
      confirmation_source=case when p_decision='published' then 'admin' else confirmation_source end,claim_updated_at=clock_timestamp() where id=p_target_id;
  else
    update private.trust_reviews set status=p_decision,updated_at=clock_timestamp() where id=p_target_id;
  end if;
end;
$$;

-- Extend the saved contracts instead of replacing newer safety/report/notification branches.
do $$
declare tbl text; definition text; anchor text; added text;
begin
  foreach tbl in array array['reports','safety_review_queue','safety_alerts','notifications'] loop
    select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid=('public.'||tbl)::regclass and conname=tbl||'_target_type_check';
    if definition is null then raise exception 'TRUST_TARGET_CONSTRAINT_CHANGED'; end if;
    execute format('alter table public.%I drop constraint %I',tbl,tbl||'_target_type_check');
    added:=case when tbl='notifications' then ',''meetup_session''' else '' end;
    execute format('alter table public.%I add constraint %I check ((%s) or target_type in(''meetup_review'',''manner_review'',''meetup_attendance''%s))',tbl,tbl||'_target_type_check',substring(definition from 8 for char_length(definition)-8),added);
  end loop;
  definition:=pg_get_functiondef('private.notification_target_visible(uuid,text,uuid)'::regprocedure); anchor:='case p_target_type';
  if strpos(definition,anchor)=0 then raise exception 'TRUST_VISIBILITY_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$branch$
    when 'meetup_session' then private.can_attend_session(p_target_id,p_user_id)
    when 'meetup_review' then private.is_admin_id(p_user_id)
    when 'manner_review' then private.is_admin_id(p_user_id)
    when 'meetup_attendance' then private.is_admin_id(p_user_id) $branch$);
  definition:=pg_get_functiondef('public.create_report(text,uuid,text,text)'::regprocedure); anchor:='else raise exception ''INVALID_TARGET_TYPE'';';
  if strpos(definition,anchor)=0 then raise exception 'TRUST_REPORT_CHANGED'; end if;
  execute replace(definition,anchor,$branch$
    when 'meetup_review' then select r.author_id into target_user_id from private.trust_reviews r join private.meetup_sessions s on s.id=r.session_id
      join public.posts p on p.id=s.post_id where r.id=target_id and r.kind='meetup' and (private.is_admin() or
        (r.status='published' and p.status='published' and private.is_active_account(r.author_id) and not private.is_blocked_between(current_user_id,r.author_id)));
    when 'manner_review' then select r.author_id into target_user_id from private.trust_reviews r where r.id=target_id and r.kind='manner'
      and private.is_admin();
    $branch$||anchor);
  definition:=pg_get_functiondef('private.capture_report_evidence()'::regprocedure); anchor:='case new.target_type';
  if strpos(definition,anchor)=0 then raise exception 'TRUST_REPORT_EVIDENCE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$branch$
    when 'meetup_review' then select to_jsonb(r) into new.evidence from private.trust_reviews r where r.id=new.target_id;
    when 'manner_review' then select to_jsonb(r)-'body'-'appeal_body'-'author_id' into new.evidence from private.trust_reviews r where r.id=new.target_id;
  $branch$);
  definition:=pg_get_functiondef('public.moderate_report(uuid,text,text)'::regprocedure); anchor:='case report.target_type';
  if strpos(definition,anchor)=0 then raise exception 'TRUST_REPORT_MODERATION_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$branch$ when 'meetup_review','manner_review' then update private.trust_reviews set status='removed',updated_at=clock_timestamp() where id=report.target_id; $branch$);
  definition:=pg_get_functiondef('public.export_admin_safety_evidence(bigint)'::regprocedure); anchor:='content := case a.target_type';
  if strpos(definition,anchor)=0 then raise exception 'TRUST_SAFETY_EVIDENCE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$branch$ when 'meetup_review' then private.trust_safety_content(a.target_type,a.target_id) when 'manner_review' then private.trust_safety_content(a.target_type,a.target_id) when 'meetup_attendance' then private.trust_safety_content(a.target_type,a.target_id) $branch$);
  definition:=pg_get_functiondef('public.get_meetup_sessions(uuid)'::regprocedure); anchor:='''claimStatus'',coalesce(mine.claim_status,''none''),';
  if strpos(definition,anchor)=0 then raise exception 'TRUST_SESSION_VIEW_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$branch$
    'reviewStatus',(select r.status from private.trust_reviews r where r.kind='meetup' and r.session_id=s.id and r.author_id=u),
    'canReview',mine.confirmed_at is not null and s.host_id<>u and s.ends_at<=now() and s.ends_at>now()-interval '7 days' and coalesce(event.room_preview->>'eventKind','group')='group', $branch$);
end;
$$;

create function private.enqueue_trust_safety_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare target text:=case when tg_table_name='meetup_attendance' then 'meetup_attendance' when to_jsonb(new)->>'kind'='meetup' then 'meetup_review' else 'manner_review' end; content text;
begin
  content:=private.trust_safety_content(target,new.id)->>'text';
  if content is null then return new; end if;
  insert into public.safety_review_queue(target_type,target_id,content_hash)
    values(target,new.id,encode(extensions.digest(convert_to(content,'UTF8'),'sha256'),'hex'))
    on conflict(target_type,target_id) do update set status='pending',content_hash=excluded.content_hash,
      risk_score=null,risk_level=null,risk_reasons='[]',attempts=0,last_error=null,next_attempt_at=null,reviewed_at=null,updated_at=now()
    where safety_review_queue.content_hash is distinct from excluded.content_hash;
  if target='meetup_attendance' or to_jsonb(new)->>'status' in('needs_review','held') then
    perform private.notify_admins('safety_alert',target,new.id,'후기·참석 확인 검토가 필요합니다.','/admin?section=safety');
  end if;
  return new;
end;
$$;
create trigger trust_reviews_safety_review after insert or update of score,signals,body,appeal_body on private.trust_reviews
  for each row execute function private.enqueue_trust_safety_review();
create trigger attendance_claim_safety_review after update of claim_body on private.meetup_attendance
  for each row when(new.claim_body is not null) execute function private.enqueue_trust_safety_review();
create function private.apply_trust_safety_review() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.target_type in('meetup_review','manner_review') and new.status='reviewed' and old.status='processing'
    and new.content_hash=encode(extensions.digest(convert_to(private.trust_safety_content(new.target_type,new.target_id)->>'text','UTF8'),'sha256'),'hex') then
    update private.trust_reviews set status=case when new.risk_level='low' then 'published' else 'needs_review' end,
      updated_at=clock_timestamp() where id=new.target_id and status='pending';
  end if;
  return new;
end;
$$;
create trigger trust_safety_completed after update of status on public.safety_review_queue for each row execute function private.apply_trust_safety_review();

create function private.erase_deleted_trust_reviews() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update private.trust_reviews set body=null,appeal_body=null,status='removed',updated_at=clock_timestamp() where author_id=new.id or subject_id=new.id;
  update private.meetup_attendance set claim_body=null where user_id=new.id;
  update private.trust_review_decisions set previous=previous-'text' where previous->>'authorId'=new.id::text or previous->>'subjectId'=new.id::text;
  return new;
end;
$$;
create trigger profiles_erase_trust_reviews after update of account_status on public.profiles
  for each row when(new.account_status='deleted' and old.account_status is distinct from new.account_status) execute function private.erase_deleted_trust_reviews();

revoke all on function private.trust_review_released(private.trust_reviews),private.manner_eligible(uuid,uuid,uuid,uuid),
  private.trust_safety_content(text,uuid),private.enqueue_trust_safety_review(),private.apply_trust_safety_review(),private.erase_deleted_trust_reviews() from public,anon,authenticated,service_role;
revoke all on function public.write_meetup_review(uuid,numeric,text),public.write_manner_review(uuid,uuid,uuid,jsonb,text),
  public.get_manner_summary(uuid),public.get_meetup_reviews(uuid,integer),public.get_manner_review_state(uuid,uuid,uuid),public.get_my_manner_feedback(),
  public.appeal_manner_review(uuid,text),public.get_trust_safety_content(text,uuid),public.get_admin_trust_content(text,uuid),public.review_admin_trust_target(text,uuid,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.get_my_meetup_review_inbox() from public,anon,authenticated,service_role;
grant execute on function public.get_manner_summary(uuid),public.get_meetup_reviews(uuid,integer) to anon,authenticated;
grant execute on function public.write_meetup_review(uuid,numeric,text),public.write_manner_review(uuid,uuid,uuid,jsonb,text),public.get_manner_review_state(uuid,uuid,uuid),
  public.get_my_manner_feedback(),public.appeal_manner_review(uuid,text),public.get_admin_trust_content(text,uuid),public.review_admin_trust_target(text,uuid,text,text,timestamptz) to authenticated;
grant execute on function public.get_my_meetup_review_inbox() to authenticated;
grant execute on function public.get_trust_safety_content(text,uuid) to service_role;
notify pgrst,'reload schema';

-- Existing cron, visibility and report functions run as postgres.
alter function private.trust_review_released(private.trust_reviews) owner to postgres;
alter function private.manner_eligible(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.write_meetup_review(uuid,numeric,text) owner to postgres;
alter function public.write_manner_review(uuid,uuid,uuid,jsonb,text) owner to postgres;
alter function public.get_manner_summary(uuid) owner to postgres;
alter function public.get_meetup_reviews(uuid,integer) owner to postgres;
alter function public.get_manner_review_state(uuid,uuid,uuid) owner to postgres;
alter function public.get_my_meetup_review_inbox() owner to postgres;
alter function public.get_my_manner_feedback() owner to postgres;
alter function public.appeal_manner_review(uuid,text) owner to postgres;
alter function private.trust_safety_content(text,uuid) owner to postgres;
alter function public.get_trust_safety_content(text,uuid) owner to postgres;
alter function public.get_admin_trust_content(text,uuid) owner to postgres;
alter function public.review_admin_trust_target(text,uuid,text,text,timestamptz) owner to postgres;
alter function private.enqueue_trust_safety_review() owner to postgres;
alter function private.apply_trust_safety_review() owner to postgres;
alter function private.erase_deleted_trust_reviews() owner to postgres;
