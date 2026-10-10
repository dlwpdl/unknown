-- Recipient-bound snapshots keep reminders and private membership notices current at claim.
create table private.meetup_notification_notices (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid references public.meetup_requests(id) on delete cascade,
  kind text not null check(kind in ('meetup_reminder','meetup_morning','meetup_changed','meetup_cancelled')),
  starts_at timestamptz,
  event_snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index meetup_notification_notices_post_idx on private.meetup_notification_notices(post_id);
create index meetup_notification_notices_user_idx on private.meetup_notification_notices(user_id);
create index meetup_notification_notices_request_idx on private.meetup_notification_notices(request_id);
alter table private.meetup_notification_notices enable row level security;
revoke all on private.meetup_notification_notices from public,anon,authenticated,service_role;

-- Canonical actual schedule and the existing map/legacy place footer; prose edits are not place edits.
create function private.meetup_notice_snapshot(p_preview jsonb,p_body text)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('eventKind',p_preview->>'eventKind',
    'startsAt',extract(epoch from (p_preview->>'startsAt')::timestamptz),'endsAt',extract(epoch from (p_preview->>'endsAt')::timestamptz),
    'timezone',p_preview->>'timezone','cadence',trim(p_preview->>'cadence'),
    'place',coalesce((select jsonb_agg(trim(line) order by ordinal)
      from unnest(string_to_array(p_body,E'\n')) with ordinality lines(line,ordinal)
      where trim(line) ~ '^(Google 지도:|장소:|https://(maps\.app\.goo\.gl|maps\.google\.com|goo\.gl/maps|www\.google\.(com|ca|co\.kr)/maps|google\.(com|ca|co\.kr)/maps))'), '[]'::jsonb));
$$;

create function private.meetup_notice_visible(p_user uuid,p_notice uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.meetup_notification_notices n join public.posts p on p.id=n.post_id
    where n.id=p_notice and n.user_id=p_user and private.is_active_account(p.author_id)
      and not private.is_blocked_between(p_user,p.author_id)
      and (p.author_id=p_user or exists(select 1 from public.meetup_requests r
        where r.id=n.request_id and r.post_id=p.id and r.requester_id=p_user
          and (r.status='approved' or (n.kind='meetup_cancelled' and r.status='cancelled' and r.responded_at>=n.created_at))))
      and case when n.kind='meetup_cancelled' then
        (p.status<>'published' or coalesce(p.room_preview->>'closed','false')='true')
      else p.status='published' and coalesce(p.room_preview->>'closed','false')<>'true'
        and private.meetup_notice_snapshot(p.room_preview,p.body)=n.event_snapshot
        and (n.kind not in ('meetup_reminder','meetup_morning') or (p.room_preview->>'startsAt')::timestamptz>now()) end);
$$;

do $$
declare definition text; constraint_name text;
begin
  foreach constraint_name in array array['notifications_kind_check','notifications_target_type_check'] loop
    select pg_get_constraintdef(oid) into definition from pg_constraint
      where conrelid='public.notifications'::regclass and conname=constraint_name;
    if definition is null then raise exception 'MEETUP_NOTIFICATION_CONSTRAINT_CHANGED'; end if;
    execute format('alter table public.notifications drop constraint %I',constraint_name);
    execute format('alter table public.notifications add constraint %I check (%s or %s)',constraint_name,
      substring(definition from 7),case when constraint_name='notifications_kind_check' then
      'kind in (''meetup_morning'',''meetup_changed'',''meetup_cancelled'')' else 'target_type=''meetup_notice''' end);
  end loop;
  definition:=pg_get_functiondef('private.notification_category(text,text)'::regprocedure);
  if strpos(definition,'case p_kind')=0 then raise exception 'MEETUP_CATEGORY_CHANGED'; end if;
  execute replace(definition,'case p_kind','case p_kind when ''meetup_morning'' then ''meetups'' when ''meetup_changed'' then ''meetups'' when ''meetup_cancelled'' then ''meetups''');
  definition:=pg_get_functiondef('private.notification_target_visible(uuid,text,uuid)'::regprocedure);
  if strpos(definition,'case p_target_type')=0 then raise exception 'MEETUP_VISIBILITY_CHANGED'; end if;
  execute replace(definition,'case p_target_type','case p_target_type when ''meetup_notice'' then private.meetup_notice_visible(p_user_id,p_target_id)');
  definition:=pg_get_functiondef('private.enqueue_push_notification()'::regprocedure);
  if strpos(definition,'if new.kind=''meetup_reminder'' then return new; end if;')=0 then raise exception 'MEETUP_PUSH_CHANGED'; end if;
  execute replace(definition,'if new.kind=''meetup_reminder'' then return new; end if;',
    'if new.kind=''meetup_morning'' then return new; end if;');
end;
$$;

create function private.send_meetup_notice(p_post uuid,p_kind text,p_body text,p_due timestamptz default null)
returns integer language plpgsql security definer set search_path='' as $$
declare event public.posts; member record; notice uuid; delivered integer:=0; notification uuid;
begin
  select * into event from public.posts where id=p_post;
  for member in select event.author_id user_id,null::uuid request_id
    union all select r.requester_id,r.id from public.meetup_requests r where r.post_id=p_post and r.status='approved' and r.requester_id<>event.author_id
      and (p_due is null or coalesce(r.responded_at,r.created_at)<=p_due)
  loop
    insert into private.meetup_notification_notices(post_id,user_id,request_id,kind,starts_at,event_snapshot)
      values(p_post,member.user_id,member.request_id,p_kind,(event.room_preview->>'startsAt')::timestamptz,
        private.meetup_notice_snapshot(event.room_preview,event.body)) returning id into notice;
    notification:=null;
    insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route)
      values(member.user_id,p_kind,null,'meetup_notice',notice,p_body,'/post/'||p_post::text) returning id into notification;
    if notification is null then delete from private.meetup_notification_notices where id=notice;
    else delivered:=delivered+1; end if;
  end loop;
  return delivered;
