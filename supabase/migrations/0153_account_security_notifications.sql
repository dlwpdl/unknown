-- Device identifiers are random installation markers, never authentication credentials.
create table private.account_security_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_hash text not null check(device_hash ~ '^[0-9a-f]{64}$'),
  last_seen_at timestamptz not null default now(),
  primary key(user_id,device_hash)
);
create table private.account_security_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null default gen_random_uuid() unique,
  captured_at timestamptz not null default now(),
  baseline boolean not null default false,
  handled_at timestamptz,
  device_hash text check(device_hash ~ '^[0-9a-f]{64}$')
);
create index account_security_pending_idx on private.account_security_sessions(captured_at)
  where not baseline and handled_at is null;
create table private.account_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('new_login','new_device','email_changed','password_changed')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index account_security_events_user_idx on private.account_security_events(user_id,created_at desc);
create index account_security_events_pending_idx on private.account_security_events(created_at) where delivered_at is null;
alter table private.account_security_devices owner to postgres;
alter table private.account_security_sessions owner to postgres;
alter table private.account_security_events owner to postgres;
alter table private.account_security_devices enable row level security;
alter table private.account_security_sessions enable row level security;
alter table private.account_security_events enable row level security;
revoke all on private.account_security_devices,private.account_security_sessions,private.account_security_events
  from public,anon,authenticated,service_role;
-- Existing sessions become a baseline; deployment does not send old login alerts.
insert into private.account_security_sessions(session_id,user_id,baseline,captured_at)
select id,user_id,true,coalesce(created_at,now()) from auth.sessions;

create function private.account_security_event_visible(p_event uuid,p_viewer uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.account_security_events e where e.id=p_event and e.user_id=p_viewer
    and private.is_active_account(p_viewer));
$$;
do $$
declare definition text; anchor text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.notifications'::regclass and conname='notifications_target_type_check';
  if definition is null then raise exception 'SECURITY_NOTIFICATION_TARGET_CONSTRAINT_REQUIRED'; end if;
  alter table public.notifications drop constraint notifications_target_type_check;
  execute 'alter table public.notifications add constraint notifications_target_type_check check(target_type=''account_security'' or '
    ||substring(definition from 7)||')';
  definition:=pg_get_functiondef('private.notification_target_visible(uuid,text,uuid)'::regprocedure);
  anchor:='case p_target_type';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'SECURITY_NOTIFICATION_TARGET_GATE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' when ''account_security'' then private.account_security_event_visible(p_target_id,p_user_id)');
end;
$$;

create function private.record_account_security_event(p_user uuid,p_kind text,p_event uuid default gen_random_uuid())
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_active_account(p_user) then return; end if;
  insert into private.account_security_events(id,user_id,kind) values(p_event,p_user,p_kind)
    on conflict(id) do nothing;
end;
$$;
create function private.capture_account_security_login()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Initial signup has no completed profile yet; subsequent real sessions do.
  insert into private.account_security_sessions(session_id,user_id,baseline)
    values(new.id,new.user_id,not private.is_active_account(new.user_id));
  return new;
end;
$$;
create function private.capture_account_security_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not private.is_active_account(new.id) then return new; end if;
  if new.email is distinct from old.email then
    perform private.record_account_security_event(new.id,'email_changed');
  end if;
  if new.encrypted_password is distinct from old.encrypted_password then
    perform private.record_account_security_event(new.id,'password_changed');
  end if;
  return new;
end;
$$;
create trigger sessions_capture_account_security after insert on auth.sessions
  for each row execute function private.capture_account_security_login();
create trigger users_capture_account_security_change after update of email,encrypted_password on auth.users
  for each row execute function private.capture_account_security_change();

