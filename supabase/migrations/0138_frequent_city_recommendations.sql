-- Reuse the protected short-lived cache; keep only event identities in click/seen records.
create view private.ticketmaster_notification_events as
with latest as (
  select distinct on (split_part(c.cache_key,':',2),e->>'id')
    split_part(c.cache_key,':',2) city_id,e,c.updated_at
  from public.ticketmaster_event_cache c
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload->'events')='array' then c.payload->'events'
    when jsonb_typeof(c.payload->'event')='object' then jsonb_build_array(c.payload->'event') else '[]'::jsonb end) e
  where c.updated_at>now()-interval '23 hours' and e->>'id' ~ '^[A-Za-z0-9_-]{1,100}$'
  order by split_part(c.cache_key,':',2),e->>'id',c.updated_at desc
), parsed as (
  select city_id,e,case when pg_input_is_valid(e->>'startsAt','timestamp with time zone') then (e->>'startsAt')::timestamptz end starts_at
  from latest
)
select md5('ticketmaster:'||p.city_id||':'||(e->>'id'))::uuid target_id,p.city_id,e->>'id' event_id,e->>'name' name,starts_at,
  (e->>'name' ~* 'festival|fest\y|페스티벌|축제|^veld\y') is_festival
from parsed p join public.cities c on c.id=p.city_id and c.is_open
where starts_at>now() and e->>'country'='CA' and e->>'status' in ('onsale','rescheduled')
  and coalesce(e->>'timeUnconfirmed','true')='false' and length(trim(e->>'name'))>0;
revoke all on private.ticketmaster_notification_events from public,anon,authenticated,service_role;

create table private.ticketmaster_event_clicks (
  target_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null default (now() at time zone 'UTC')::date,
  created_at timestamptz not null default now(),
  primary key(target_id,user_id,day)
);
create index ticketmaster_event_clicks_recent on private.ticketmaster_event_clicks(target_id,created_at);
create index ticketmaster_event_clicks_user on private.ticketmaster_event_clicks(user_id);
alter table private.ticketmaster_event_clicks enable row level security;
revoke all on private.ticketmaster_event_clicks from public,anon,authenticated,service_role;

create function public.record_ticketmaster_event_click(p_city_id text,p_event_id text)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); target uuid;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(uid);
  if p_city_id is null or p_event_id is null or p_event_id !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception 'INVALID_EVENT'; end if;
  if exists(select 1 from auth.users u where u.id=uid and (u.email like '%@seed.gling.invalid'
    or u.raw_app_meta_data->'review_access'='true'::jsonb or u.raw_app_meta_data->>'role'='admin')) then return; end if;
  select target_id into target from private.ticketmaster_notification_events where city_id=p_city_id and event_id=p_event_id;
  if target is null then raise exception 'EVENT_NOT_FOUND'; end if;
  if exists(select 1 from private.ticketmaster_event_clicks where target_id=target and user_id=uid and day=(now() at time zone 'UTC')::date) then return; end if;
  perform private.enforce_rate_limit('ticketmaster_event_click',30,interval '1 minute');
  insert into private.ticketmaster_event_clicks(target_id,user_id) values(target,uid) on conflict do nothing;
