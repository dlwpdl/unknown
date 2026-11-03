-- Campaign report, step 1 (owner 2026-11-03 "1.2.3 해보자"; approved admin mockup "이거 좋다"; plan in
-- output/reviews/creator-matching-bm-2026-11-02/build/PLAN.md). The business opens one link and sees the campaign's numbers live;
-- on day 30 the same link shows them fixed. The number log only grows: a wrong number is never deleted, a row that corrects it
-- is added. Gling's own working minutes per step go in the same log. Runs after 20261103030000.

-- 1. The log takes store base values, hosted meals, guest_sales_cents (what discount guests paid, unlike sales_cents), our minutes and POS numbers.
-- corrects: the row this one corrects (at most one correction per row). withdrawn: this row voids the one it corrects and holds 0.
alter table private.partnership_metrics
  drop constraint partnership_metrics_subject_check,
  drop constraint partnership_metrics_metric_check,
  drop constraint partnership_metrics_source_check,
  drop constraint partnership_metrics_check1,
  add constraint partnership_metrics_subject_check check(subject in ('creator_content','our_post','store','gling')),
  add constraint partnership_metrics_metric_check check(metric in ('views','likes','comments','shares','saves','google_searches',
    'google_directions','google_calls','ig_profile_visits','ig_follows','customers','sales_cents','discount_total_cents',
    'ig_followers','google_reviews','hosted_meals_cents','minutes_setup','minutes_discovery','minutes_outreach','minutes_schedule',
    'minutes_visit','minutes_content','minutes_report','minutes_exceptions','guest_sales_cents')),
  add constraint partnership_metrics_source_check check(source in ('graph_api','creator_capture','store_report','owner','pos')),
  -- As before, plus: our minutes are gling rows with a period, and only gling rows hold minutes.
  add constraint partnership_metrics_check1 check(case subject
    when 'creator_content' then participation_id is not null and url is not null
      and metric in ('views','likes','comments','shares','saves')
    when 'our_post' then participation_id is null and url is not null and metric in ('views','likes','comments','shares','saves')
    when 'gling' then participation_id is null and url is null and period_start is not null and period_end is not null
      and metric like 'minutes%'
    else participation_id is null and url is null and period_start is not null and period_end is not null
      and metric not in ('views','likes','comments','shares','saves') and metric not like 'minutes%' end),
  add column corrects uuid unique references private.partnership_metrics(id),
  add column withdrawn boolean not null default false,
  add constraint partnership_metrics_withdrawn check(not withdrawn or (corrects is not null and value=0));

-- The numbers that count: not a withdrawal, and not corrected by another row. Correcting a correction leaves only the last one.
create view private.partnership_metrics_live as
  select m.* from private.partnership_metrics m
  where not m.withdrawn and not exists(select 1 from private.partnership_metrics x where x.corrects=m.id);
alter view private.partnership_metrics_live owner to postgres;
revoke all on private.partnership_metrics_live from public,anon,authenticated,service_role;

