-- Live campaign dashboard (owner 2026-11-03 "이 캠페인의 성과를 계속해서 나는 라이브트래킹 가능해야지 현재 캠페인의 문제점을
-- 파악하고 바로 개선할수잇잖아", then "컨펌 답 (캠페인 현황판 아이디어)": all eight ideas "넣기", plus "나도 콜라보로 또 올렷잖아
-- 당첨자 발표하는 캐러셀 그것도 조회수 700나옴"). Runs after 20261102151000_admin_event_board_store_uses. It only adds:
-- one number log, one rule function, and admin-only read/write functions. get_admin_event_board is unchanged.

-- Every number the board does not already hold: view counts of creator content and of our own collab posts (official API or a
-- creator's capture), and what the business reports (Google searches, directions, calls, Instagram visits, sales).
-- confirmed=false marks an estimate, so reports never present a guess as a measured value.
create table private.partnership_metrics (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references private.partnership_campaigns(id),
  participation_id uuid references private.partnership_participations(id),
  subject text not null check(subject in ('creator_content','our_post','store')),
  metric text not null check(metric in ('views','likes','comments','shares','saves','google_searches','google_directions',
    'google_calls','ig_profile_visits','ig_follows','customers','sales_cents','discount_total_cents')),
  value bigint not null check(value between 0 and 1000000000000),
  url text check(url ~ '^https://www\.instagram\.com/(reel|p)/[A-Za-z0-9_-]{5,40}/$'),
  period_start date,
  period_end date check(period_end>=period_start),
  observed_at timestamptz not null default clock_timestamp(),
  source text not null check(source in ('graph_api','creator_capture','store_report','owner')),
  confirmed boolean not null default true,
  note text not null default '' check(char_length(note)<=500),
  created_at timestamptz not null default clock_timestamp(),
  check(case subject
    when 'creator_content' then participation_id is not null and url is not null
      and metric in ('views','likes','comments','shares','saves')
    when 'our_post' then participation_id is null and url is not null and metric in ('views','likes','comments','shares','saves')
    else participation_id is null and url is null and period_start is not null and period_end is not null
      and metric not in ('views','likes','comments','shares','saves') end)
);
create index partnership_metrics_campaign on private.partnership_metrics(campaign_id,subject,observed_at);
alter table private.partnership_metrics owner to postgres;
alter table private.partnership_metrics enable row level security;
revoke all on private.partnership_metrics from public,anon,authenticated,service_role;

-- What needs fixing now, most urgent first. Also read by the 08:00 report through the database owner, so it takes no
-- session and lives in private; only the admin function below hands it to a browser.
-- Rates are this campaign's own (proposed->replied, replied->confirmed) and are left out until 5 people were contacted.
create function private.campaign_alerts(p_campaign_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with c as (
    select c.*,z.timezone from private.partnership_campaigns c join private.merchants m on m.id=c.merchant_id
      join public.cities z on z.id=m.city_id where c.id=p_campaign_id),
  p as (
    select p.*,r.display_name,
      coalesce((select max(e.created_at) from private.partnership_events e where e.resource_id=p.id
        and e.action in ('participation_created','participation_outreach_moved','participation_dm_noted')
        and coalesce(e.details->>'outreach_stage',e.details->>'to')=p.outreach_stage),p.created_at) as stage_since
    from private.partnership_participations p join private.partnership_creators r on r.id=p.creator_id
    where p.campaign_id=p_campaign_id),
  n as (
    select count(*) filter (where contacted) contacted,
      count(*) filter (where outreach_stage in ('replied','confirmed','posted')) replied,
      count(*) filter (where outreach_stage in ('confirmed','posted')) confirmed,
      count(*) filter (where outreach_stage='proposed') proposed,
      count(*) filter (where outreach_stage='candidate') candidates
    from p),
  r as (
    select n.*,c.team_limit,
      case when n.contacted>=5 then n.replied::numeric/n.contacted end r1,
      case when n.replied>0 then n.confirmed::numeric/n.replied end r2
    from n,c),
  link as (select l.created_at from private.partnership_campaign_links l
    where l.campaign_id=p_campaign_id and l.kind='store' and l.revoked_at is null order by l.created_at limit 1),
  a as (
    -- More people to propose to: confirmed plus what the waiting ones are expected to bring falls short of the team limit.
    select 1 o,'red' level,'pipeline_low' kind,'[]'::jsonb people,
      jsonb_build_object('confirmed',r.confirmed,'team_limit',r.team_limit,'candidates',r.candidates,'waiting',r.proposed,
        'expected',round(r.confirmed+r.proposed*r.r1*r.r2+r.candidates*r.r1*r.r2,1),
        'more_to_propose',ceil((r.team_limit-(r.confirmed+r.proposed*r.r1*r.r2+r.candidates*r.r1*r.r2))/nullif(r.r1*r.r2,0))) facts
    from r where r.team_limit is not null and r.r1>0 and r.r2>0
      and r.confirmed+r.proposed*r.r1*r.r2+r.candidates*r.r1*r.r2<r.team_limit
    union all
    -- The store link is live but its screen has no benefit to show.
    select 2,'red','benefit_missing','[]',jsonb_build_object('store_link_since',(select created_at from link))
    from c where exists(select 1 from link) and not exists(select 1 from private.partnership_benefits b
      where b.campaign_id=c.id and b.audience='creators' and b.status='active')
    union all
    select 3,'orange','confirmed_no_date',jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by display_name),
      jsonb_build_object('count',count(*))
    from p where outreach_stage='confirmed' and scheduled_at is null having count(*)>0
    union all
    -- The visit time passed, the store link existed then, and staff never checked the person.
    select 4,'orange','visit_unchecked',jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'scheduled_at',p.scheduled_at)
        order by p.scheduled_at),jsonb_build_object('count',count(*))
    from p,link where p.visited_at is null and p.scheduled_at<clock_timestamp()-interval '12 hours'
      and p.scheduled_at>link.created_at and not exists(select 1 from private.partnership_store_uses u
        where u.campaign_id=p.campaign_id and u.creator_id=p.creator_id and u.cancelled_at is null
          and u.used_at>p.scheduled_at-interval '1 day')
    having count(*)>0
    union all
    select 5,'orange','no_content_7d',jsonb_agg(jsonb_build_object('id',id,'name',display_name,'visited_at',visited_at)
        order by visited_at),jsonb_build_object('count',count(*))
    from p where visited_at<clock_timestamp()-interval '7 days' and coalesce(content_url,'')='' and outreach_stage<>'posted'
    having count(*)>0
    union all
    select 6,'yellow','proposed_no_reply',jsonb_agg(jsonb_build_object('id',id,'name',display_name,'since',stage_since)
        order by stage_since),jsonb_build_object('count',count(*))
    from p where outreach_stage='proposed' and stage_since<clock_timestamp()-interval '3 days' having count(*)>0
    union all
    -- Content three days old whose latest count is under the campaign's view bar.
    select 7,'yellow','content_low_views',jsonb_agg(jsonb_build_object('id',x.id,'name',x.display_name,'views',x.views)
        order by x.views),jsonb_build_object('count',count(*),'minimum_views',max(x.minimum_views))
    from (select p.id,p.display_name,c.minimum_views,(select m.value from private.partnership_metrics m
        where m.participation_id=p.id and m.subject='creator_content' and m.metric='views' order by m.observed_at desc limit 1) views,
        (select min(m.observed_at) from private.partnership_metrics m where m.participation_id=p.id and m.subject='creator_content') first_seen
      from p,c where c.minimum_views is not null) x
    where x.views<x.minimum_views and x.first_seen<clock_timestamp()-interval '3 days' having count(*)>0
    union all
    select 8,'yellow','hold_waiting',jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by display_name),
      jsonb_build_object('count',count(*))
    from p where outreach_stage='hold' having count(*)>0)
  select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'level',level,'people',people,'facts',facts) order by o),'[]') from a