end;
$$;
revoke all on function public.record_ticketmaster_event_click(text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_ticketmaster_event_click(text,text) to authenticated;

-- Extend the current checks without dropping newer moderation/admin target rules.
do $$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.notifications'::regclass and conname='notifications_target_type_check';
  if definition is null then raise exception 'NOTIFICATION_TARGET_CHECK_REQUIRED'; end if;
  execute 'alter table public.notifications drop constraint notifications_target_type_check';
  execute 'alter table public.notifications add constraint notifications_target_type_check check (target_type=''ticketmaster_event'' or '
    ||substring(definition from 7)||')';
  select pg_get_functiondef('private.notification_target_visible(uuid,text,uuid)'::regprocedure) into definition;
  if position('select case p_target_type' in definition)=0 then raise exception 'NOTIFICATION_VISIBILITY_CHANGED'; end if;
  execute replace(definition,'select case p_target_type', $case$select case p_target_type
    when 'ticketmaster_event' then exists (
      select 1 from private.ticketmaster_notification_events e join public.profiles r on r.id=p_user_id and r.city_id=e.city_id
      where e.target_id=p_target_id)
  $case$);
end;
$$;

-- Only general discovery recommendations share this budget; activity and explicit interests remain immediate.
create or replace function private.enqueue_push_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare zone text;
begin
  if new.kind='meetup_reminder' then return new; end if;
  if new.category='trending' or new.kind='trending_meetup' then
    perform pg_advisory_xact_lock(hashtextextended('recommendation:'||new.user_id::text,0));
    select c.timezone into zone from public.profiles r join public.cities c on c.id=r.city_id where r.id=new.user_id;
    if (select count(distinct n.id) from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
        where n.user_id=new.user_id and (n.category='trending' or n.kind='trending_meetup')
          and (n.created_at at time zone zone)::date=(new.created_at at time zone zone)::date)>=6
      or exists(select 1 from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
        where n.user_id=new.user_id and (n.category='trending' or n.kind='trending_meetup') and n.created_at>new.created_at-interval '30 minutes'
          and n.created_at<=new.created_at)
      or exists(select 1 from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
        where n.user_id=new.user_id and n.target_type=new.target_type and n.target_id=new.target_id
          and n.category in ('trending','meetups','interests','nearby') and n.created_at>new.created_at-interval '7 days') then return new; end if;
  end if;
  insert into private.push_delivery_queue(notification_id,device_id)
    select new.id,d.id from private.push_devices d
    where d.user_id=new.user_id and private.push_notification_eligible(d.id,new.id)
    on conflict do nothing;
  return new;
end;
$$;

-- Record the first send claim once; retries and multiple devices share one recommendation.
alter table private.push_delivery_queue add column first_attempt_at timestamptz;
update private.push_delivery_queue set first_attempt_at=ticket_at where ticket_at is not null;
create index push_delivery_first_attempt_idx on private.push_delivery_queue(first_attempt_at) where first_attempt_at is not null;
do $$
declare definition text;
begin
  select pg_get_functiondef('public.claim_push_notifications(text,integer)'::regprocedure) into definition;
  if position('lease uuid;' in definition)=0 or position('lease := gen_random_uuid();' in definition)=0
    or position('attempts = q.attempts +' in definition)=0 then raise exception 'PUSH_CLAIM_CHANGED'; end if;
  definition:=replace(definition,'lease uuid;',$vars$lease uuid;
  recommendation record;
  cfg private.trending_config;
  local_time timestamp;$vars$);
  definition:=replace(definition,'lease := gen_random_uuid();',$guard$if p_phase='send' then
      select n.*,c.timezone into recommendation from public.notifications n
        join public.profiles r on r.id=n.user_id left join public.cities c on c.id=r.city_id where n.id=item.notification_id;
      if recommendation.category='trending' or recommendation.kind='trending_meetup' then
        perform pg_advisory_xact_lock(hashtextextended('recommendation:'||recommendation.user_id::text,0));
        select t.* into cfg from private.trending_config t where t.id;
        local_time:=now() at time zone coalesce(recommendation.timezone,'UTC');
        if not coalesce(cfg.enabled,false) or recommendation.created_at<now()-interval '30 minutes'
          or (case when cfg.quiet_start_hour=cfg.quiet_end_hour then false
            when cfg.quiet_start_hour<cfg.quiet_end_hour then extract(hour from local_time)>=cfg.quiet_start_hour and extract(hour from local_time)<cfg.quiet_end_hour
            else extract(hour from local_time)>=cfg.quiet_start_hour or extract(hour from local_time)<cfg.quiet_end_hour end)
          or (select count(distinct q.notification_id) from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
            where n.user_id=recommendation.user_id and q.notification_id<>item.notification_id
              and (n.category='trending' or n.kind='trending_meetup')
              and (q.first_attempt_at at time zone coalesce(recommendation.timezone,'UTC'))::date=local_time::date)>=6
          or exists(select 1 from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
            where n.user_id=recommendation.user_id and q.notification_id<>item.notification_id
              and (n.category='trending' or n.kind='trending_meetup') and q.first_attempt_at>now()-interval '30 minutes') then
          update private.push_delivery_queue q set status='cancelled',finished_at=now(),lease_id=null,lease_until=null,
            last_error='RECOMMENDATION_SUPPRESSED' where q.id=item.id;
          continue;
        end if;
      end if;
    end if;
    lease := gen_random_uuid();$guard$);
  definition:=replace(definition,'attempts = q.attempts +',$attempt$first_attempt_at=case p_phase when 'send' then coalesce(q.first_attempt_at,now()) else q.first_attempt_at end,
      attempts = q.attempts +$attempt$);
  execute definition;
end;
$$;

create function private.send_city_recommendations(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare cfg private.trending_config; city record; pick record; local_time timestamp; slot boolean; delivered integer; total integer:=0;
begin
  select * into cfg from private.trending_config where id;
  if not found or not cfg.enabled then return 0; end if;
  for city in select id,name,timezone from public.cities where is_open loop
    if not pg_try_advisory_xact_lock(hashtextextended('city-recommendation:'||city.id,0)) then continue; end if;
    local_time:=p_now at time zone city.timezone;
    if (case when cfg.quiet_start_hour=cfg.quiet_end_hour then false
      when cfg.quiet_start_hour<cfg.quiet_end_hour then extract(hour from local_time)>=cfg.quiet_start_hour and extract(hour from local_time)<cfg.quiet_end_hour
      else extract(hour from local_time)>=cfg.quiet_start_hour or extract(hour from local_time)<cfg.quiet_end_hour end) then continue; end if;
    slot:=extract(hour from local_time) in (11,16,20) and extract(minute from local_time)<30;

    -- First observation is a baseline, never evidence that an upstream listing was just created.
    insert into private.trending_topic_sent(city_id,kind,topic_key,sent_at)
      select city.id,'ticketmaster_catalog','initialized',p_now where exists(select 1 from private.ticketmaster_notification_events where city_id=city.id)
      on conflict do nothing;
    insert into private.trending_topic_sent(city_id,kind,topic_key,sent_at)
      select city.id,'ticketmaster_seen',e.event_id,p_now from private.ticketmaster_notification_events e where e.city_id=city.id
      on conflict do nothing;

    for pick in
      with activity as (
        select v.post_id,v.user_id,v.created_at from public.post_views v where v.created_at between p_now-interval '4 hours' and p_now
        union all select r.post_id,r.user_id,r.created_at from public.post_reactions r where r.kind='like' and r.created_at between p_now-interval '4 hours' and p_now
        union all select c.post_id,c.author_id,c.created_at from public.comments c where c.deleted_at is null and c.created_at between p_now-interval '4 hours' and p_now
      ), real_activity as (
        select a.post_id,count(distinct a.user_id) filter(where a.created_at>p_now-interval '2 hours') recent,
          count(distinct a.user_id) filter(where a.created_at<=p_now-interval '2 hours') previous
        from activity a join auth.users u on u.id=a.user_id join public.profiles r on r.id=u.id and r.account_status='active'
        where coalesce(u.email,'') not like '%@seed.gling.invalid' and u.raw_app_meta_data->'review_access' is distinct from 'true'::jsonb
          and coalesce(u.raw_app_meta_data->>'role','')<>'admin'
        group by a.post_id
      ), posts as (
        select p.*,coalesce(a.recent,0)>=3 and coalesce(a.recent,0)>coalesce(a.previous,0) rising,
          p.created_at>p_now-interval '2 hours' and (t.slug in ('food','travel','festival')
            or (t.slug='life' and p.title||' '||p.body ~* '카페|도서관|산책|뷰포인트|명소|cafe|library|restaurant')) fresh_discovery,
          t.slug
        from public.posts p join public.tags t on t.id=p.tag_id join auth.users u on u.id=p.author_id
        left join real_activity a on a.post_id=p.id
        where p.city_id=city.id and p.status='published' and p.created_at between p_now-interval '48 hours' and p_now
          and private.is_active_account(p.author_id) and coalesce(u.email,'') not like '%@seed.gling.invalid'
          and u.raw_app_meta_data->'review_access' is distinct from 'true'::jsonb
      ), events as (
        select e.*,coalesce(clicks.members,0) members,seen.sent_at first_seen,baseline.sent_at baseline_at
        from private.ticketmaster_notification_events e
        left join private.trending_topic_sent seen on seen.city_id=e.city_id and seen.kind='ticketmaster_seen' and seen.topic_key=e.event_id
        left join private.trending_topic_sent baseline on baseline.city_id=e.city_id and baseline.kind='ticketmaster_catalog' and baseline.topic_key='initialized'
        left join lateral (
          select count(distinct x.user_id) members from private.ticketmaster_event_clicks x
          join auth.users u on u.id=x.user_id join public.profiles r on r.id=u.id and r.account_status='active'
          where x.target_id=e.target_id and x.created_at between p_now-interval '48 hours' and p_now
            and coalesce(u.email,'') not like '%@seed.gling.invalid' and u.raw_app_meta_data->'review_access' is distinct from 'true'::jsonb
            and coalesce(u.raw_app_meta_data->>'role','')<>'admin'
        ) clicks on true where e.city_id=city.id and e.starts_at>p_now
      )
      select p.id target_id,'post'::text target_type,p.author_id,
        (case when rising then '지금 반응이 빠르게 오르는 글 · '
          when fresh_discovery and slug='festival' then '새로 올라온 페스티벌 소식 · '
          when fresh_discovery then '새로 올라온 가볼 만한 곳 · '
          else '오늘 '||city.name||' 추천 · ' end)||left(p.title,65) body,
        '/post/'||p.id::text route,case when rising then 1 when fresh_discovery then 2 else 4 end priority,extract(epoch from p.created_at) sort_time
      from posts p where rising or fresh_discovery or slot
      union all
      select e.target_id,'ticketmaster_event',null::uuid,
        (case when is_festival and members>=3 then '요새 글링인들이 많이 찾는 페스티벌 · '
          when first_seen>baseline_at and first_seen>p_now-interval '48 hours' then case when is_festival then '새로 발견한 페스티벌 · ' else '새로 발견한 행사 · ' end
          when is_festival then '가볼 만한 페스티벌 · ' else '다가오는 행사 추천 · ' end)||left(e.name,65),
        '/events/'||e.event_id||'?cityId='||e.city_id,
        case when is_festival and members>=3 then 0 when first_seen>baseline_at and first_seen>p_now-interval '48 hours' then 3 else 5 end,
        -extract(epoch from e.starts_at)
      from events e where (is_festival and members>=3) or (first_seen>baseline_at and first_seen>p_now-interval '48 hours') or slot
      order by priority,sort_time desc limit 20
    loop
      with inserted as (
        insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route,created_at)
        select r.id,'trending_post',pick.author_id,pick.target_type,pick.target_id,pick.body,pick.route,p_now
        from public.profiles r join public.notification_preferences prefs on prefs.user_id=r.id and prefs.push_enabled and prefs.trending
        join auth.users u on u.id=r.id
        where r.city_id=city.id and r.account_status='active' and r.id is distinct from pick.author_id
          and coalesce(u.email,'') not like '%@seed.gling.invalid' and u.raw_app_meta_data->'review_access' is distinct from 'true'::jsonb
          and private.notification_target_visible(r.id,pick.target_type,pick.target_id)
          and exists(select 1 from private.push_devices d join auth.sessions sess on sess.id=d.session_id and sess.user_id=d.user_id
            where d.user_id=r.id and d.disabled_at is null and (sess.not_after is null or sess.not_after>now()))
          and not exists(select 1 from public.notifications n where n.user_id=r.id and n.target_id=pick.target_id
            and n.category in ('trending','meetups','interests','nearby') and n.created_at>p_now-interval '7 days')
          and not exists(select 1 from public.notifications n where n.user_id=r.id and (n.category='trending' or n.kind='trending_meetup')
            and n.created_at>p_now-interval '30 minutes' and n.created_at<=p_now)
          and (select count(*) from public.notifications n where n.user_id=r.id and (n.category='trending' or n.kind='trending_meetup')
            and (n.created_at at time zone city.timezone)::date=local_time::date)<
            -- Reserve one recommendation for each regular slot still ahead today.
            6-(case when extract(hour from local_time)<11 then 3 when extract(hour from local_time)<16 then 2
              when extract(hour from local_time)<20 then 1 else 0 end)
        returning 1)
      select count(*) into delivered from inserted;
      total:=total+delivered;
    end loop;
  end loop;
  return total;
end;
$$;
revoke all on function private.send_city_recommendations(timestamptz) from public,anon,authenticated,service_role;

-- One query per tick avoids concurrent upstream quota reservations; all ten combinations refresh in 50 minutes.
create function private.refresh_ticketmaster_recommendations()
returns bigint language plpgsql security definer set search_path='' as $$
declare city text; cities text[]; tick bigint:=floor(extract(epoch from now())/300); base_url text;
begin
  if not coalesce((select enabled from private.trending_config where id),false) then return null; end if;
  select array_agg(id order by id) into cities from public.cities where is_open and id in ('vancouver','toronto','montreal','calgary','edmonton');
  if coalesce(cardinality(cities),0)=0 then return null; end if;
  city:=cities[1+mod(tick/2,cardinality(cities))];
  select decrypted_secret into base_url from vault.decrypted_secrets where name='gling_push_project_url';
  if base_url is null then return null; end if;
  return net.http_post(url:=base_url||'/functions/v1/ticketmaster-events',headers:=jsonb_build_object('Content-Type','application/json'),
    body:=jsonb_build_object('cityId',city,'category','all','page',0)||case when mod(tick,2)=0 then '{"festival":true}'::jsonb else '{}'::jsonb end,
    timeout_milliseconds:=12000);
end;
$$;
revoke all on function private.refresh_ticketmaster_recommendations() from public,anon,authenticated,service_role;

do $$
declare job record;
begin
  select * into job from cron.job where jobname='gling-trending-notifications';
  if not found or regexp_replace(trim(job.command),'\s+',' ','g') not in (
    'select private.send_trending_notifications()',
    'select private.send_trending_notifications();',
    'select private.send_trending_notifications(); select private.send_daily_city_digest();') then raise exception 'RECOMMENDATION_JOB_CHANGED'; end if;
  perform cron.alter_job(job.jobid,schedule:='*/5 * * * *',command:='select private.refresh_ticketmaster_recommendations(); select private.send_city_recommendations();');
  select * into job from cron.job where jobname='gling-behavior-retention';
  if found then perform cron.alter_job(job.jobid,command:=job.command||'; delete from private.ticketmaster_event_clicks where created_at<now()-interval ''90 days'';'); end if;
end;
$$;
notify pgrst,'reload schema';
