-- Follow-up to 20261103040000 (review of PR #88).
-- 1. The business's report no longer carries the creators' Instagram links: a link names the creator, and the report shows
--    creators as letters. Each item says whether it is a reel instead; the admin report keeps the link.
-- 2. "Applied" now means applied through the apply link. Rows the admin board adds (seeded, discovered, or typed in from a DM)
--    hold no record of who reached out first, so a count of them would overstate applications. The store page counts only
--    link applicants, and the report says how many creators the board weighed (reviewed) instead of how many applied.
-- No report has been fixed yet, so no stored snapshot carries the old shape.

create or replace function private.event_applicant(p private.partnership_participations) returns boolean
language sql stable set search_path='' as $$
  select p.applied_via='apply_link'
$$;

-- The builder from 20261103040000 with three changes: 'reel' in place of 'url' for the business, 'url' kept for admins,
-- and people.reviewed in place of people.applied.
create or replace function private.campaign_report(p_campaign uuid,p_for_business boolean) returns jsonb
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
        'kind',subject,'reel',url ~ '^https://www[.]instagram[.]com/reels?/','first_seen',(first_at at time zone c.tz)::date,'views',views,'views_at',views_at,
        'likes',likes,'comments',comments,'shares',shares,'saves',saves,'confirmed',confirmed)
      ||case when not p_for_business then jsonb_build_object('url',url,'participation_id',participation_id,
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
    -- Head counts only: everyone the board weighed for this campaign, then the confirmed ones. How many are still candidates,
    -- on hold or dropped stays on the admin board.
    'people',(select jsonb_build_object('reviewed',count(*),'confirmed',count(*) filter (where x.w),
        'visited',count(*) filter (where x.w and (p.visited_at is not null or p.stage in ('visited','submitted','completed'))),
        'posted',count(*) filter (where x.w and (p.outreach_stage='posted' or p.content_url<>'' or p.stage in ('submitted','completed')
          or exists(select 1 from live where live.participation_id=p.id and live.subject='creator_content'))))
      from private.partnership_participations p cross join lateral (select private.event_winner(p) w) x where p.campaign_id=c.id))
  ||case when not p_for_business then jsonb_build_object('minutes',(select jsonb_build_object('total',coalesce(sum(n),0),
      'by_step',coalesce(jsonb_object_agg(metric,n),'{}')) from (select metric,sum(value) n from live where subject='gling' group by metric) x))
    else '{}' end
  from c
$$;

do $$
declare f text;
begin
  foreach f in array array['private.event_applicant(private.partnership_participations)','private.campaign_report(uuid,boolean)'] loop
    execute format('alter function %s owner to postgres',f);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  end loop;
end $$;
notify pgrst,'reload schema';