$$;
alter function private.campaign_alerts(uuid) owner to postgres;
revoke all on function private.campaign_alerts(uuid) from public,anon,authenticated,service_role;

-- What the dashboard adds to the board's campaign: entry fields the board leaves out, store checks per local day,
-- the number log, our result posts, what the business gives creators, and the alerts.
create function public.get_admin_campaign_live(p_campaign_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare res jsonb;
begin
  perform private.lock_partnership_actor();
  if p_campaign_id is null or not exists(select 1 from private.partnership_campaigns where id=p_campaign_id) then
    raise exception 'PARTNERSHIP_NOT_FOUND';
  end if;
  select jsonb_build_object(
    'campaign_id',c.id,'observed_at',clock_timestamp(),'timezone',z.timezone,
    'support',jsonb_build_object('amount_cents',c.support_amount_cents,'currency',c.currency,'terms',c.terms,
      'minimum_views',c.minimum_views),
    'entries',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'visited_at',p.visited_at,'content_url',p.content_url,
        'actual_views',p.actual_views,'created_at',p.created_at,
        'stage_since',coalesce((select max(e.created_at) from private.partnership_events e where e.resource_id=p.id
          and e.action in ('participation_created','participation_outreach_moved','participation_dm_noted')
          and coalesce(e.details->>'outreach_stage',e.details->>'to')=p.outreach_stage),p.created_at)) order by p.created_at,p.id),'[]')
      from private.partnership_participations p where p.campaign_id=c.id),
    'store_uses_by_day',(select coalesce(jsonb_object_agg(d,n),'{}') from (select (u.used_at at time zone z.timezone)::date d,count(*) n
      from private.partnership_store_uses u where u.campaign_id=c.id and u.cancelled_at is null group by 1) x),
    'metrics',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'participation_id',m.participation_id,'subject',m.subject,
        'metric',m.metric,'value',m.value,'url',m.url,'period_start',m.period_start,'period_end',m.period_end,
        'observed_at',m.observed_at,'source',m.source,'confirmed',m.confirmed,'note',m.note) order by m.observed_at,m.id),'[]')
      from (select * from private.partnership_metrics where campaign_id=c.id order by observed_at desc limit 5000) m),
    'result_posts',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'permalink',r.permalink,
        'published_at',r.published_at) order by r.created_at),'[]') from private.partnership_result_posts r where r.campaign_id=c.id),
    'alerts',private.campaign_alerts(c.id))
  into res
  from private.partnership_campaigns c join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id
  where c.id=p_campaign_id;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,p_campaign_id);
  return res;
