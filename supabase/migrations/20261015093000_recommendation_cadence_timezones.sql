-- Existing apps keep their registration contract; unknown device zones do not receive recommendations.
alter table private.push_devices add column timezone text, add column timezone_updated_at timestamptz;

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

-- Keep the current account, content, opt-out, session and duplicate checks in place.
do $$
declare definition text; signature text;
  old_categories text:='''trending'',''city_food'',''city_places'',''merchant_updates''';
  all_categories text:='''trending'',''city_food'',''city_places'',''merchant_updates'',''weekly_ranking'',''interests'',''nearby''';
begin
  foreach signature in array array['private.filter_notification()','private.enqueue_push_notification()','public.claim_push_notifications(text,integer)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position('>=6' in definition)=0 or position('interval ''30 minutes''' in definition)=0 then
      raise exception 'RECOMMENDATION_BUDGET_CHANGED: %',signature;
    end if;
    definition:=replace(definition,'>=6','>=8');
    -- A 15-minute slot allows the existing five-minute worker to recover a short delay.
    definition:=replace(definition,'budget_at-interval ''30 minutes''','budget_at-interval ''75 minutes''');
    definition:=replace(definition,'new.created_at-interval ''30 minutes''','new.created_at-interval ''75 minutes''');
    definition:=replace(definition,'q.first_attempt_at>now()-interval ''30 minutes''','q.first_attempt_at>now()-interval ''75 minutes''');
    if signature='private.filter_notification()' then
      if position('select c.timezone into zone from public.profiles' in definition)=0 then raise exception 'RECOMMENDATION_FILTER_CHANGED'; end if;
      definition:=replace(definition,
        'select c.timezone into zone from public.profiles r join public.cities c on c.id=r.city_id where r.id=new.user_id;',
        'zone:=private.recommendation_timezone(new.user_id);');
      definition:=replace(definition,'if not coalesce(cfg.enabled,false)',
        'if not private.recommendation_time(budget_at,zone) or not coalesce(cfg.enabled,false)');
    elsif signature='private.enqueue_push_notification()' then
      definition:=replace(definition,old_categories,all_categories);
      definition:=replace(definition,
        'select c.timezone into zone from public.profiles r join public.cities c on c.id=r.city_id where r.id=new.user_id;',
        'zone:=private.recommendation_timezone(new.user_id); if not private.recommendation_time(new.created_at,zone) then return new; end if;');
      definition:=replace(definition,'and private.push_notification_eligible(d.id,new.id)',
        'and private.push_notification_eligible(d.id,new.id) and (new.category not in ('||all_categories||') and new.kind<>''trending_meetup'' or private.recommendation_time(new.created_at,d.timezone))');
    else
      if position('select n.*,c.timezone into recommendation' in definition)=0 then raise exception 'RECOMMENDATION_CLAIM_CHANGED'; end if;
      definition:=replace(definition,old_categories,all_categories);
      definition:=replace(definition,'select n.*,c.timezone into recommendation',
        'select n.*,(select d.timezone from private.push_devices d where d.id=item.device_id) timezone into recommendation');
      definition:=replace(definition,'if not coalesce(cfg.enabled,false)',
        'if not private.recommendation_time(now(),recommendation.timezone) or not coalesce(cfg.enabled,false)');
    end if;
    execute definition;
  end loop;

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

notify pgrst,'reload schema';
