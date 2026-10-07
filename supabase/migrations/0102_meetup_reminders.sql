-- In-app reminders for dated meetups; existing meetup notification preference applies.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'comment','reply','post_like','comment_like','message','meetup_request','meetup_approved','meetup_rejected',
  'interest_post','nearby_meetup','moderation_warning','moderation_blocked','safety_alert','trending_post',
  'weekly_ranking','trending_hashtag','trending_meetup','message_reaction','admin_security','admin_multiacct',
  'admin_error_spike','meetup_reminder'
));

-- Preserve all existing categories and push handling; reminders are in-app only.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('private.notification_category(text,text)'::regprocedure);
  if strpos(definition,'when ''meetup_request''')=0 then raise exception 'notification category anchor missing'; end if;
  execute replace(definition,'when ''meetup_request''','when ''meetup_reminder'' then ''meetups'' when ''meetup_request''');
  definition := pg_get_functiondef('private.enqueue_push_notification()'::regprocedure);
  if strpos(definition,'insert into private.push_delivery_queue')=0 then raise exception 'push queue anchor missing'; end if;
  execute replace(definition,'insert into private.push_delivery_queue',
    E'if new.kind = ''meetup_reminder'' then return new; end if;\n  insert into private.push_delivery_queue');
end;
$$;

create table private.meetup_reminder_deliveries (
  post_id uuid not null references public.posts(id) on delete cascade,
  starts_at timestamptz not null,
  due_at timestamptz not null,
  primary key(post_id, starts_at, due_at)
);
alter table private.meetup_reminder_deliveries enable row level security;
revoke all on private.meetup_reminder_deliveries from public,anon,authenticated,service_role;

create function private.meetup_reminder_times(p_start timestamptz, p_timezone text)
returns table(slot text, due_at timestamptz)
language sql stable set search_path='' as $$
  select distinct on (due) label,due from (values
    ('day_before',p_start-interval '24 hours',1),
    ('morning',((p_start at time zone p_timezone)::date+time '09:00') at time zone p_timezone,2),
    ('hour_before',p_start-interval '1 hour',3)
  ) stages(label,due,priority)
  where due<p_start
  order by due,priority desc;
$$;

create function private.send_meetup_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare event record; claimed uuid; delivered integer; total integer:=0;
begin
  -- Share the existing approval/leave/close/configure lock so recipients stay current.
  perform private.lock_relationships();
  for event in
    select p.id,p.author_id,p.title,p.created_at,
      (p.room_preview->>'startsAt')::timestamptz starts_at,
      p.room_preview->>'timezone' timezone,t.slot,t.due_at
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
    insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route)
    select members.user_id,'meetup_reminder',null,'post',event.id,
      left(event.title,160)||case event.slot
        when 'day_before' then ' 모임이 24시간 뒤 시작해요. ('||to_char(event.starts_at at time zone event.timezone,'MM/DD HH24:MI')||' · 모임 현지 시간)'
        when 'morning' then ' 모임이 오늘 '||to_char(event.starts_at at time zone event.timezone,'HH24:MI')||'에 시작해요. (모임 현지 시간)'
        else ' 모임이 1시간 뒤 시작해요.' end,
      '/post/'||event.id::text
    from (
      select event.author_id as user_id
      union
      select r.requester_id from public.meetup_requests r
      where r.post_id=event.id and r.status='approved'
        and coalesce(r.responded_at,r.created_at)<=event.due_at
    ) members;
    get diagnostics delivered = row_count;
    total:=total+delivered;
  end loop;
  return total;
end;
$$;
revoke all on function private.meetup_reminder_times(timestamptz,text),
  private.send_meetup_reminders(timestamptz) from public,anon,authenticated,service_role;

-- Schedule only in the application database (pg_cron runs on the server, not the phone).
select cron.schedule('gling-meetup-reminders','* * * * *','select private.send_meetup_reminders();');
