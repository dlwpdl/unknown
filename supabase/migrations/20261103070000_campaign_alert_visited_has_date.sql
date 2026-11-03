-- 'Confirmed but no visit date' named people who had already come: a creator marked visited with no scheduled
-- time still showed up. Someone with a visit time or a store check has been, so they leave this rule.
-- The body is 20261103040000's (it reads partnership_metrics_live) with only that condition added.
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
    from p where outreach_stage='confirmed' and scheduled_at is null and visited_at is null
      and not exists(select 1 from private.partnership_store_uses u where u.campaign_id=p.campaign_id
        and u.creator_id=p.creator_id and u.cancelled_at is null)
    having count(*)>0
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
