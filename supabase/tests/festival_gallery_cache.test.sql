begin;
set local search_path=public,extensions;
select plan(5);
insert into public.ticketmaster_event_cache(cache_key,payload,updated_at,expires_at,refresh_started_at)
select key,'{"events":[]}',now(),now()+interval '1 day',now() from unnest(array[
  'tm-festival:vancouver','tm-festival:toronto','tm-festival:montreal','tm-festival:calgary','tm-festival:edmonton',
  'list:vancouver:all:upcoming:0','tm-event:vancouver:gallery-cache-fixture','tm-festival:not-a-city'
]) key on conflict(cache_key) do update set payload=excluded.payload,updated_at=excluded.updated_at,expires_at=excluded.expires_at,refresh_started_at=excluded.refresh_started_at;
create temp table gallery_cache_before as select * from public.ticketmaster_event_cache;
create temp table gallery_jobs_before as select * from cron.job;
create temp table gallery_slots_before as select * from private.festival_slot_overrides;

\ir ../migrations/20261013230000_festival_gallery_cache.sql

select is((select count(*)::integer from public.ticketmaster_event_cache where cache_key in (
  'tm-festival:vancouver','tm-festival:toronto','tm-festival:montreal','tm-festival:calgary','tm-festival:edmonton'
) and expires_at<=now() and refresh_started_at is null),5,'all supported cities can collect the broadened gallery immediately');
select ok(not exists(select 1 from gallery_cache_before b full join public.ticketmaster_event_cache c using(cache_key)
  where b.cache_key is null or c.cache_key is null or (b.payload,b.updated_at) is distinct from (c.payload,c.updated_at)),'cached content and fetch timestamps are preserved');
select ok(not exists(select 1 from gallery_cache_before b join public.ticketmaster_event_cache c using(cache_key)
  where b.cache_key not in ('tm-festival:vancouver','tm-festival:toronto','tm-festival:montreal','tm-festival:calgary','tm-festival:edmonton')
    and (b.expires_at,b.refresh_started_at) is distinct from (c.expires_at,c.refresh_started_at)),'whole-view, details and unrelated cache rows keep their expiry');
select results_eq('select * from cron.job order by jobid','select * from gallery_jobs_before order by jobid','all jobs, schedules and owners are unchanged');
select results_eq('select * from private.festival_slot_overrides order by city_id,slot','select * from gallery_slots_before order by city_id,slot','owner assignments are unchanged');
select * from finish();
rollback;