end $$;

-- The owner types what the business reported, a creator's capture, or an estimate. API counts come from the collector only.
create function public.add_admin_campaign_metric(p_campaign_id uuid,p_participation_id uuid,p_subject text,p_metric text,
  p_value bigint,p_url text,p_period_start date,p_period_end date,p_source text,p_confirmed boolean,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
  perform private.lock_partnership_actor();
  if p_source is null or p_source not in ('creator_capture','store_report','owner') then raise exception 'INVALID_PARTNERSHIP'; end if;
  if p_campaign_id is null or not exists(select 1 from private.partnership_campaigns where id=p_campaign_id) then
    raise exception 'PARTNERSHIP_NOT_FOUND';
  end if;
  if p_participation_id is not null and not exists(select 1 from private.partnership_participations
      where id=p_participation_id and campaign_id=p_campaign_id) then
    raise exception 'PARTNERSHIP_NOT_FOUND';
  end if;
  perform private.assert_partnership_admin();
  insert into private.partnership_metrics(campaign_id,participation_id,subject,metric,value,url,period_start,period_end,source,confirmed,note)
    values(p_campaign_id,p_participation_id,p_subject,p_metric,p_value,nullif(p_url,''),p_period_start,p_period_end,p_source,
      coalesce(p_confirmed,true),left(coalesce(p_note,''),500))
    returning id into rid;
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),rid,'campaign_metric_added',
    jsonb_build_object('kind','metric','campaign_id',p_campaign_id,'subject',p_subject,'metric',p_metric,'value',p_value,'source',p_source));
  perform public.log_admin_access('analytics',null,p_campaign_id);
  return rid;
end $$;

-- A typed number can be taken back; API rows stay so the view history is not edited by hand.
create function public.delete_admin_campaign_metric(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare m private.partnership_metrics;
begin
  perform private.lock_partnership_actor();
  select * into m from private.partnership_metrics where id=p_id;
  if m.id is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  if m.source='graph_api' then raise exception 'INVALID_PARTNERSHIP'; end if;
  perform private.assert_partnership_admin();
  delete from private.partnership_metrics where id=p_id;
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),p_id,'campaign_metric_deleted',
    jsonb_build_object('kind','metric','campaign_id',m.campaign_id,'subject',m.subject,'metric',m.metric,'value',m.value,'source',m.source));
  perform public.log_admin_access('analytics',null,m.campaign_id);
end $$;

alter function public.get_admin_campaign_live(uuid) owner to postgres;
alter function public.add_admin_campaign_metric(uuid,uuid,text,text,bigint,text,date,date,text,boolean,text) owner to postgres;
alter function public.delete_admin_campaign_metric(uuid) owner to postgres;
revoke all on function public.get_admin_campaign_live(uuid),
  public.add_admin_campaign_metric(uuid,uuid,text,text,bigint,text,date,date,text,boolean,text),
  public.delete_admin_campaign_metric(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_campaign_live(uuid),
  public.add_admin_campaign_metric(uuid,uuid,text,text,bigint,text,date,date,text,boolean,text),
  public.delete_admin_campaign_metric(uuid) to authenticated;
notify pgrst,'reload schema';
