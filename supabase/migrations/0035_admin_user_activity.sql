-- Private identity projection: never expose auth.users or raw metadata to clients.
create view private.admin_user_directory as
select p.*, u.email, u.email_confirmed_at, u.last_sign_in_at,
  coalesce(u.raw_app_meta_data->>'role','member') as auth_role,
  case when u.email like '%@seed.gling.invalid' then 'example'
    when u.raw_app_meta_data->>'role'='admin' then 'admin'
    when u.raw_app_meta_data->'review_access'='true'::jsonb then 'review' else 'member' end as account_type,
  left(coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name','')),200) as login_name,
  coalesce((select array_agg(distinct i.provider order by i.provider) from auth.identities i where i.user_id=p.id),'{}'::text[]) as providers
from public.profiles p join auth.users u on u.id=p.id;
revoke all on private.admin_user_directory from public,anon,authenticated;

create function public.search_admin_users(p_query text default '',p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_query is null or length(p_query)>200 or p_offset is null or p_offset<0 then raise exception 'INVALID_ADMIN_FILTER'; end if;
  perform public.log_admin_access('users');
  with matched as (
    select * from private.admin_user_directory d
    where strpos(lower(concat_ws(' ',d.id::text,d.nickname::text,d.email,d.login_name)),lower(trim(p_query)))>0
  ) select jsonb_build_object('total',(select count(*) from matched),
    'rows',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from matched order by created_at desc,id desc limit 50 offset p_offset) x),
    'viewer',(select jsonb_build_object('id',u.id,'email',u.email,'role',u.raw_app_meta_data->>'role') from auth.users u where u.id=auth.uid())) into result;
  return result;
end;
$$;
revoke all on function public.search_admin_users(text,integer) from public,anon,authenticated;
grant execute on function public.search_admin_users(text,integer) to authenticated;

-- Each row is an observed, currently retained record, not a reconstructed event log.
create function private.admin_user_events(p_user_id uuid)
returns table(event_key text,kind text,occurred_at timestamptz,actor_id uuid,title text,body text,context_id uuid,state text)
language sql stable set search_path='' as $$
  select 'account:'||p.id,'account',p.created_at,p.id,'계정 생성','현재 닉네임: '||p.nickname,p.id,null from public.profiles p where p.id=p_user_id
  union all
  select 'status:'||p.id,'account',p.account_status_changed_at,null,'현재 계정 상태',coalesce(p.account_status_note,''),p.id,p.account_status from public.profiles p where p.id=p_user_id
  union all
  select 'post:'||p.id,'post',p.created_at,p.author_id,p.title,p.body,p.id,p.status from public.posts p where p.author_id=p_user_id
  union all
  select 'comment:'||c.id,'comment',c.created_at,c.author_id,coalesce(p.title,'댓글 원문'),c.body,c.post_id,case when c.deleted_at is null then 'published' else 'deleted' end from public.comments c left join public.posts p on p.id=c.post_id where c.author_id=p_user_id
  union all
  select 'message:'||m.id,'message',m.created_at,m.sender_id,'보낸 메시지',m.body,m.conversation_id,null from public.messages m where m.sender_id=p_user_id
  union all
  select 'conversation:'||c.id,'conversation',c.created_at,c.requester_id,case c.kind when 'group' then '관련 모임 대화' else '관련 1:1 대화' end,
    coalesce(p.title,'대화 참여자: '||c.user_low_id||' / '||c.user_high_id),c.id,c.status
  from public.conversations c left join public.posts p on p.id=c.group_post_id
  where p_user_id in(c.user_low_id,c.user_high_id) or p.author_id=p_user_id
    or exists(select 1 from public.meetup_requests r where r.post_id=c.group_post_id and r.requester_id=p_user_id)
    or exists(select 1 from public.messages m where m.conversation_id=c.id and m.sender_id=p_user_id)
  union all
  select 'report:'||r.id,'report',r.created_at,r.reporter_id,case when r.reporter_id=p_user_id then '접수한 신고' else '접수된 신고 · 위반 확정 아님' end,
    concat_ws(' · ',r.reason_code,r.details),r.target_id,r.status from public.reports r where p_user_id in(r.reporter_id,r.reported_user_id)
  union all
  select 'moderation:'||a.id,'moderation',a.created_at,a.actor_id,'관리자 조치',coalesce(a.note,''),a.report_id,a.action
  from public.moderation_actions a join public.reports r on r.id=a.report_id where r.reported_user_id=p_user_id
  union all
  select 'meetup:'||r.id,'meetup',r.created_at,r.requester_id,case when r.requester_id=p_user_id then '모임 참여 신청' else '받은 모임 신청' end,
    concat_ws(' · ',p.title,r.message),r.post_id,r.status from public.meetup_requests r left join public.posts p on p.id=r.post_id where p_user_id in(r.requester_id,r.host_id)
  union all
  select 'reaction:'||r.post_id||':'||r.kind,'reaction',r.created_at,r.user_id,case r.kind when 'save' then '게시글 저장' else '게시글 공감' end,p.title,r.post_id,r.kind from public.post_reactions r join public.posts p on p.id=r.post_id where r.user_id=p_user_id
  union all
  select 'comment_like:'||r.comment_id,'reaction',r.created_at,r.user_id,'댓글 공감',c.body,r.comment_id,'like' from public.comment_likes r join public.comments c on c.id=r.comment_id where r.user_id=p_user_id
  union all
  select 'view:'||r.post_id,'view',r.created_at,r.user_id,'게시글 첫 조회 기록',p.title,r.post_id,null from public.post_views r join public.posts p on p.id=r.post_id where r.user_id=p_user_id
  union all
  select 'block:'||b.blocker_id||':'||b.blocked_id,'block',b.created_at,b.blocker_id,case when b.blocker_id=p_user_id then '사용자 차단' else '다른 사용자가 차단함' end,
    '상대 회원 ID: '||case when b.blocker_id=p_user_id then b.blocked_id else b.blocker_id end,null,null from public.blocks b where p_user_id in(b.blocker_id,b.blocked_id)
  union all
  select 'visit:'||v.platform||':'||v.bucket,'visit',v.first_at,v.user_id,'접속 집계 · 30분 구간',
    concat_ws(' · ',v.platform,v.app_version,'마지막 화면 '||v.screen,v.views||'회','마지막 활동 '||v.last_at),null,null from private.analytics_visits v where v.user_id=p_user_id
  union all
  select 'payment:'||e.id,'payment',e.occurred_at,e.user_id,e.event_type,concat_ws(' · ',e.store,e.product_id,e.currency,e.amount::text),null,e.environment from private.payment_events e where e.user_id=p_user_id
  union all
  select 'safety:'||s.id,'safety',s.created_at,null,'안전 검토 · '||s.target_type,concat_ws(' · ',s.risk_level,s.risk_reasons::text),s.target_id,s.status
  from public.safety_review_queue s where
    (s.target_type='post' and exists(select 1 from public.posts p where p.id=s.target_id and p.author_id=p_user_id))
    or (s.target_type='comment' and exists(select 1 from public.comments c where c.id=s.target_id and c.author_id=p_user_id))
    or (s.target_type='message' and exists(select 1 from public.messages m where m.id=s.target_id and m.sender_id=p_user_id));
