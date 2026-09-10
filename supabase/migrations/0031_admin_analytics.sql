create table private.analytics_config (
  singleton boolean primary key default true check(singleton),
  started_at timestamptz not null default now()
);
insert into private.analytics_config default values;
create table private.analytics_visits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check(platform in ('ios','android','web')),
  bucket timestamptz not null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  screen text not null,
  app_version text not null,
  views integer not null default 1,
  primary key(user_id,platform,bucket)
);
create index analytics_visits_time_idx on private.analytics_visits(first_at);
create table private.payment_events (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  environment text not null,
  store text not null,
  product_id text not null,
  transaction_id text,
  currency text,
  amount numeric(16,4),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index payment_events_time_idx on private.payment_events(occurred_at);
revoke all on private.analytics_config, private.analytics_visits, private.payment_events from public,anon,authenticated;

create function public.record_app_visit(p_platform text, p_screen text, p_app_version text)
returns void language plpgsql security definer set search_path='' as $$
declare stamp timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  if p_platform is null or p_platform not in ('ios','android','web')
    or p_screen is null or p_screen not in ('feed','meetups','write','chat','notifications','profile','membership','post','search','settings')
    or p_app_version is null or p_app_version !~ '^[0-9A-Za-z.+_-]{1,32}$' then raise exception 'INVALID_VISIT'; end if;
  insert into private.analytics_visits(user_id,platform,bucket,first_at,last_at,screen,app_version)
    values(auth.uid(),p_platform,date_bin(interval '30 minutes',stamp,'2000-01-01'::timestamptz),stamp,stamp,p_screen,p_app_version)
  on conflict(user_id,platform,bucket) do update set last_at=excluded.last_at,screen=excluded.screen,
    app_version=excluded.app_version,views=analytics_visits.views+1
    where excluded.last_at >= analytics_visits.last_at + interval '2 seconds';
end;
$$;
revoke all on function public.record_app_visit(text,text,text) from public,anon,authenticated;
grant execute on function public.record_app_visit(text,text,text) to authenticated;

-- Accept only authenticated server deliveries; store selected fields, never provider attributes/tokens.
create function public.record_payment_event(p_event jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid; stamp timestamptz; amount numeric;
begin
  if p_event->>'type' in ('TEST','TRANSFER') then return; end if;
  if coalesce(p_event->>'app_user_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return; end if;
  uid := (p_event->>'app_user_id')::uuid;
  if not exists(select 1 from public.profiles where id=uid and account_status<>'deleted') then return; end if;
  if coalesce(p_event->>'store','') not in ('APP_STORE','PLAY_STORE','TEST_STORE') then return; end if;
  if coalesce(p_event->>'environment','') not in ('PRODUCTION','SANDBOX')
    or coalesce(length(p_event->>'id'),0) not between 1 and 256
    or coalesce(p_event->>'type','') !~ '^[A-Z_]{1,64}$'
    or coalesce(length(p_event->>'product_id'),0) not between 1 and 256
    or coalesce(length(p_event->>'transaction_id'),0)>256
    or jsonb_typeof(p_event->'event_timestamp_ms') is distinct from 'number'
    or (p_event->>'currency' is not null and p_event->>'currency' !~ '^[A-Z]{3}$')
    then raise exception 'INVALID_PAYMENT_EVENT'; end if;
  stamp := to_timestamp((p_event->>'event_timestamp_ms')::numeric/1000);
  if stamp > clock_timestamp()+interval '5 minutes' or stamp < '2020-01-01'::timestamptz then raise exception 'INVALID_PAYMENT_EVENT'; end if;
  if p_event->>'price_in_purchased_currency' is not null then
    if jsonb_typeof(p_event->'price_in_purchased_currency') <> 'number' then raise exception 'INVALID_PAYMENT_EVENT'; end if;
    amount := (p_event->>'price_in_purchased_currency')::numeric;
    if abs(amount)>10000000 then raise exception 'INVALID_PAYMENT_EVENT'; end if;
  end if;
  insert into private.payment_events(id,user_id,event_type,environment,store,product_id,transaction_id,currency,amount,occurred_at)
  values(p_event->>'id',uid,p_event->>'type',p_event->>'environment',p_event->>'store',p_event->>'product_id',
    nullif(p_event->>'transaction_id',''),p_event->>'currency',amount,stamp)
  on conflict(id) do nothing;
end;
$$;
revoke all on function public.record_payment_event(jsonb) from public,anon,authenticated;
grant execute on function public.record_payment_event(jsonb) to service_role;

alter table public.admin_access_logs drop constraint admin_access_logs_scope_check;
alter table public.admin_access_logs add constraint admin_access_logs_scope_check check(scope in
  ('analytics','dashboard','safety','reports','users','posts','comments','conversations','messages','user_detail'));

create function public.get_admin_analytics(p_days integer default 30,p_city text default null,
  p_tier text default 'all',p_include_internal boolean default false,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare since timestamptz; result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_days is null or p_days not in (7,30,90) or p_tier is null or p_tier not in ('all','free','plus','premium')
    or p_include_internal is null or p_offset is null or p_offset<0 or p_offset>1000000
    or (p_city is not null and not exists(select 1 from public.cities where id=p_city)) then raise exception 'INVALID_ANALYTICS_FILTER'; end if;
  since := (date_trunc('day',now() at time zone 'UTC') - (p_days-1)*interval '1 day') at time zone 'UTC';
  perform public.log_admin_access('analytics');
  with population as materialized (
    select p.id,p.nickname::text,p.city_id,p.created_at,p.account_status,u.last_sign_in_at,
      (private.membership_details(p.id)->>'tier') tier,
      (coalesce(u.email like '%@seed.gling.invalid',false) or coalesce(u.raw_app_meta_data->>'role'='admin',false)
        or coalesce(u.raw_app_meta_data->'review_access'='true'::jsonb,false)) internal
    from public.profiles p join auth.users u on u.id=p.id where p.account_status<>'deleted'
  ), members as materialized (
    select * from population where (p_include_internal or not internal)
      and (p_city is null or city_id=p_city) and (p_tier='all' or tier=p_tier)
  ), visits as materialized (
    select v.*,m.nickname from private.analytics_visits v join members m on m.id=v.user_id where v.first_at>=since
  ), posts as materialized (
    select p.* from public.posts p join members m on m.id=p.author_id where p.created_at>=since
      and (p_city is null or p.city_id=p_city)
  ), events as materialized (
    select e.*,m.nickname from private.payment_events e join members m on m.id=e.user_id where e.occurred_at>=since
  ), purchases as materialized (
    select distinct on(store,transaction_id) * from events
    where environment='PRODUCTION' and store in ('APP_STORE','PLAY_STORE')
      and event_type in ('INITIAL_PURCHASE','RENEWAL','NON_RENEWING_PURCHASE')
      and transaction_id is not null and currency is not null and amount>0
    order by store,transaction_id,occurred_at,id
  ), audit as materialized (
    select a.* from public.admin_access_logs a where a.created_at>=since
  ) select jsonb_build_object(
    'generatedAt',now(),'periodStart',since,'collectionStartedAt',(select started_at from private.analytics_config),
    'counts',jsonb_build_object('members',(select count(*) from members),
      'newMembers',(select count(*) from members where created_at>=since),'posts',(select count(*) from posts),
      'activeUsers',(select count(distinct user_id) from visits),'screenViews',(select coalesce(sum(views),0) from visits),
      'visits',(select count(*) from visits),'uniquePostViews',(select count(*) from public.post_views v join members m on m.id=v.user_id
        join public.posts p on p.id=v.post_id where v.created_at>=since and (p_city is null or p.city_id=p_city))),
    'daily',(select coalesce(jsonb_agg(jsonb_build_object('day',d::date,
      'activeUsers',(select count(distinct user_id) from visits where (first_at at time zone 'UTC')::date=d::date),
      'screenViews',(select coalesce(sum(views),0) from visits where (first_at at time zone 'UTC')::date=d::date),
      'posts',(select count(*) from posts where (created_at at time zone 'UTC')::date=d::date),
      'newMembers',(select count(*) from members where (created_at at time zone 'UTC')::date=d::date)) order by d),'[]')
      from generate_series(since at time zone 'UTC',now() at time zone 'UTC',interval '1 day') d),
    'memberships',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select tier key,count(*) count from members group by tier order by tier) x),
    'cities',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select coalesce(city_id,'unknown') key,count(*) count from members group by city_id order by count(*) desc) x),
    'ages',jsonb_build_array(jsonb_build_object('key','unknown','count',(select count(*) from members))),
    'members',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,nickname,city_id city,tier,created_at "createdAt",last_sign_in_at "lastSignIn",account_status status,internal from members order by created_at desc,id limit 50 offset p_offset) x),
    'visits',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select user_id "userId",nickname,platform,app_version "appVersion",screen,first_at "firstAt",last_at "lastAt",views from visits order by last_at desc limit 50) x),
    'auditSummary',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select scope key,count(*) count from audit group by scope order by count(*) desc) x),
    'audit',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,actor_id "actorId",scope,created_at "createdAt" from audit order by created_at desc,id desc limit 50) x),
    'errors',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,status,attempts,created_at "createdAt" from public.safety_review_queue where status='failed' and created_at>=since order by created_at desc limit 50) x),
    'purchases',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select currency,sum(amount) amount,count(*) purchases,count(distinct user_id) buyers from purchases group by currency order by currency) x),
    'buyers',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select user_id "userId",nickname,currency,sum(amount) amount,count(*) purchases from purchases group by user_id,nickname,currency order by currency,sum(amount) desc,user_id limit 50) x),
    'paymentEvents',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,event_type type,product_id "productId",environment,occurred_at "occurredAt" from events order by occurred_at desc limit 50) x),
    'promotions',jsonb_build_object('connected',false)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_admin_analytics(integer,text,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.get_admin_analytics(integer,text,text,boolean,integer) to authenticated;

-- Keep only a rolling 90 days of identified access records.
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('gling-analytics-retention','23 8 * * *',
      $job$delete from private.analytics_visits where first_at<now()-interval '90 days'$job$);
  end if;
end $$;