end;
$$;

-- Preserve the existing jitter/deduplication sender and its job; only replace recipient delivery.
do $$
declare definition text; start_at integer; end_at integer;
begin
  definition:=pg_get_functiondef('private.send_meetup_reminders(timestamptz)'::regprocedure);
  start_at:=strpos(definition,'    insert into public.notifications');
  end_at:=strpos(definition,'    total:=total+delivered;');
  if start_at=0 or end_at<=start_at then raise exception 'MEETUP_REMINDER_SENDER_CHANGED'; end if;
  definition:=substring(definition from 1 for start_at-1)||$delivery$
    delivered:=private.send_meetup_notice(event.id,case when event.slot='morning' then 'meetup_morning' else 'meetup_reminder' end,
      left(event.title,160)||case event.slot
        when 'day_before' then ' 모임이 24시간 뒤 시작해요. ('||to_char(event.starts_at at time zone event.timezone,'MM/DD HH24:MI')||' · 모임 현지 시간)'
        when 'morning' then ' 모임이 오늘 '||to_char(event.starts_at at time zone event.timezone,'HH24:MI')||'에 시작해요. (모임 현지 시간)'
        else ' 모임이 1시간 뒤 시작해요.' end,event.due_at);
$delivery$||substring(definition from end_at);
  execute definition;
end;
$$;

create function private.notify_meetup_event_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.room_preview is null or old.room_preview->>'eventKind' is null
    or old.status<>'published' or coalesce(old.room_preview->>'closed','false')='true' then return new; end if;
  -- Natural expiry is not a host cancellation, including the existing expiry job.
  if old.room_preview->>'eventKind'='once' and (old.room_preview->>'endsAt')::timestamptz<=now() then return new; end if;
  if new.status<>'published' or coalesce(new.room_preview->>'closed','false')='true' then
    perform private.send_meetup_notice(new.id,'meetup_cancelled',left(old.title,160)||' 모임이 종료·취소되었어요.');
  elsif private.meetup_notice_snapshot(old.room_preview,old.body) is distinct from private.meetup_notice_snapshot(new.room_preview,new.body) then
    perform private.send_meetup_notice(new.id,'meetup_changed',left(new.title,160)||' 모임의 시간·장소가 변경되었어요. 모임에서 확인해 주세요.');
  end if;
  return new;
end;
$$;
create trigger posts_meetup_notification_change after update of room_preview,body,status on public.posts
  for each row execute function private.notify_meetup_event_change();
revoke all on function private.meetup_notice_snapshot(jsonb,text),private.meetup_notice_visible(uuid,uuid),
  private.send_meetup_notice(uuid,text,text,timestamptz),private.notify_meetup_event_change() from public,anon,authenticated,service_role;

-- Match the established private-function owner: existing cron/visibility callers run as postgres.
alter table private.meetup_notification_notices owner to postgres;
alter function private.meetup_notice_snapshot(jsonb,text) owner to postgres;
alter function private.meetup_notice_visible(uuid,uuid) owner to postgres;
alter function private.send_meetup_notice(uuid,text,text,timestamptz) owner to postgres;
alter function private.notify_meetup_event_change() owner to postgres;