-- 2. The live dashboard reads the same view in this same migration, so no deploy gap counts a corrected number twice.
-- The bodies and grants below are 20261103020000's, with only `from private.partnership_metrics` read as
-- `from private.partnership_metrics_live`.
-- What needs fixing now, most urgent first. Also read by the 08:00 report through the database owner, so it takes no
-- session and lives in private; only the admin function below hands it to a browser.
-- Rates are this campaign's own (proposed->replied, replied->confirmed) and are left out until 5 people were contacted.
create or replace function private.campaign_alerts(p_campaign_id uuid) returns jsonb
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
    from (select p.id,p.display_name,c.minimum_views,(select m.value from private.partnership_metrics_live m
        where m.participation_id=p.id and m.subject='creator_content' and m.metric='views' order by m.observed_at desc limit 1) views,
        (select min(m.observed_at) from private.partnership_metrics_live m where m.participation_id=p.id and m.subject='creator_content') first_seen
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
create or replace function public.get_admin_campaign_live(p_campaign_id uuid) returns jsonb
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
      from (select * from private.partnership_metrics_live where campaign_id=c.id order by observed_at desc limit 5000) m),
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
alter function public.get_admin_campaign_live(uuid) owner to postgres;
revoke all on function public.get_admin_campaign_live(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_campaign_live(uuid) to authenticated;

-- 3. One report per campaign: its start date (base values and day 30 count from it), the day-30 snapshot (never undone),
-- what we learned, and whether the business lets us show the result. The proof of that permission (a DM capture) stays in the
-- private operations folder; consent_evidence only says where it is.
create table private.partnership_reports (
  campaign_id uuid primary key references private.partnership_campaigns(id) on delete cascade,
  starts_on date check(isfinite(starts_on)),
  fixed_at timestamptz,
  fixed jsonb,
  lessons text check(char_length(lessons)<=1000),
  consent text not null default 'closed' check(consent in ('closed','anon','open')),
  consent_on date check(isfinite(consent_on)),
  consent_evidence text check(char_length(consent_evidence)<=300),
  updated_at timestamptz not null default now(),
  check((fixed_at is null)=(fixed is null)),
  check(consent='closed' or (consent_on is not null and coalesce(btrim(consent_evidence),'')<>''))
);
alter table private.partnership_reports owner to postgres;
alter table private.partnership_reports enable row level security;
revoke all on private.partnership_reports from public,anon,authenticated,service_role;

-- 4. The report link: a token kept only as its hash, like the store link. One live report link per campaign.
alter table private.partnership_campaign_links
  drop constraint partnership_campaign_links_kind_check,
  drop constraint partnership_campaign_links_check,
  add constraint partnership_campaign_links_kind_check check(kind in ('apply','store','report')),
  add constraint partnership_campaign_links_check check((kind='apply' and slug is not null and token_sha256 is null)
    or (kind in ('store','report') and token_sha256 is not null and slug is null));
create unique index partnership_campaign_links_report on private.partnership_campaign_links(campaign_id)
  where kind='report' and revoked_at is null;

-- As 20261102120000, plus: a report stays readable after the campaign closes (the business keeps its result); a revoked or
-- expired link still opens nothing.
create or replace function private.event_link_campaign(p_kind text,p_key text) returns uuid
language sql stable set search_path='' as $$
  select c.id from private.partnership_campaign_links l
    join private.partnership_campaigns c on c.id=l.campaign_id
    join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id
  where l.kind=p_kind and (case p_kind when 'apply' then l.slug else l.token_sha256 end)=p_key
    and l.revoked_at is null and m.deleted_at is null
    and l.expires_on>=(clock_timestamp() at time zone z.timezone)::date
    and (p_kind in ('store','report') or c.status='open')
$$;

-- 5. Who counts as having applied, on the report and on the store page alike.
-- Someone the board added is an applicant only once they apply through the link; once confirmed they count in confirmed, visited and posted.
create function private.event_applicant(p private.partnership_participations) returns boolean
language sql stable set search_path='' as $$
  select p.applied_via='apply_link' or not exists(select 1 from private.partnership_events e
    where e.resource_id=p.id and e.action='participation_created' and e.details->>'source'='event_board')
$$;

-- The body below is 20261102130000's and the grants are its original ones (20261102120000), with only applicant_count
-- counting event_applicant.
-- As step 1, plus each benefit's conditions so the business sees the same rules the DMs state.
create or replace function public.event_store_view(p_token_sha256 text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('title',c.title,'business',m.name,'avatar',public.get_merchant_profile(m.id)->>'avatar_path',
    'ends_on',c.ends_on,'deadline_note',c.deadline_note,'timezone',z.timezone,
    'applicant_count',(select count(*) from private.partnership_participations p where p.campaign_id=c.id and private.event_applicant(p)),
    'winners',(select coalesce(jsonb_agg(jsonb_build_object('handle',w.handle,'name',w.display_name,'scheduled_at',w.scheduled_at,
          'party_size',w.party_size,'has_allergies',w.has_allergies,'allergies',w.allergies)
        order by w.scheduled_at nulls last,w.display_name),'[]')
      from (select r.display_name,p.scheduled_at,p.party_size,p.has_allergies,p.allergies,substring(private.partnership_profile_key(r.profile_url) from '^https://instagram[.]com/([^/]+)$') handle
        from private.partnership_participations p join private.partnership_creators r on r.id=p.creator_id
        where p.campaign_id=c.id and private.event_winner(p)) w),
    'benefits',(select coalesce(jsonb_agg(jsonb_build_object('title',b.title,'discount_percent',b.discount_percent,'expires_on',b.expires_on,'terms',b.terms,
          'starts_on',b.starts_on,'max_discount_cents',b.max_discount_cents,'weekdays',b.weekdays,'dine_in_only',b.dine_in_only,'checkout_note',b.checkout_note)
        order by b.created_at,b.id),'[]')
      from private.partnership_benefits b where b.campaign_id=c.id and b.status='active'))
  from private.partnership_campaigns c join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id
  where c.id=private.event_link_campaign('store',p_token_sha256)
$$;
alter function public.event_store_view(text) owner to postgres;
revoke all on function public.event_store_view(text) from public,anon,authenticated,service_role;
grant execute on function public.event_store_view(text) to service_role;

-- 6. The only builder of the report. p_for_business=false adds what only admins see: creator handles and entries, store notes
-- and row ids, and our minutes. The business never gets notes, alerts, candidate or hold counts, creator names, or minutes.
create function private.campaign_report(p_campaign uuid,p_for_business boolean) returns jsonb
language sql stable security definer set search_path='' as $$
  with c as (
    select c.id,c.title,coalesce(c.currency,'CAD') currency,m.name business,z.timezone tz,r.starts_on,r.fixed_at
    from private.partnership_campaigns c join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id
      left join private.partnership_reports r on r.campaign_id=c.id
    where c.id=p_campaign),
  live as (select * from private.partnership_metrics_live where campaign_id=p_campaign),
  -- Counter checks on the store link that were not undone, by the business's day.
  uses as (select u.kind,(u.used_at at time zone c.tz)::date d from private.partnership_store_uses u,c
    where u.campaign_id=c.id and u.cancelled_at is null),
  -- What the store spent: its discounts plus the winners' meals it hosted. What the discount guests paid is sales, not spend.
  money as (select *,case when discount is not null or meals is not null then coalesce(discount,0)+coalesce(meals,0) end spend
    from (select sum(value) filter (where metric='discount_total_cents') discount,sum(value) filter (where metric='hosted_meals_cents') meals,
        sum(value) filter (where metric='guest_sales_cents') guest_sales,
        coalesce(bool_and(confirmed) filter (where metric in ('discount_total_cents','hosted_meals_cents','guest_sales_cents')),false) confirmed
      from live where subject='store') x),
  -- Per Instagram link: the latest live value of each number, and when the link was first measured.
  latest as (
    select distinct on (subject,url,participation_id,metric) subject,url,participation_id,metric,value,observed_at,confirmed,
      min(observed_at) over (partition by subject,url,participation_id) first_at
    from live where subject in ('creator_content','our_post') order by subject,url,participation_id,metric,observed_at desc,id desc),
  content as (
    select subject,url,participation_id,min(first_at) first_at,
      max(value) filter (where metric='views') views,max(observed_at) filter (where metric='views') views_at,
      max(value) filter (where metric='likes') likes,max(value) filter (where metric='comments') comments,
      max(value) filter (where metric='shares') shares,max(value) filter (where metric='saves') saves,bool_and(confirmed) confirmed
    from latest group by subject,url,participation_id),
  -- A creator is a letter (A, B, …) in the order their first content was measured; all their links share it.
  ranked as (
    select *,row_number() over (partition by subject order by first_at,url) nth,
      dense_rank() over (partition by subject order by person_first,participation_id) person
    from (select *,min(first_at) over (partition by subject,participation_id) person_first from content) x)
  select jsonb_build_object('title',c.title,'business',c.business,'currency',c.currency,'starts_on',c.starts_on,
    'fix_on',c.starts_on+29,'fixed_at',c.fixed_at,'synced_at',now(),
    'guests',(select jsonb_build_object('total',count(*),'discount',count(*) filter (where kind='discount'),
        'winner',count(*) filter (where kind='winner'),
        'by_day',coalesce((select jsonb_agg(jsonb_build_object('day',d,'n',n) order by d) from (select d,count(*) n from uses group by d) x),'[]'))
      from uses),
    'money',(select jsonb_build_object('discount_total_cents',discount,'hosted_meals_cents',meals,'guest_sales_cents',guest_sales,'store_spend_cents',spend,
        'per_guest_cents',round(spend/nullif((select count(*) from uses),0))::bigint,'confirmed',confirmed) from money),
    'contents',(select coalesce(jsonb_agg(jsonb_build_object('label',case when subject='our_post' then '우리 글 '||nth
          when person<=26 then chr(64+person::int) else chr(64+((person-1)/26)::int)||chr(65+((person-1)%26)::int) end,
        'kind',subject,'url',url,'first_seen',(first_at at time zone c.tz)::date,'views',views,'views_at',views_at,
        'likes',likes,'comments',comments,'shares',shares,'saves',saves,'confirmed',confirmed)
      ||case when not p_for_business then jsonb_build_object('participation_id',participation_id,
          'handle',(select coalesce(substring(private.partnership_profile_key(r.profile_url) from '^https://instagram[.]com/([^/]+)$'),r.display_name)
            from private.partnership_participations p join private.partnership_creators r on r.id=p.creator_id where p.id=ranked.participation_id))
        else '{}' end
      order by subject,person_first,participation_id,first_at,url),'[]') from ranked),
    'views_total',(select coalesce(sum(views),0) from content),
    -- Every live store row; one whose period ends before the start is a base value.
    'store',(select coalesce(jsonb_agg(jsonb_build_object('metric',metric,'value',value,'period_start',period_start,'period_end',period_end,
        'source',source,'confirmed',confirmed,'before_start',coalesce(period_end<c.starts_on,false))
      ||case when not p_for_business then jsonb_build_object('id',id,'note',note) else '{}' end
      order by period_start,period_end,metric,observed_at,id),'[]') from live where subject='store'),
    -- Head counts only; how many are still candidates, on hold or dropped stays on the admin board.
    'people',(select jsonb_build_object('applied',count(*) filter (where private.event_applicant(p)),'confirmed',count(*) filter (where x.w),
        'visited',count(*) filter (where x.w and (p.visited_at is not null or p.stage in ('visited','submitted','completed'))),
        'posted',count(*) filter (where x.w and (p.outreach_stage='posted' or p.content_url<>'' or p.stage in ('submitted','completed')
          or exists(select 1 from live where live.participation_id=p.id and live.subject='creator_content'))))
      from private.partnership_participations p cross join lateral (select private.event_winner(p) w) x where p.campaign_id=c.id))
  ||case when not p_for_business then jsonb_build_object('minutes',(select jsonb_build_object('total',coalesce(sum(n),0),
      'by_step',coalesce(jsonb_object_agg(metric,n),'{}')) from (select metric,sum(value) n from live where subject='gling' group by metric) x))
    else '{}' end
  from c
$$;

-- What the business sees through its report link (event-link edge function, service_role). Once fixed, the day-30 snapshot.
create function public.event_report_view(p_token_sha256 text) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when r.fixed_at is not null then r.fixed||jsonb_build_object('synced_at',now(),'fixed_at',r.fixed_at)
    else private.campaign_report(x.cid,true) end
  from (select private.event_link_campaign('report',p_token_sha256) cid) x
    left join private.partnership_reports r on r.campaign_id=x.cid
  where x.cid is not null
$$;

-- 7. Admin functions (admin with a live AAL2 session, checked like the other partnership functions).

-- The admin report, the whole log with corrected and withdrawn rows marked, the report link without its token, and the report row.
create function public.get_admin_campaign_report(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare res jsonb;
begin
  perform private.lock_partnership_actor();
  if p_campaign is null or not exists(select 1 from private.partnership_campaigns where id=p_campaign) then
    raise exception 'PARTNERSHIP_NOT_FOUND';
  end if;
  res:=jsonb_build_object('report',private.campaign_report(p_campaign,false),
    'ledger',(select coalesce(jsonb_agg((to_jsonb(m)-'campaign_id')||jsonb_build_object('corrected_by',
        (select x.id from private.partnership_metrics x where x.corrects=m.id)) order by m.created_at desc,m.id desc),'[]')
      from (select * from private.partnership_metrics where campaign_id=p_campaign order by created_at desc,id desc limit 1000) m),
    'link',(select jsonb_build_object('created_at',l.created_at,'expires_on',l.expires_on,'revoked_at',l.revoked_at)
      from private.partnership_campaign_links l where l.campaign_id=p_campaign and l.kind='report' order by l.created_at desc,l.id desc limit 1),
    'report_row',(select to_jsonb(r)-'campaign_id' from private.partnership_reports r where r.campaign_id=p_campaign));
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,p_campaign);
  return res;
end $$;

-- One row onto the log. To fix a number, send corrects=<its id> with the right value, or withdrawn=true to void it; a correcting
-- row keeps the original's campaign, subject, metric and person, and takes the fields it leaves out from the original.
create function public.add_admin_campaign_ledger(p_campaign uuid,p_entry jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e jsonb:=p_entry; o private.partnership_metrics; r private.partnership_metrics;
begin
  perform private.lock_partnership_actor();
  if p_campaign is null or jsonb_typeof(e) is distinct from 'object' or exists(select 1 from jsonb_each(e) f
      where f.key<>all(array['subject','metric','value','url','period_start','period_end','observed_at','source','confirmed','note',
        'participation_id','corrects','withdrawn'])
        or (f.value<>'null' and jsonb_typeof(f.value)<>case when f.key='value' then 'number'
          when f.key in ('confirmed','withdrawn') then 'boolean' else 'string' end))
    -- API counts come from the collector only.
    or coalesce(e->>'source','') not in ('creator_capture','store_report','owner','pos') then
    raise exception 'INVALID_PARTNERSHIP';
  end if;
  perform 1 from private.partnership_campaigns where id=p_campaign for share;
  if not found then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  if e->>'corrects' is not null then
    select * into o from private.partnership_metrics where id=(e->>'corrects')::uuid for update;
    if o.id is null or o.campaign_id<>p_campaign then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
    if exists(select 1 from private.partnership_metrics where corrects=o.id) then raise exception 'PARTNERSHIP_CHANGED'; end if;
    e:=jsonb_build_object('subject',o.subject,'metric',o.metric,'participation_id',o.participation_id,'url',o.url,
      'period_start',o.period_start,'period_end',o.period_end)||e;
    if (e->>'subject',e->>'metric',(e->>'participation_id')::uuid) is distinct from (o.subject,o.metric,o.participation_id) then
      raise exception 'INVALID_PARTNERSHIP';
    end if;
  end if;
  if e->>'participation_id' is not null and not exists(select 1 from private.partnership_participations
      where id=(e->>'participation_id')::uuid and campaign_id=p_campaign) then
    raise exception 'PARTNERSHIP_NOT_FOUND';
  end if;
  if not isfinite(coalesce((e->>'observed_at')::timestamptz,clock_timestamp())) then raise exception 'INVALID_PARTNERSHIP'; end if;
  perform private.assert_partnership_admin();
  insert into private.partnership_metrics(campaign_id,participation_id,subject,metric,value,url,period_start,period_end,observed_at,
      source,confirmed,note,corrects,withdrawn)
    values(p_campaign,(e->>'participation_id')::uuid,e->>'subject',e->>'metric',
      -- A withdrawal holds 0; the table refuses any other value for it.
      coalesce((e->>'value')::bigint,case when (e->>'withdrawn')::boolean then 0 end),nullif(e->>'url',''),
      (e->>'period_start')::date,(e->>'period_end')::date,coalesce((e->>'observed_at')::timestamptz,clock_timestamp()),e->>'source',
      coalesce((e->>'confirmed')::boolean,true),coalesce(e->>'note',''),(e->>'corrects')::uuid,coalesce((e->>'withdrawn')::boolean,false))
    returning * into r;
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),r.id,'campaign_ledger_added',
    jsonb_strip_nulls(jsonb_build_object('kind','metric','campaign_id',p_campaign,'subject',r.subject,'metric',r.metric,'value',r.value,
      'source',r.source,'corrects',r.corrects,'withdrawn',r.withdrawn)));
  perform public.log_admin_access('analytics',null,p_campaign);
  return to_jsonb(r);
exception
  -- Someone else corrected the same row first.
  when unique_violation then raise exception 'PARTNERSHIP_CHANGED';
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range
    or check_violation or not_null_violation then raise exception 'INVALID_PARTNERSHIP';
end $$;

-- Turns off the campaign's report link. The campaign row lock keeps a revoke and an issue from crossing.
create function public.revoke_admin_report_link(p_campaign uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  perform private.lock_partnership_actor();
  perform 1 from private.partnership_campaigns where id=p_campaign for update;
  if not found then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  perform private.assert_partnership_admin();
  with gone as (update private.partnership_campaign_links set revoked_at=clock_timestamp()
      where campaign_id=p_campaign and kind='report' and revoked_at is null returning id),
    logged as (insert into private.partnership_events(actor_id,resource_id,action,details)
      select auth.uid(),id,'campaign_link_revoked',jsonb_build_object('kind','campaign_link','campaign_id',p_campaign,'link_kind','report')
      from gone returning 1)
  select count(*) into n from logged;
  perform public.log_admin_access('analytics',null,p_campaign);
  return n>0;
end $$;

-- A new report link for a year; the one sent before stops working. The token is answered once and stored only as its SHA-256.
create function public.issue_admin_report_link(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare token text; expires date; lid uuid;
begin
  perform private.lock_partnership_actor();
  perform public.revoke_admin_report_link(p_campaign);
  select (clock_timestamp() at time zone z.timezone)::date+365 into expires from private.partnership_campaigns c
    join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id where c.id=p_campaign;
  -- 32 random bytes as unpadded base64url: the 43 characters the event-link function accepts.
  token:=translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_');
  perform private.assert_partnership_admin();
  insert into private.partnership_campaign_links(campaign_id,kind,token_sha256,expires_on)
    values(p_campaign,'report',encode(sha256(convert_to(token,'UTF8')),'hex'),expires) returning id into lid;
  insert into private.partnership_events(actor_id,resource_id,action,details)
    values(auth.uid(),lid,'campaign_link_created',jsonb_build_object('kind','campaign_link','campaign_id',p_campaign,'link_kind','report'));
  perform public.log_admin_access('analytics',null,p_campaign);
  return jsonb_build_object('token',token,'expires_on',expires);
end $$;

-- Start date, lessons and the business's permission; fix=true freezes the business view once, from day 30 in its time zone.
create function public.save_admin_campaign_report(p_campaign uuid,p_fields jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f jsonb:=p_fields; r private.partnership_reports; today date; fix boolean; was date;
begin
  perform private.lock_partnership_actor();
  if p_campaign is null or jsonb_typeof(f) is distinct from 'object' or exists(select 1 from jsonb_each(f) x
      where x.key<>all(array['starts_on','lessons','consent','consent_on','consent_evidence','fix'])
        or (x.value<>'null' and jsonb_typeof(x.value)<>case when x.key='fix' then 'boolean' else 'string' end)
        or (x.key in ('starts_on','consent_on') and x.value<>'null' and x.value#>>'{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) then
    raise exception 'INVALID_PARTNERSHIP';
  end if;
  select (clock_timestamp() at time zone z.timezone)::date into today from private.partnership_campaigns c
    join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id where c.id=p_campaign for update of c;
  if today is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  perform private.assert_partnership_admin();
  select * into r from private.partnership_reports where campaign_id=p_campaign for update;
  was:=r.starts_on;
  r:=jsonb_populate_record(r,f-'fix');
  r.campaign_id:=p_campaign; r.consent:=coalesce(r.consent,'closed'); r.updated_at:=now();
  fix:=coalesce((f->>'fix')::boolean,false);
  -- A fixed report keeps its start date; lessons and permission can still change.
  if r.fixed_at is not null and (fix or r.starts_on is distinct from was) then raise exception 'REPORT_ALREADY_FIXED'; end if;
  if fix and (r.starts_on is null or today<r.starts_on+29) then raise exception 'REPORT_NOT_DUE'; end if;
  insert into private.partnership_reports select r.*
    on conflict(campaign_id) do update set starts_on=excluded.starts_on,lessons=excluded.lessons,consent=excluded.consent,
      consent_on=excluded.consent_on,consent_evidence=excluded.consent_evidence,updated_at=excluded.updated_at;
  if fix then
    update private.partnership_reports set fixed=private.campaign_report(p_campaign,true),fixed_at=now() where campaign_id=p_campaign
      returning * into r;
  end if;
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),p_campaign,
    case when fix then 'campaign_report_fixed' else 'campaign_report_saved' end,
    jsonb_build_object('kind','campaign','campaign_id',p_campaign,'starts_on',r.starts_on,'consent',r.consent,'fixed',r.fixed_at is not null));
  perform public.log_admin_access('analytics',null,p_campaign);
  return to_jsonb(r)-'campaign_id';
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or check_violation or not_null_violation then
    raise exception 'INVALID_PARTNERSHIP';
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.event_link_campaign(text,text)','private.event_applicant(private.partnership_participations)',
    'private.campaign_report(uuid,boolean)','public.event_report_view(text)',
    'public.get_admin_campaign_report(uuid)','public.add_admin_campaign_ledger(uuid,jsonb)','public.revoke_admin_report_link(uuid)',
    'public.issue_admin_report_link(uuid)','public.save_admin_campaign_report(uuid,jsonb)'] loop
    execute format('alter function %s owner to postgres',f);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  end loop;
end $$;
grant execute on function public.event_report_view(text) to service_role;
grant execute on function public.get_admin_campaign_report(uuid),public.add_admin_campaign_ledger(uuid,jsonb),
  public.revoke_admin_report_link(uuid),public.issue_admin_report_link(uuid),public.save_admin_campaign_report(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
