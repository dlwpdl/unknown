-- Expose only existing session IP/timestamps through the audited admin functions.
-- No new tracking or copies of auth session secrets.
create or replace view private.admin_user_directory as
select p.*, u.email, u.email_confirmed_at, u.last_sign_in_at,
  coalesce(u.raw_app_meta_data->>'role','member') as auth_role,
  case when u.email like '%@seed.gling.invalid' then 'example'
    when u.raw_app_meta_data->>'role'='admin' then 'admin'
    when u.raw_app_meta_data->'review_access'='true'::jsonb then 'review' else 'member' end as account_type,
  left(coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name','')),200) as login_name,
  coalesce((select array_agg(distinct i.provider order by i.provider) from auth.identities i where i.user_id=p.id),'{}'::text[]) as providers,
  host(s.ip) as session_ip,s.created_at as session_created_at,s.updated_at as session_updated_at
from public.profiles p join auth.users u on u.id=p.id
left join lateral (select x.ip,x.created_at,x.updated_at from auth.sessions x where x.user_id=p.id
  order by coalesce(x.updated_at,x.created_at) desc,x.id desc limit 1) s on true;

create or replace function private.admin_user_events(p_user_id uuid)
returns table(event_key text,kind text,occurred_at timestamptz,actor_id uuid,title text,body text,context_id uuid,state text)
language sql stable set search_path='' as $$
  select 'account:'||p.id,'account',p.created_at,p.id,'계정 생성','현재 닉네임: '||p.nickname,p.id,null from public.profiles p where p.id=p_user_id
  union all
  select 'session:'||s.id,'account',s.created_at,s.user_id,'인증 세션 기록',
    concat_ws(' · ','기록 IP: '||coalesce(host(s.ip),'미기록'),'세션 생성: '||s.created_at,'세션 갱신: '||s.updated_at),null,null
  from auth.sessions s where s.user_id=p_user_id
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
