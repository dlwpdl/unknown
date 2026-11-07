-- Free-tier cleanup (owner 2026-11-07 "DB 정리: 셋 다 하기"). Safe to rerun: cron.schedule upserts by name.

-- 1. pg_timezone_names reads every zone file on each call (about 0.9s). A name already stored on a device
-- passed this same check, so only a name no device holds yet needs the catalog. Same names accepted and rejected.
create or replace function public.register_push_device(p_token text,p_user_id uuid,p_timezone text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_timezone is not null and not exists(select 1 from private.push_devices d where d.timezone=p_timezone) then
    if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
      raise exception 'INVALID_TIMEZONE';
    end if;
  end if;
  perform public.register_push_device(p_token,p_user_id);
  update private.push_devices set timezone=p_timezone,timezone_updated_at=clock_timestamp()
    where token=p_token and user_id=auth.uid() and session_id=nullif(auth.jwt()->>'session_id','')::uuid;
end;
$$;

-- 2. This job wrote 48% of the run history. Alerts for a new post may now arrive up to a minute later.
select cron.schedule('gling-discovery-posts','* * * * *','select private.process_discovery_posts(500)');

-- 3. Run history is a log nothing reads and had no retention. TRUNCATE returns the space now; postgres cannot
-- VACUUM FULL this supabase_admin table. Last, with a short wait, so it can't hold up the jobs that write to it.
select cron.schedule('gling-cron-history-retention','47 8 * * *',$job$ delete from cron.job_run_details where start_time<now()-interval '7 days' $job$);
set local lock_timeout='5s';
truncate cron.job_run_details;
