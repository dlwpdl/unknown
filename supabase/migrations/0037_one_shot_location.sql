create table private.location_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  version text not null,
  updated_at timestamptz not null default now()
);
create table private.location_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  post_id uuid references public.posts(id) on delete cascade,
  kind text not null check(kind in ('login','post','meetup')),
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  accuracy double precision not null check(accuracy between 0 and 10000),
  measured_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp()
);
create unique index location_login_once on private.location_events(user_id,session_id) where kind='login';
create unique index location_post_once on private.location_events(post_id) where post_id is not null;
create index location_user_time on private.location_events(user_id,measured_at desc);
create index location_expiry on private.location_events(received_at);
alter table private.location_preferences enable row level security;
alter table private.location_events enable row level security;
revoke all on private.location_preferences,private.location_events from public,anon,authenticated;

create function public.get_location_preference()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return jsonb_build_object('enabled',coalesce((select enabled and version='2026-09-11' from private.location_preferences where user_id=auth.uid()),false));
end;
$$;

create function public.set_location_preference(p_enabled boolean,p_version text,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_user_id is distinct from auth.uid() then raise exception 'AUTH_CONTEXT_CHANGED'; end if;
  if p_enabled is null or p_version is distinct from '2026-09-11' then raise exception 'INVALID_LOCATION_CONSENT'; end if;
  if p_enabled and exists(select 1 from public.profiles where id=auth.uid() and account_status<>'active') then raise exception 'ACCOUNT_LOCKED'; end if;
  insert into private.location_preferences(user_id,enabled,version) values(auth.uid(),p_enabled,p_version)
    on conflict(user_id) do update set enabled=excluded.enabled,version=excluded.version,updated_at=clock_timestamp();
  if not p_enabled then delete from private.location_events where user_id=auth.uid(); end if;
end;
$$;

create function public.record_location_event(p_latitude double precision,p_longitude double precision,p_accuracy double precision,
  p_measured_at timestamptz,p_post_id uuid default null,p_user_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); s uuid; session_started timestamptz; event_kind text; consent boolean;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_user_id is distinct from u then raise exception 'AUTH_CONTEXT_CHANGED'; end if;
  -- Lock consent so a concurrent withdrawal always removes in-flight records as well.
  select enabled and version='2026-09-11' into consent from private.location_preferences where user_id=u for update;
  if not coalesce(consent,false) then raise exception 'LOCATION_CONSENT_REQUIRED'; end if;
  if exists(select 1 from public.profiles where id=u and account_status<>'active') then raise exception 'ACCOUNT_LOCKED'; end if;
  if p_latitude is null or not(p_latitude between -90 and 90)
    or p_longitude is null or not(p_longitude between -180 and 180)
    or p_accuracy is null or not(p_accuracy between 0 and 10000)
    or p_measured_at is null or not(p_measured_at between now()-interval '5 minutes' and now()+interval '30 seconds')
    then raise exception 'INVALID_LOCATION'; end if;
  select id,created_at into s,session_started from auth.sessions
    where id=nullif(auth.jwt()->>'session_id','')::uuid and user_id=u;
  if s is null then raise exception 'INVALID_LOCATION_SESSION'; end if;
  if p_post_id is null then
    if session_started<now()-interval '10 minutes' or p_measured_at<session_started-interval '30 seconds' then raise exception 'INVALID_LOCATION_CONTEXT'; end if;
    event_kind:='login';
  else
    select case when t.slug='meetup' then 'meetup' else 'post' end into event_kind
      from public.posts p join public.tags t on t.id=p.tag_id
      where p.id=p_post_id and p.author_id=u and p.created_at>=now()-interval '10 minutes'
        and p_measured_at between p.created_at-interval '5 minutes' and p.created_at+interval '30 seconds';
    if event_kind is null then raise exception 'INVALID_LOCATION_CONTEXT'; end if;
  end if;
  insert into private.location_events(user_id,session_id,post_id,kind,latitude,longitude,accuracy,measured_at)
    values(u,s,p_post_id,event_kind,p_latitude,p_longitude,p_accuracy,p_measured_at) on conflict do nothing;
end;
$$;
revoke all on function public.get_location_preference(),public.set_location_preference(boolean,text,uuid),public.record_location_event(double precision,double precision,double precision,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_location_preference(),public.set_location_preference(boolean,text,uuid),public.record_location_event(double precision,double precision,double precision,timestamptz,uuid,uuid) to authenticated;

-- Retain the existing event sources and their audited public entry points.
alter function private.admin_user_events(uuid) rename to admin_user_content_events;
create function private.admin_user_events(p_user_id uuid)
returns table(event_key text,kind text,occurred_at timestamptz,actor_id uuid,title text,body text,context_id uuid,state text)
language sql stable set search_path='' as $$
  select * from private.admin_user_content_events(p_user_id)
  union all
  select 'location:'||e.id,case when e.kind='login' then 'account' else 'post' end,e.measured_at,e.user_id,
    case e.kind when 'login' then '로그인 위치 기록' when 'meetup' then '모임글 작성 위치 기록' else '글 작성 위치 기록' end,
    concat_ws(' · ','기기 보고 좌표: '||e.latitude||', '||e.longitude,'정확도 반경 '||e.accuracy||'m','서버 수신 '||e.received_at,'실제 위치·신원 인증 아님'),e.post_id,null
  from private.location_events e where e.user_id=p_user_id and e.received_at>now()-interval '30 days';
$$;
revoke all on function private.admin_user_events(uuid) from public,anon,authenticated;

create or replace function public.get_admin_user_overview(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile jsonb; result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('user_detail',p_user_id);
  select to_jsonb(d) into profile from private.admin_user_directory d where d.id=p_user_id;
  if profile is null then raise exception 'USER_NOT_FOUND'; end if;
  select jsonb_build_object('profile',profile,'identity_verified',false,'date_of_birth',null,'age',null,
    'location_snapshot',(select jsonb_build_object('latitude',e.latitude,'longitude',e.longitude,'accuracy',e.accuracy,'measured_at',e.measured_at,'received_at',e.received_at,'kind',e.kind) from private.location_events e where e.user_id=p_user_id and e.received_at>now()-interval '30 days' order by e.measured_at desc,e.id desc limit 1),
    'identities',(select coalesce(jsonb_agg(jsonb_build_object('provider',i.provider,'provider_id',i.provider_id,'created_at',i.created_at,'last_sign_in_at',i.last_sign_in_at) order by i.provider),'[]') from auth.identities i where i.user_id=p_user_id),
    'counts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select kind,count(*) as count from private.admin_user_events(p_user_id) group by kind order by kind) x),
    'generatedAt',clock_timestamp()) into result;
  return result;
end;
$$;
select cron.schedule('gling-location-retention','17 * * * *',
  $job$delete from private.location_events where received_at<=now()-interval '30 days'$job$);
notify pgrst,'reload schema';
