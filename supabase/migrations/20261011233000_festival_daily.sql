-- Shared daily collection; existing detail/date/month caches keep their short lifetime.
alter table public.ticketmaster_event_cache add column refresh_started_at timestamptz;

create table private.festival_slot_overrides (
  city_id text not null references public.cities(id) on delete cascade,
  slot integer not null check (slot between 1 and 7),
  event_id text not null check (event_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  ends_at timestamptz not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key(city_id,slot),
  unique(city_id,event_id)
);
alter table private.festival_slot_overrides enable row level security;
revoke all on private.festival_slot_overrides from public,anon,authenticated,service_role;

create function private.cached_ticketmaster_event(p_city_id text,p_event_id text)
returns jsonb language sql stable security definer set search_path='' as $$
  select e from public.ticketmaster_event_cache c
  cross join lateral jsonb_array_elements(case
    when jsonb_typeof(c.payload->'events')='array' then c.payload->'events'
    when jsonb_typeof(c.payload->'event')='object' then jsonb_build_array(c.payload->'event')
    else '[]'::jsonb end) e
  where split_part(c.cache_key,':',2)=p_city_id and e->>'id'=p_event_id
    and (c.updated_at>now()-interval '24 hours' or (c.cache_key like 'tm-festival:%' and c.expires_at>now()))
  order by c.updated_at desc,c.cache_key desc limit 1;
$$;
revoke all on function private.cached_ticketmaster_event(text,text) from public,anon,authenticated,service_role;

create function public.get_ticketmaster_festival_slots(p_city_id text)
returns table(slot integer,event_id text,ends_at timestamptz,event jsonb)
language sql stable security definer set search_path='' as $$
  select s.slot,s.event_id,s.ends_at,private.cached_ticketmaster_event(s.city_id,s.event_id)
  from private.festival_slot_overrides s where s.city_id=p_city_id and s.ends_at>now() order by s.slot;
$$;
revoke all on function public.get_ticketmaster_festival_slots(text) from public,anon,authenticated;
grant execute on function public.get_ticketmaster_festival_slots(text) to service_role;

create function public.get_admin_festival_slots(p_city_id text)
returns table(slot integer,event_id text,ends_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  return query select s.slot,s.event_id,s.ends_at from private.festival_slot_overrides s
    where s.city_id=p_city_id order by s.slot;
end;
$$;
revoke all on function public.get_admin_festival_slots(text) from public,anon;
grant execute on function public.get_admin_festival_slots(text) to authenticated;

create function public.set_admin_festival_slot(p_city_id text,p_slot integer,p_event_id text default null,p_ends_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare event jsonb; starts_at timestamptz;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_slot is null or p_slot not between 1 and 7 or p_city_id is null
    or p_city_id not in ('vancouver','toronto','montreal','calgary','edmonton')
    or not exists(select 1 from public.cities c where c.id=p_city_id and c.is_open)
    or (p_ends_at is not null and (not isfinite(p_ends_at) or p_ends_at<=now())) then
    raise exception 'INVALID_FESTIVAL_SLOT';
  end if;
  -- Serialize assignments for the same city, including different tickets for one festival.
  perform 1 from public.cities c where c.id=p_city_id for update;
  perform public.log_admin_access('analytics');
  if p_event_id is null then
    delete from private.festival_slot_overrides where city_id=p_city_id and slot=p_slot;
    return;
  end if;
  if p_event_id !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception 'INVALID_FESTIVAL_SLOT'; end if;
  event:=private.cached_ticketmaster_event(p_city_id,p_event_id);
  if event is null or not coalesce(pg_input_is_valid(event->>'startsAt','timestamp with time zone'),false) then raise exception 'FESTIVAL_UNAVAILABLE'; end if;
  starts_at:=(event->>'startsAt')::timestamptz;
  if not isfinite(starts_at) or starts_at<=now() or event->>'country' is distinct from 'CA'
    or lower(translate(event->>'city','éÉ','eE')) is distinct from p_city_id
    or event->>'status' in ('canceled','cancelled','postponed')
    or coalesce(event->>'timeUnconfirmed','true')<>'false'
    or not coalesce(event->>'name' ~* 'festival|fest\y|페스티벌|축제',false) then
    raise exception 'FESTIVAL_UNAVAILABLE';
  end if;
  with previous as materialized (
    select s.slot,s.event_id,private.cached_ticketmaster_event(s.city_id,s.event_id) cached_event
    from private.festival_slot_overrides s where s.city_id=p_city_id and s.slot<>p_slot
  )
  delete from private.festival_slot_overrides s using previous p
  where s.city_id=p_city_id and s.slot=p.slot and (p.event_id=p_event_id or
    (lower(btrim(p.cached_event->>'name')),lower(btrim(p.cached_event->>'venue')),left(coalesce(p.cached_event->>'localDate',p.cached_event->>'startsAt'),4))
    = (lower(btrim(event->>'name')),lower(btrim(event->>'venue')),left(coalesce(event->>'localDate',event->>'startsAt'),4)));
  insert into private.festival_slot_overrides(city_id,slot,event_id,ends_at,updated_by)
    values(p_city_id,p_slot,p_event_id,least(coalesce(p_ends_at,starts_at),starts_at),auth.uid())
  on conflict(city_id,slot) do update set event_id=excluded.event_id,ends_at=excluded.ends_at,updated_at=now(),updated_by=excluded.updated_by;
end;
$$;
revoke all on function public.set_admin_festival_slot(text,integer,text,timestamptz) from public,anon;
grant execute on function public.set_admin_festival_slot(text,integer,text,timestamptz) to authenticated;

create function public.claim_ticketmaster_festival_refresh(p_city_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare claimed text;
begin
  if p_city_id is null or p_city_id not in ('vancouver','toronto','montreal','calgary','edmonton')
    or not exists(select 1 from public.cities where id=p_city_id and is_open) then raise exception 'INVALID_CITY'; end if;
  insert into public.ticketmaster_event_cache(cache_key,payload,expires_at,refresh_started_at)
    values('tm-festival:'||p_city_id,'{}',now(),now())
  on conflict(cache_key) do update set refresh_started_at=now()
    where (ticketmaster_event_cache.expires_at<=now() or coalesce(jsonb_typeof(ticketmaster_event_cache.payload->'events'),'null')<>'array')
      and (ticketmaster_event_cache.refresh_started_at is null or ticketmaster_event_cache.refresh_started_at<=now()-interval '15 minutes')
  returning cache_key into claimed;
  return claimed is not null;
end;
$$;
revoke all on function public.claim_ticketmaster_festival_refresh(text) from public,anon,authenticated;
grant execute on function public.claim_ticketmaster_festival_refresh(text) to service_role;

-- Reuse the current tick and ownership; the notification toggle never stops festival collection.
create or replace function private.refresh_ticketmaster_recommendations()
returns bigint language plpgsql security definer set search_path='' as $$
declare city text; cities text[]; tick bigint:=floor(extract(epoch from now())/300); base_url text; festival boolean:=mod(tick,2)=0;
begin
  if not festival and not coalesce((select enabled from private.trending_config where id),false) then return null; end if;
  select array_agg(id order by id) into cities from public.cities where is_open and id in ('vancouver','toronto','montreal','calgary','edmonton');
  if coalesce(cardinality(cities),0)=0 then return null; end if;
  city:=cities[1+mod(tick/2,cardinality(cities))];
  if festival and exists(select 1 from public.ticketmaster_event_cache
    where cache_key='tm-festival:'||city and expires_at>now() and jsonb_typeof(payload->'events')='array') then return null; end if;
  select decrypted_secret into base_url from vault.decrypted_secrets where name='gling_push_project_url';
  if base_url is null then return null; end if;
  return net.http_post(url:=base_url||'/functions/v1/ticketmaster-events',headers:=jsonb_build_object('Content-Type','application/json'),
    body:=jsonb_build_object('cityId',city,'category','all','page',0)||case when festival then '{"festival":true}'::jsonb else '{}'::jsonb end,
    timeout_milliseconds:=25000);
end;
$$;
revoke all on function private.refresh_ticketmaster_recommendations() from public,anon,authenticated,service_role;

-- Do not delete an unexpired daily cache using the former 23-hour retention condition.
do $$
declare job record; definition text; cache_alias text;
begin
  select * into job from cron.job where jobname='ticketmaster-cache-cleanup';
  if not found or regexp_replace(trim(job.command),'\s+',' ','g') not in (
    'delete from public.ticketmaster_event_cache where updated_at < now() - interval ''23 hours''',
    'delete from public.ticketmaster_event_cache where updated_at < now() - interval ''23 hours'';') then raise exception 'TICKETMASTER_CLEANUP_JOB_CHANGED'; end if;
  perform cron.alter_job(job.jobid,command:=$command$
    delete from public.ticketmaster_event_cache where
      (cache_key like 'tm-festival:%' and expires_at<=now() and (refresh_started_at is null or refresh_started_at<now()-interval '15 minutes'))
      or (cache_key not like 'tm-festival:%' and updated_at<now()-interval '23 hours')
  $command$);
  if to_regclass('private.ticketmaster_notification_events') is not null then
    definition:=pg_get_viewdef('private.ticketmaster_notification_events'::regclass,true);
    cache_alias:=(regexp_match(definition,'([A-Za-z_][A-Za-z_0-9]*)\.updated_at > \(now\(\) - ''23:00:00''::interval\)'))[1];
    if cache_alias is null then raise exception 'TICKETMASTER_NOTIFICATION_VIEW_CHANGED'; end if;
    execute 'create or replace view private.ticketmaster_notification_events as '||replace(definition,
      cache_alias||'.updated_at > (now() - ''23:00:00''::interval)',
      format('(%I.updated_at > now() - interval ''24 hours'' or (%I.cache_key like ''tm-festival:%%'' and %I.expires_at>now()))',cache_alias,cache_alias,cache_alias));
  end if;
end;
$$;
notify pgrst,'reload schema';