$$;
revoke all on function private.admin_user_events(uuid) from public,anon,authenticated;

create function public.get_admin_user_overview(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile jsonb; result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('user_detail',p_user_id);
  select to_jsonb(d) into profile from private.admin_user_directory d where d.id=p_user_id;
  if profile is null then raise exception 'USER_NOT_FOUND'; end if;
  select jsonb_build_object('profile',profile,'identity_verified',false,'date_of_birth',null,'age',null,
    'identities',(select coalesce(jsonb_agg(jsonb_build_object('provider',i.provider,'provider_id',i.provider_id,'created_at',i.created_at,'last_sign_in_at',i.last_sign_in_at) order by i.provider),'[]') from auth.identities i where i.user_id=p_user_id),
    'counts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select kind,count(*) as count from private.admin_user_events(p_user_id) group by kind order by kind) x),
    'generatedAt',clock_timestamp()) into result;
  return result;
end;
$$;
revoke all on function public.get_admin_user_overview(uuid) from public,anon,authenticated;
grant execute on function public.get_admin_user_overview(uuid) to authenticated;

create function public.get_admin_user_activity(p_user_id uuid,p_kind text default 'all',
  p_from timestamptz default null,p_until timestamptz default null,p_query text default '',
  p_before timestamptz default null,p_before_key text default null,p_conversation_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_user_id is null or p_kind is null or p_kind not in ('all','account','post','comment','message','conversation','report','moderation','meetup','reaction','view','block','visit','payment','safety')
    or p_query is null or length(p_query)>200 or p_from>p_until
    or (p_before is null)<>(p_before_key is null) or length(p_before_key)>256
    then raise exception 'INVALID_ADMIN_FILTER'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  if p_conversation_id is not null and not exists(select 1 from private.admin_user_events(p_user_id) e where e.kind='conversation' and e.context_id=p_conversation_id)
    then raise exception 'UNRELATED_CONVERSATION'; end if;
  perform public.log_admin_access('user_detail',p_user_id,p_conversation_id);
  with source as (
    select * from private.admin_user_events(p_user_id) where p_conversation_id is null
    union all
    select 'message:'||m.id,'message',m.created_at,m.sender_id,coalesce(p.nickname::text,m.sender_id::text),m.body,m.conversation_id,null
      from public.messages m left join public.profiles p on p.id=m.sender_id where p_conversation_id is not null and m.conversation_id=p_conversation_id
  ), matched as (
    select * from source e where (p_conversation_id is not null or p_kind='all' or e.kind=p_kind)
      and (p_from is null or e.occurred_at>=p_from) and (p_until is null or e.occurred_at<p_until)
      and strpos(lower(concat_ws(' ',e.event_key,e.actor_id::text,e.title,e.body,e.context_id::text,e.state)),lower(trim(p_query)))>0
  ), page as (
    select * from matched where p_before is null or (occurred_at,event_key)<(p_before,p_before_key)
    order by occurred_at desc,event_key desc limit 51
  ), visible as (select * from page order by occurred_at desc,event_key desc limit 50)
  select jsonb_build_object('total',(select count(*) from matched),
    'rows',(select coalesce(jsonb_agg(to_jsonb(v) order by occurred_at desc,event_key desc),'[]') from visible v),
    'nextCursor',case when (select count(*) from page)>50 then (select jsonb_build_object('at',occurred_at,'key',event_key) from visible order by occurred_at,event_key limit 1) else null end,
    'generatedAt',clock_timestamp()) into result;
  return result;
end;
$$;
revoke all on function public.get_admin_user_activity(uuid,text,timestamptz,timestamptz,text,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.get_admin_user_activity(uuid,text,timestamptz,timestamptz,text,timestamptz,text,uuid) to authenticated;
