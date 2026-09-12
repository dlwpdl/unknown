-- Self-reported account information stays outside public profiles.
create table private.personal_info (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  full_name text not null check(length(full_name) between 1 and 200 and full_name !~ '[[:cntrl:]]'),
  date_of_birth date not null,
  consent_version text not null,
  consented_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.personal_info enable row level security;
revoke all on private.personal_info from public,anon,authenticated;

create function public.get_my_personal_info()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select jsonb_build_object('full_name',i.full_name,'date_of_birth',i.date_of_birth,
    'age',extract(year from age((now() at time zone 'utc')::date,i.date_of_birth))::int,
    'consented_at',i.consented_at,'updated_at',i.updated_at)
  into result from private.personal_info i where i.user_id=auth.uid();
  return coalesce(result,jsonb_build_object('full_name',null,'date_of_birth',null,'age',null,'consented_at',null,'updated_at',null));
end;
$$;

create function public.save_my_personal_info(p_full_name text,p_date_of_birth date,p_version text,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); status text; clean_name text:=regexp_replace(p_full_name,'^\s+|\s+$','','g');
  today date:=(now() at time zone 'utc')::date;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_user_id is distinct from u then raise exception 'AUTH_CONTEXT_CHANGED'; end if;
  if p_version is distinct from '2026-09-12' then raise exception 'PERSONAL_INFO_CONSENT_REQUIRED'; end if;
  -- Serialize saves/withdrawals with the profile's account-deletion transition.
  select account_status into status from public.profiles where id=u for update;
  if status is null then raise exception 'PROFILE_REQUIRED'; end if;
  if p_full_name is null and p_date_of_birth is null then
    delete from private.personal_info where user_id=u;
    return;
  end if;
  if status<>'active' then raise exception 'ACCOUNT_LOCKED'; end if;
  if clean_name is null or length(clean_name) not between 1 and 200 or clean_name ~ '[[:cntrl:]]'
    or p_date_of_birth is null or not(p_date_of_birth between (today-interval '120 years')::date and today)
    then raise exception 'INVALID_PERSONAL_INFO'; end if;
  insert into private.personal_info(user_id,full_name,date_of_birth,consent_version)
    values(u,clean_name,p_date_of_birth,p_version)
    on conflict(user_id) do update set full_name=excluded.full_name,date_of_birth=excluded.date_of_birth,
      consent_version=excluded.consent_version,consented_at=clock_timestamp(),updated_at=clock_timestamp();
end;
$$;

create function public.create_profile_with_personal_info(p_nickname text,p_city_id text,p_avatar_path text,p_version text,
  p_full_name text,p_date_of_birth date,p_personal_info_version text,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_user_id is distinct from auth.uid() then raise exception 'AUTH_CONTEXT_CHANGED'; end if;
  perform public.create_profile_with_consent(p_nickname,p_city_id,p_avatar_path,p_version);
  if p_full_name is not null or p_date_of_birth is not null or p_personal_info_version is not null then
    perform public.save_my_personal_info(p_full_name,p_date_of_birth,p_personal_info_version,p_user_id);
  end if;
end;
$$;
revoke all on function public.get_my_personal_info(),public.save_my_personal_info(text,date,text,uuid),
  public.create_profile_with_personal_info(text,text,text,text,text,date,text,uuid) from public,anon,authenticated;
grant execute on function public.get_my_personal_info(),public.save_my_personal_info(text,date,text,uuid),
  public.create_profile_with_personal_info(text,text,text,text,text,date,text,uuid) to authenticated;

create function private.purge_deleted_personal_info()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from private.personal_info where user_id=new.id;
  return new;
end;
$$;
revoke all on function private.purge_deleted_personal_info() from public,anon,authenticated;
create trigger purge_deleted_personal_info after update of account_status on public.profiles
  for each row when(new.account_status='deleted') execute function private.purge_deleted_personal_info();

create or replace view private.admin_user_directory as
select p.*, u.email, u.email_confirmed_at, u.last_sign_in_at,
  coalesce(u.raw_app_meta_data->>'role','member') as auth_role,
  case when u.email like '%@seed.gling.invalid' then 'example'
    when u.raw_app_meta_data->>'role'='admin' then 'admin'
    when u.raw_app_meta_data->'review_access'='true'::jsonb then 'review' else 'member' end as account_type,
  left(coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name','')),200) as login_name,
  coalesce((select array_agg(distinct i.provider order by i.provider) from auth.identities i where i.user_id=p.id),'{}'::text[]) as providers,
  host(s.ip) as session_ip,s.created_at as session_created_at,s.updated_at as session_updated_at,
  info.full_name,info.date_of_birth,extract(year from age((now() at time zone 'utc')::date,info.date_of_birth))::int as age,
  info.updated_at as personal_info_updated_at
from public.profiles p join auth.users u on u.id=p.id
left join lateral (select x.ip,x.created_at,x.updated_at from auth.sessions x where x.user_id=p.id
  order by coalesce(x.updated_at,x.created_at) desc,x.id desc limit 1) s on true
left join private.personal_info info on info.user_id=p.id;

create or replace function public.search_admin_users(p_query text default '',p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_query is null or length(p_query)>200 or p_offset is null or p_offset<0 then raise exception 'INVALID_ADMIN_FILTER'; end if;
  perform public.log_admin_access('users');
  with matched as (
    select * from private.admin_user_directory d
    where strpos(lower(concat_ws(' ',d.id::text,d.nickname::text,d.email,d.login_name,d.full_name)),lower(trim(p_query)))>0
  ) select jsonb_build_object('total',(select count(*) from matched),
    'rows',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from matched order by created_at desc,id desc limit 50 offset p_offset) x),
    'viewer',(select jsonb_build_object('id',u.id,'email',u.email,'role',u.raw_app_meta_data->>'role') from auth.users u where u.id=auth.uid())) into result;
  return result;
end;
$$;

create or replace function public.get_admin_user_overview(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile jsonb; result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('user_detail',p_user_id);
  select to_jsonb(d) into profile from private.admin_user_directory d where d.id=p_user_id;
  if profile is null then raise exception 'USER_NOT_FOUND'; end if;
  select jsonb_build_object('profile',profile,'identity_verified',false,'date_of_birth',profile->'date_of_birth','age',profile->'age',
    'location_snapshot',(select jsonb_build_object('latitude',e.latitude,'longitude',e.longitude,'accuracy',e.accuracy,'measured_at',e.measured_at,'received_at',e.received_at,'kind',e.kind) from private.location_events e where e.user_id=p_user_id and e.received_at>now()-interval '30 days' order by e.measured_at desc,e.id desc limit 1),
    'identities',(select coalesce(jsonb_agg(jsonb_build_object('provider',i.provider,'provider_id',i.provider_id,'created_at',i.created_at,'last_sign_in_at',i.last_sign_in_at) order by i.provider),'[]') from auth.identities i where i.user_id=p_user_id),
    'counts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select kind,count(*) as count from private.admin_user_events(p_user_id) group by kind order by kind) x),
    'generatedAt',clock_timestamp()) into result;
  return result;
end;
$$;
create or replace function public.get_admin_analytics(p_days integer default 30,p_city text default null,
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
      extract(year from age((now() at time zone 'utc')::date,info.date_of_birth))::int age,
      (private.membership_details(p.id)->>'tier') tier,
      (coalesce(u.email like '%@seed.gling.invalid',false) or coalesce(u.raw_app_meta_data->>'role'='admin',false)
        or coalesce(u.raw_app_meta_data->'review_access'='true'::jsonb,false)) internal
    from public.profiles p join auth.users u on u.id=p.id left join private.personal_info info on info.user_id=p.id where p.account_status<>'deleted'
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
    'ages',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select case when age is null then 'unknown' else ((age/10)*10)::text||'대' end key,count(*) count from members group by 1 order by 1) x),
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
notify pgrst,'reload schema';
