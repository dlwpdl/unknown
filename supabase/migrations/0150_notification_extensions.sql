-- Existing choices remain unchanged; individual business subscriptions start off.
alter table public.notification_preferences
  add column merchant_updates boolean not null default true,
  add column merchant_operations boolean not null default true,
  add column account_security boolean not null default true;
alter table private.saved_merchants add column notifications_enabled boolean not null default false;

do $$
declare definition text; anchor text; signature text; constraint_name text; values_sql text;
begin
  foreach constraint_name in array array['notifications_kind_check','notifications_category_check'] loop
    select pg_get_constraintdef(oid) into definition from pg_constraint
      where conrelid='public.notifications'::regclass and conname=constraint_name;
    if definition is null then raise exception 'NOTIFICATION_EXTENSION_CONSTRAINT_REQUIRED: %',constraint_name; end if;
    values_sql:=case constraint_name when 'notifications_kind_check' then
      'kind in (''saved_merchant_post'',''merchant_review_received'',''merchant_operation'',''account_security'')'
      else 'category in (''merchant_updates'',''merchant_operations'',''account_security'')' end;
    execute format('alter table public.notifications drop constraint %I',constraint_name);
    execute format('alter table public.notifications add constraint %I check(%s or %s)',constraint_name,values_sql,substring(definition from 7));
  end loop;
  definition:=pg_get_functiondef('public.get_notification_preferences()'::regprocedure);
  anchor:='"push_enabled":false';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'NOTIFICATION_EXTENSION_DEFAULTS_CHANGED'; end if;
  execute replace(definition,anchor,anchor||',"merchant_updates":true,"merchant_operations":true,"account_security":true');
  definition:=pg_get_functiondef('public.update_notification_preferences(jsonb)'::regprocedure);
  anchor:='''push_enabled'',''message_preview''';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'NOTIFICATION_EXTENSION_ALLOWLIST_CHANGED'; end if;
  definition:=replace(definition,anchor,'''merchant_updates'',''merchant_operations'',''account_security'','||anchor);
  anchor:='merchant_reviews = coalesce((p_preferences->>''merchant_reviews'')::boolean, p.merchant_reviews),';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'NOTIFICATION_EXTENSION_UPDATE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||E'\n    merchant_updates = coalesce((p_preferences->>''merchant_updates'')::boolean, p.merchant_updates),'
    ||E'\n    merchant_operations = coalesce((p_preferences->>''merchant_operations'')::boolean, p.merchant_operations),'
    ||E'\n    account_security = coalesce((p_preferences->>''account_security'')::boolean, p.account_security),');
  definition:=pg_get_functiondef('private.can_receive_notification(uuid,text,uuid)'::regprocedure);
  anchor:='p_category in (';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'NOTIFICATION_EXTENSION_GATE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||'''merchant_updates'',''merchant_operations'',''account_security'',');
  definition:=pg_get_functiondef('private.notification_category(text,text)'::regprocedure);
  anchor:='case p_kind';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'NOTIFICATION_EXTENSION_MAP_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' when ''saved_merchant_post'' then ''merchant_updates'''
    ||' when ''merchant_review_received'' then ''merchant_reviews'''
    ||' when ''merchant_operation'' then ''merchant_operations'''
    ||' when ''account_security'' then ''account_security''');
  -- An opted-in business and city discoveries share one recommendation budget.
  foreach signature in array array['private.send_city_recommendations(timestamptz)',
    'private.enqueue_push_notification()','public.claim_push_notifications(text,integer)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    anchor:='(''trending'',''city_food'',''city_places'')';
    if position(anchor in definition)=0 then raise exception 'NOTIFICATION_EXTENSION_BUDGET_CHANGED: %',signature; end if;
    definition:=replace(definition,anchor,'(''trending'',''city_food'',''city_places'',''merchant_updates'')');
    definition:=replace(definition,'''trending'',''city_food'',''city_places'',''meetups'',''interests'',''nearby''',
      '''trending'',''city_food'',''city_places'',''merchant_updates'',''meetups'',''interests'',''nearby''');
    execute definition;
  end loop;
  -- Candidate selection may precede another producer's insert; serialize the final inbox check.
  definition:=pg_get_functiondef('private.filter_notification()'::regprocedure);
  anchor:=E'begin\n';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'NOTIFICATION_EXTENSION_FILTER_CHANGED'; end if;
  definition:=replace(definition,anchor,E'declare cfg private.trending_config; zone text; local_at timestamp; budget_at timestamptz;\nbegin\n');
  anchor:='  return new;';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'NOTIFICATION_EXTENSION_FILTER_RETURN_CHANGED'; end if;
  execute replace(definition,anchor,$budget$
  if new.category in ('trending','city_food','city_places','merchant_updates') or new.kind='trending_meetup' then
    perform pg_advisory_xact_lock(hashtextextended('recommendation:'||new.user_id::text,0));
    budget_at:=greatest(new.created_at,clock_timestamp());
    if new.created_at=now() then new.created_at:=budget_at; end if;
    select * into cfg from private.trending_config where id;
    select c.timezone into zone from public.profiles r join public.cities c on c.id=r.city_id where r.id=new.user_id;
    local_at:=budget_at at time zone coalesce(zone,'UTC');
    if not coalesce(cfg.enabled,false)
      or (case when cfg.quiet_start_hour=cfg.quiet_end_hour then false
        when cfg.quiet_start_hour<cfg.quiet_end_hour then extract(hour from local_at)>=cfg.quiet_start_hour and extract(hour from local_at)<cfg.quiet_end_hour
        else extract(hour from local_at)>=cfg.quiet_start_hour or extract(hour from local_at)<cfg.quiet_end_hour end)
      or (select count(*) from public.notifications n where n.user_id=new.user_id
        and (n.category in ('trending','city_food','city_places','merchant_updates') or n.kind='trending_meetup')
        and (n.created_at at time zone coalesce(zone,'UTC'))::date=local_at::date)>=6
      or exists(select 1 from public.notifications n where n.user_id=new.user_id
        and (n.category in ('trending','city_food','city_places','merchant_updates') or n.kind='trending_meetup')
        and n.created_at>budget_at-interval '30 minutes')
      or exists(select 1 from public.notifications n where n.user_id=new.user_id and n.target_type=new.target_type and n.target_id=new.target_id
        and n.category in ('trending','city_food','city_places','merchant_updates','meetups','interests','nearby')
        and n.created_at>budget_at-interval '7 days') then return null; end if;
  end if;
  return new;$budget$);
end;
$$;
notify pgrst, 'reload schema';
