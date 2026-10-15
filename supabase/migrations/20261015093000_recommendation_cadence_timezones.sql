-- Existing apps keep their registration contract; unknown device zones do not receive recommendations.
alter table private.push_devices add column timezone text, add column timezone_updated_at timestamptz;

-- Retries reserve their actual send time and participate in the current local day.
alter table private.push_delivery_queue add column last_attempt_at timestamptz;
update private.push_delivery_queue set last_attempt_at=first_attempt_at where first_attempt_at is not null;

create function public.register_push_device(p_token text,p_user_id uuid,p_timezone text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_timezone is not null and not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'INVALID_TIMEZONE';
  end if;
  perform public.register_push_device(p_token,p_user_id);
  update private.push_devices set timezone=p_timezone,timezone_updated_at=clock_timestamp()
    where token=p_token and user_id=auth.uid() and session_id=nullif(auth.jwt()->>'session_id','')::uuid;
end;
$$;

revoke all on function public.register_push_device(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.register_push_device(text,uuid,text) to authenticated;

create function private.recommendation_timezone(p_user_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select d.timezone from private.push_devices d join auth.sessions s on s.id=d.session_id and s.user_id=d.user_id
  where d.user_id=p_user_id and d.disabled_at is null and d.timezone is not null
    and (s.not_after is null or s.not_after>now())
  order by d.timezone_updated_at desc,d.id limit 1;
$$;
create function private.recommendation_time(p_at timestamptz,p_timezone text)
returns boolean language sql stable set search_path='' as $$
  select coalesce(minutes>=540 and minutes<1185 and mod(minutes-540,90)<15,false)
  from (select extract(hour from p_at at time zone p_timezone)::integer*60
    +extract(minute from p_at at time zone p_timezone)::integer minutes) local;
$$;
revoke all on function private.recommendation_timezone(uuid),private.recommendation_time(timestamptz,text)
  from public,anon,authenticated,service_role;

create function private.next_recommendation_slot(p_after timestamptz,p_timezone text)
returns timestamptz language sql stable set search_path='' as $$
  select min(due_at) from (
    select p_after due_at where private.recommendation_time(p_after,p_timezone)
    union all
    select (((p_after at time zone p_timezone)::date+d+time '09:00')+s*interval '90 minutes') at time zone p_timezone
    from generate_series(0,1) d cross join generate_series(0,7) s
    where (((p_after at time zone p_timezone)::date+d+time '09:00')+s*interval '90 minutes') at time zone p_timezone>=p_after
  ) slots;
$$;
revoke all on function private.next_recommendation_slot(timestamptz,text) from public,anon,authenticated,service_role;

-- Saved business recommendations follow the selected city at creation and again before delivery.
do $$
declare signature text; definition text; anchor text:='''city_food'',''city_places'')';
begin
  foreach signature in array array['private.notification_city_matches(public.notifications)','private.filter_notification()'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'SAVED_MERCHANT_CITY_GUARD_CHANGED'; end if;
    execute replace(definition,anchor,'''city_food'',''city_places'',''saved_merchant_post'')');
  end loop;
end;
$$;
update public.notifications n set city_id=p.city_id from public.posts p
where n.kind='saved_merchant_post' and n.target_type='post' and n.target_id=p.id and n.city_id is distinct from p.city_id;

-- Keep the current account, content, opt-out, session and duplicate checks in place.
do $$
declare definition text;
  old_categories text:='''trending'',''city_food'',''city_places'',''merchant_updates''';
begin
  definition:=pg_get_functiondef('private.filter_notification()'::regprocedure);
  if position('>=6' in definition)=0 or position('select c.timezone into zone' in definition)=0 then raise exception 'RECOMMENDATION_FILTER_CHANGED'; end if;
  -- One-shot topics, rankings and business updates keep an inbox record while their pushes wait.
  definition:=replace(definition,'if new.category in ('||old_categories||') or new.kind=''trending_meetup'' then',
    'if new.kind in (''trending_post'',''city_food'',''city_places'') then');
  definition:=replace(definition,'>=6','>=8');
  definition:=replace(definition,'budget_at-interval ''30 minutes''','budget_at-interval ''75 minutes''');
  definition:=replace(definition,
    'select c.timezone into zone from public.profiles r join public.cities c on c.id=r.city_id where r.id=new.user_id;',
    'zone:=private.recommendation_timezone(new.user_id); if zone is null then return new; end if;');
  definition:=replace(definition,'if not coalesce(cfg.enabled,false)',
    'if not private.recommendation_time(budget_at,zone) or not coalesce(cfg.enabled,false)');
  execute definition;

  definition:=pg_get_functiondef('private.notify_saved_merchant_post(uuid,boolean)'::regprocedure);
  if position('local_time:=p_now at time zone recipient.timezone;' in definition)=0 then raise exception 'SAVED_MERCHANT_PRODUCER_CHANGED'; end if;
  definition:=regexp_replace(definition,'    local_time:=p_now at time zone recipient.timezone;.*?      or exists\(select 1 from public.notifications n where n.user_id=recipient.user_id and n.target_type=''post''',
    '    if exists(select 1 from public.notifications n where n.user_id=recipient.user_id and n.target_type=''post''','s');
  if position('>=6' in definition)>0 then raise exception 'SAVED_MERCHANT_BUDGET_PATCH_INCOMPLETE'; end if;
  execute definition;

  definition:=pg_get_functiondef('public.claim_push_notifications(text,integer)'::regprocedure);
  if position('select n.*,c.timezone into recommendation' in definition)=0 or position('>=6' in definition)=0 then raise exception 'RECOMMENDATION_CLAIM_CHANGED'; end if;
  definition:=replace(definition,'local_time timestamp;','local_time timestamp; due_at timestamptz; budget_zone text;');
  definition:=regexp_replace(definition,'    if p_phase=''send'' then\n      select n\.\*,c.timezone into recommendation.*?    lease := gen_random_uuid\(\);',
    $claim$    if p_phase='send' then
      select n.*,(select d.timezone from private.push_devices d where d.id=item.device_id) timezone into recommendation
        from public.notifications n where n.id=item.notification_id;
      if recommendation.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby') or recommendation.kind='trending_meetup' then
        perform pg_advisory_xact_lock(hashtextextended('recommendation:'||recommendation.user_id::text,0));
        select t.* into cfg from private.trending_config t where t.id;
        if not coalesce(cfg.enabled,false) or recommendation.timezone is null or recommendation.created_at<now()-interval '24 hours' then
          update private.push_delivery_queue q set status='cancelled',finished_at=now(),lease_id=null,lease_until=null,
            last_error='RECOMMENDATION_SUPPRESSED' where q.id=item.id;
          continue;
        end if;
        budget_zone:=coalesce(private.recommendation_timezone(recommendation.user_id),recommendation.timezone);
        local_time:=now() at time zone recommendation.timezone;
        due_at:=now();
        if (case when cfg.quiet_start_hour=cfg.quiet_end_hour then false
          when cfg.quiet_start_hour<cfg.quiet_end_hour then extract(hour from local_time)>=cfg.quiet_start_hour and extract(hour from local_time)<cfg.quiet_end_hour
          else extract(hour from local_time)>=cfg.quiet_start_hour or extract(hour from local_time)<cfg.quiet_end_hour end) then
          due_at:=now()+interval '15 minutes';
        end if;
        select greatest(due_at,coalesce(max(coalesce(q.last_attempt_at,q.first_attempt_at))+interval '75 minutes',due_at)) into due_at
        from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
        where n.user_id=recommendation.user_id and q.notification_id<>item.notification_id
          and (n.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby') or n.kind='trending_meetup');
        if (select count(distinct q.notification_id) from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
          where n.user_id=recommendation.user_id and q.notification_id<>item.notification_id
            and (n.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby') or n.kind='trending_meetup')
            and (coalesce(q.last_attempt_at,q.first_attempt_at) at time zone budget_zone)::date=(now() at time zone budget_zone)::date)>=8 then
          due_at:=greatest(due_at,((now() at time zone budget_zone)::date+1+time '09:00') at time zone budget_zone);
        end if;
        due_at:=private.next_recommendation_slot(due_at,recommendation.timezone);
        if due_at>now() then
          update private.push_delivery_queue q set next_attempt_at=due_at,lease_id=null,lease_until=null where q.id=item.id;
          continue;
        end if;
      end if;
    end if;
    lease := gen_random_uuid();$claim$,'s');
  if position('attempts = q.attempts +' in definition)=0 then raise exception 'RECOMMENDATION_ATTEMPT_CHANGED'; end if;
  definition:=replace(definition,'attempts = q.attempts +',
    'last_attempt_at=case p_phase when ''send'' then now() else q.last_attempt_at end, attempts = q.attempts +');
  if position('>=6' in definition)>0 or position('due_at:=private.next_recommendation_slot' in definition)=0 then raise exception 'RECOMMENDATION_CLAIM_PATCH_INCOMPLETE'; end if;
  execute definition;

  definition:=pg_get_functiondef('private.send_city_recommendations(timestamptz)'::regprocedure);
  if position('slot:=extract(hour from local_time) in (11,16,20)' in definition)=0
    or position('-- Reserve one recommendation' in definition)=0 then raise exception 'CITY_RECOMMENDATION_SCHEDULE_CHANGED'; end if;
  -- Selection is still by subscribed city; the sending clock comes from the member's device.
  definition:=regexp_replace(definition,'    local_time:=p_now at time zone city.timezone;.*?slot:=extract\(hour from local_time\) in \(11,16,20\) and extract\(minute from local_time\)<30;',
    '    if not exists(select 1 from public.profiles r where r.city_id=city.id and private.recommendation_time(p_now,private.recommendation_timezone(r.id))) then continue; end if;
    slot:=true;','s');
  definition:=replace(definition,'and private.notification_target_visible(r.id,pick.target_type,pick.target_id)',
    'and private.recommendation_time(p_now,private.recommendation_timezone(r.id)) and private.notification_target_visible(r.id,pick.target_type,pick.target_id)');
  definition:=replace(definition,'p_now-interval ''30 minutes''','p_now-interval ''75 minutes''');
  definition:=regexp_replace(definition,'and \(n.created_at at time zone city.timezone\)::date=local_time::date\)<.*?when extract\(hour from local_time\)<20 then 1 else 0 end\)',
    'and (n.created_at at time zone private.recommendation_timezone(r.id))::date=(p_now at time zone private.recommendation_timezone(r.id))::date)<8','s');
  if position('Reserve one recommendation' in definition)>0 or position('in (11,16,20)' in definition)>0 then raise exception 'CITY_RECOMMENDATION_PATCH_INCOMPLETE'; end if;
  execute definition;
end;
$$;

create or replace function private.enqueue_push_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare recommendation boolean:=new.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby') or new.kind='trending_meetup';
begin
  if new.kind='meetup_morning' then return new; end if;
  if recommendation then
    perform pg_advisory_xact_lock(hashtextextended('recommendation:'||new.user_id::text,0));
    if exists(select 1 from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
      where n.user_id=new.user_id and n.id<>new.id and n.target_type=new.target_type and n.target_id=new.target_id
        and n.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','meetups','interests','nearby')
        and n.created_at>new.created_at-interval '7 days') then return new; end if;
  end if;
  insert into private.push_delivery_queue(notification_id,device_id,next_attempt_at)
    select new.id,d.id,case when recommendation then private.next_recommendation_slot(new.created_at,d.timezone) else now() end
    from private.push_devices d where d.user_id=new.user_id and private.push_notification_eligible(d.id,new.id)
      and (not recommendation or d.timezone is not null)
    on conflict do nothing;
  return new;
end;
$$;

notify pgrst,'reload schema';
