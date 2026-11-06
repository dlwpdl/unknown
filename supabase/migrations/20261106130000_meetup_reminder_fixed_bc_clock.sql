-- B.C. stays on UTC-7 from 2026-11-01 (tz 2026b), but this database's zone data still says UTC-8 each winter,
-- so a 19:00 Vancouver meetup's reminder said 18:00 and its morning reminder went out at 10:00.
-- Only calculations switch zone: room_preview keeps America/Vancouver. Same rule as clockZone in src/lib/chilling-date.ts.
-- shortcut: open cities only. Edmonton and Winnipeg also differ, add them before those cities open; drop this once the database has tz 2026b or newer.
create or replace function private.meetup_clock_zone(p_zone text,p_at timestamptz)
returns text language sql immutable set search_path to '' as $$
  select case when p_zone='America/Vancouver' and p_at>=timestamptz '2026-11-01 09:00Z' then 'America/Phoenix' else p_zone end;
$$;
-- send_meetup_reminders runs as postgres; any other owner here would fail every run with permission denied once public is revoked.
alter function private.meetup_clock_zone(text,timestamptz) owner to postgres;
revoke all on function private.meetup_clock_zone(text,timestamptz) from public,anon,authenticated,service_role;

create or replace function private.meetup_reminder_times(p_start timestamptz,p_timezone text)
returns table(slot text,due_at timestamptz) language sql stable set search_path to '' as $$
  select distinct on (due) label,due from (values
    ('day_before',p_start-interval '24 hours',1),
    ('morning',((p_start at time zone private.meetup_clock_zone(p_timezone,p_start))::date+time '09:00') at time zone private.meetup_clock_zone(p_timezone,p_start),2),
    ('hour_before',p_start-interval '1 hour',3)
  ) stages(label,due,priority)
  where due<p_start
  order by due,priority desc;
$$;

create or replace function private.send_meetup_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path to '' as $$
declare event record; claimed uuid; delivered integer; total integer:=0;
begin
  -- Share the existing approval/leave/close/configure lock so recipients stay current.
  perform private.lock_relationships();
  for event in
    select p.id,p.author_id,p.title,p.created_at,
      (p.room_preview->>'startsAt')::timestamptz starts_at,
      private.meetup_clock_zone(p.room_preview->>'timezone',(p.room_preview->>'startsAt')::timestamptz) timezone,t.slot,t.due_at
    from public.posts p
    cross join lateral private.meetup_reminder_times(
      (p.room_preview->>'startsAt')::timestamptz,p.room_preview->>'timezone') t
    where p.status='published' and p.room_preview->>'eventKind'='once'
      and coalesce(p.room_preview->>'closed','false')<>'true'
      and private.is_active_account(p.author_id)
      and (p.room_preview->>'startsAt')::timestamptz>p_now
      -- Allow ordinary cron jitter, but never replay an outage's old reminders.
      and t.due_at<=p_now and t.due_at>p_now-interval '1 minute'
      and p.created_at<=t.due_at
  loop
    claimed:=null;
    insert into private.meetup_reminder_deliveries(post_id,starts_at,due_at)
      values(event.id,event.starts_at,event.due_at)
      on conflict do nothing returning post_id into claimed;
    if claimed is null then continue; end if;

    delivered:=private.send_meetup_notice(event.id,case when event.slot='morning' then 'meetup_morning' else 'meetup_reminder' end,
      left(event.title,160)||case event.slot
        when 'day_before' then ' 모임이 24시간 뒤에 시작해요. ('||to_char(event.starts_at at time zone event.timezone,'MM/DD HH24:MI')||' · 모임 장소 기준)'
        when 'morning' then ' 모임은 오늘 '||to_char(event.starts_at at time zone event.timezone,'HH24:MI')||'에 시작해요. (모임 장소 기준)'
        else ' 모임이 1시간 뒤에 시작해요.' end,event.due_at);
    total:=total+delivered;
  end loop;
  return total+private.send_meetup_review_requests(p_now);
end;
$$;
