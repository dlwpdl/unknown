-- Regular city news uses the existing trending opt-in, topic ledger and push queue.
create or replace function private.send_daily_city_digest(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare
  cfg private.trending_config;
  city record;
  pick record;
  delivered integer;
  total integer := 0;
  local_time timestamp;
begin
  select * into cfg from private.trending_config where id;
  if not found or not cfg.enabled then return 0; end if;

  for city in select id,name,timezone from public.cities where is_open loop
    local_time := p_now at time zone city.timezone;
    -- Two ordinary 15-minute runs may claim the slot; an outage never replays it later.
    if extract(hour from local_time) <> 18 or extract(minute from local_time) >= 30 then continue; end if;
    if (case when cfg.quiet_start_hour=cfg.quiet_end_hour then false
      when cfg.quiet_start_hour<cfg.quiet_end_hour then 18>=cfg.quiet_start_hour and 18<cfg.quiet_end_hour
      else 18>=cfg.quiet_start_hour or 18<cfg.quiet_end_hour end) then continue; end if;
    if exists(select 1 from private.trending_topic_sent s where s.city_id=city.id
      and s.kind='daily_city_digest' and s.topic_key=local_time::date::text) then continue; end if;

    select p.id,p.author_id,p.title into pick
    from public.posts p join auth.users u on u.id=p.author_id
    where p.city_id=city.id and p.status='published' and private.is_active_account(p.author_id)
      and p.created_at between p_now-interval '48 hours' and p_now
      and coalesce(u.email,'') not like '%@seed.gling.invalid'
      and u.raw_app_meta_data->'review_access' is distinct from 'true'::jsonb
      and not exists(select 1 from public.notifications n where n.kind='trending_post'
        and n.target_id=p.id and n.created_at>p_now-interval '7 days')
    order by p.created_at desc,p.id limit 1;
    if not found then continue; end if;

    insert into private.trending_topic_sent(city_id,kind,topic_key,sent_at)
    values(city.id,'daily_city_digest',local_time::date::text,p_now) on conflict do nothing;
    if not found then continue; end if;

    with recipients as (
      insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route)
      select r.id,'trending_post',pick.author_id,'post',pick.id,
        '오늘 '||city.name||' 소식 · '||left(pick.title,65),'/post/'||pick.id::text
      from public.profiles r
      join auth.users u on u.id=r.id
      join public.notification_preferences prefs on prefs.user_id=r.id and prefs.push_enabled and prefs.trending
      where r.city_id=city.id and r.account_status='active' and r.id<>pick.author_id
        and coalesce(u.email,'') not like '%@seed.gling.invalid'
        and u.raw_app_meta_data->'review_access' is distinct from 'true'::jsonb
        and private.notification_target_visible(r.id,'post',pick.id)
        and exists(select 1 from private.push_devices d join auth.sessions sess
          on sess.id=d.session_id and sess.user_id=d.user_id
          where d.user_id=r.id and d.disabled_at is null and (sess.not_after is null or sess.not_after>now()))
      returning 1
    ) select count(*) into delivered from recipients;
    update private.trending_topic_sent set recipients=delivered
      where city_id=city.id and kind='daily_city_digest' and topic_key=local_time::date::text;
    total := total+delivered;
  end loop;
  return total;
end;
$$;
revoke all on function private.send_daily_city_digest(timestamptz) from public,anon,authenticated,service_role;

-- Extend the existing job in place, preserving its ID, schedule, owner and active state.
do $$
declare existing cron.job;
begin
  select * into existing from cron.job where jobname='gling-trending-notifications';
  if not found then raise exception 'TRENDING_JOB_REQUIRED'; end if;
  if strpos(existing.command,'private.send_daily_city_digest()')=0 then
    if trim(trailing ';' from btrim(existing.command))<>'select private.send_trending_notifications()' then
      raise exception 'TRENDING_JOB_COMMAND_CHANGED';
    end if;
    perform cron.alter_job(job_id:=existing.jobid,
      command:=rtrim(existing.command,E'; \n')||E';\nselect private.send_daily_city_digest();');
  end if;
end;
$$;