create function public.register_security_device(p_device_id uuid,p_expected_user_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); current_session uuid; registration private.account_security_sessions;
  device uuid:=coalesce(p_device_id,gen_random_uuid()); hashed text; known boolean; previous boolean;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if uid is distinct from p_expected_user_id then raise exception 'AUTH_CONTEXT_CHANGED'; end if;
  perform private.assert_active_account(uid);
  select s.id into current_session from auth.sessions s where s.id=nullif(auth.jwt()->>'session_id','')::uuid
    and s.user_id=uid and (s.not_after is null or s.not_after>now()) for share;
  if current_session is null then raise exception 'INVALID_SECURITY_SESSION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('security-device:'||uid::text,0));
  select * into registration from private.account_security_sessions where session_id=current_session and user_id=uid for update;
  if not found then raise exception 'INVALID_SECURITY_SESSION'; end if;
  hashed:=encode(extensions.digest(device::text,'sha256'),'hex');
  select exists(select 1 from private.account_security_devices where user_id=uid and device_hash=hashed),
    exists(select 1 from private.account_security_devices where user_id=uid) into known,previous;
  if not known then perform private.enforce_rate_limit('security_device',20,interval '1 hour'); end if;
  insert into private.account_security_devices(user_id,device_hash) values(uid,hashed)
    on conflict(user_id,device_hash) do update set last_seen_at=now();
  if registration.handled_at is null and not registration.baseline and not known then
    perform private.record_account_security_event(uid,case when previous then 'new_device' else 'new_login' end,registration.event_id);
  end if;
  update private.account_security_sessions set device_hash=hashed,handled_at=coalesce(handled_at,now()) where session_id=current_session;
  return device;
end;
$$;
create function private.flush_account_security_logins(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare pending private.account_security_sessions; event private.account_security_events; body text; total integer:=0;
begin
  for pending in select * from private.account_security_sessions where not baseline and handled_at is null
    and captured_at<=p_now-interval '1 minute' order by captured_at limit 100 for update skip locked loop
    perform private.record_account_security_event(pending.user_id,'new_login',pending.event_id);
    update private.account_security_sessions set handled_at=p_now where session_id=pending.session_id;
    total:=total+1;
  end loop;
  -- Capture is durable inside Auth; the existing worker owns fallible inbox/queue delivery.
  for event in select * from private.account_security_events where delivered_at is null
    order by created_at limit 100 for update skip locked loop
    body:=case event.kind when 'new_device' then '새 기기 또는 브라우저에서 로그인했어요. 본인이 아니라면 계정 설정을 확인해 주세요.'
      when 'new_login' then '새 로그인이 확인됐어요. 본인이 아니라면 계정 설정을 확인해 주세요.'
      when 'email_changed' then '계정 이메일이 변경됐어요. 본인이 아니라면 계정 설정을 확인해 주세요.'
      when 'password_changed' then '계정 비밀번호가 변경됐어요. 본인이 아니라면 계정 설정을 확인해 주세요.' end;
    perform private.create_notification(event.user_id,'account_security',null,'account_security',event.id,body,'/profile/settings');
    update private.account_security_events set delivered_at=p_now where id=event.id;
  end loop;
  return total;
end;
$$;
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.claim_push_notifications(text,integer)'::regprocedure);
  anchor:='delete from private.push_delivery_queue q where q.id in (';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'SECURITY_PUSH_CLAIM_CHANGED'; end if;
  execute replace(definition,anchor,'if p_phase=''send'' then perform private.flush_account_security_logins(); end if;'||E'\n  '||anchor);
end;
$$;
alter function private.account_security_event_visible(uuid,uuid) owner to postgres;
alter function private.record_account_security_event(uuid,text,uuid) owner to postgres;
alter function private.capture_account_security_login() owner to postgres;
alter function private.capture_account_security_change() owner to postgres;
alter function private.flush_account_security_logins(timestamptz) owner to postgres;
alter function public.register_security_device(uuid,uuid) owner to postgres;
revoke all on function private.account_security_event_visible(uuid,uuid),private.record_account_security_event(uuid,text,uuid),
  private.capture_account_security_login(),private.capture_account_security_change(),private.flush_account_security_logins(timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.register_security_device(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.register_security_device(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
