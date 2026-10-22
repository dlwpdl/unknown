-- Allow only fixed event-flow identifiers. No event ID, title, URL, or search text.
insert into private.behavior_targets(id) values
  ('today.events.browse'), ('today.events.login'), ('today.events.retry'),
  ('today.events.carousel'), ('today.events.open'),
  ('ticketmaster.back'), ('ticketmaster.filters'),
  ('ticketmaster.date.open'), ('ticketmaster.date.clear'),
  ('ticketmaster.date.close'), ('ticketmaster.date.apply'),
  ('ticketmaster.date.month'), ('ticketmaster.date.day'),
  ('ticketmaster.category.all'), ('ticketmaster.category.music'),
  ('ticketmaster.category.sports'), ('ticketmaster.category.arts'),
  ('ticketmaster.events'), ('ticketmaster.event.open'),
  ('ticketmaster.previous'), ('ticketmaster.next'),
  ('ticketmaster.detail.back'), ('ticketmaster.detail'),
  ('ticketmaster.meetup.create'), ('ticketmaster.purchase'),
  ('ticketmaster.meetup.created')
on conflict (id) do nothing;

create or replace function public.record_behavior_events(p_session text,p_platform text,p_events jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare e jsonb; uid uuid; n integer;
begin
  if p_session is null or p_session !~ '^[a-z0-9-]{20,80}$'
    or p_platform is null or p_platform not in ('ios','android','web')
    or p_events is null or jsonb_typeof(p_events)<>'array' or octet_length(p_events::text)>16000 then
    raise exception 'INVALID_BEHAVIOR';
  end if;
  n := jsonb_array_length(p_events);
  if n<1 or n>25 then raise exception 'INVALID_BEHAVIOR'; end if;
  select id into uid from public.profiles where id=auth.uid();
  if uid is not null then
    perform private.assert_active_account(uid);
    if private.is_admin() then return; end if;
    perform private.enforce_rate_limit('behavior',30,interval '1 minute');
  else
    -- ponytail: shared anonymous budget, replace with edge per-IP throttling if traffic grows.
    perform pg_advisory_xact_lock(7373001);
    if (select count(*) from private.behavior_events where user_id is null and created_at>now()-interval '1 minute')+n>6000 then
      raise exception 'RATE_LIMITED';
    end if;
  end if;
  for e in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(e)<>'object' or not (e ?& array['seq','screen','kind','target','value'])
      or (e - array['seq','screen','kind','target','value'])<>'{}'::jsonb
      or jsonb_typeof(e->'seq')<>'number' or (e->>'seq') !~ '^[0-9]{1,7}$'
      or (e->>'seq')::int not between 1 and 1000000
      or jsonb_typeof(e->'value')<>'number' or (e->>'value') !~ '^[0-9]{1,5}$'
      or coalesce(e->>'screen','') not in ('feed','meetups','write','chat','notifications','profile','membership','settings','post',
        'meetup-create','meetup-join','meetup-profile','meetup-application','inbox','notification-settings','promotions','guidelines','app-invitation',
        'events','event-detail')
      or coalesce(e->>'kind','') not in ('view','press','scroll','dwell','success')
      or not exists(select 1 from private.behavior_targets where id=e->>'target') then raise exception 'INVALID_BEHAVIOR'; end if;
    if (e->>'kind' in ('view','press','success') and (e->>'value')::int<>1)
      or (e->>'kind'='scroll' and (e->>'value')::int not in (25,50,75,100))
      or (e->>'kind'='dwell' and (e->>'value')::int not between 0 and 60000)
      or (e->>'kind' in ('view','dwell') and e->>'target'<>'screen')
      or (e->>'kind'='success' and e->>'target' not in ('signup_complete','consent_complete','meetup_request_complete','ticketmaster.meetup.created')) then
      raise exception 'INVALID_BEHAVIOR';
    end if;
    insert into private.behavior_events(session_id,seq,user_id,platform,screen,kind,target,value)
    values(p_session,(e->>'seq')::int,uid,p_platform,e->>'screen',e->>'kind',e->>'target',(e->>'value')::int)
    on conflict(session_id,seq) do nothing;
  end loop;
end;
$$;
