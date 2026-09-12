-- Device addresses never enter the public API schema. Both deletion and revoked
-- auth sessions remove their queued alerts. Safety review/audit records are unchanged.
create table private.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  token text not null unique check (char_length(token) <= 200 and token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,160}\]$'),
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);
create index push_devices_user_idx on private.push_devices(user_id);
create index push_devices_session_idx on private.push_devices(session_id);
alter table private.push_devices enable row level security;
revoke all on private.push_devices from public, anon, authenticated, service_role;

create function public.register_push_device(p_token text, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  current_session uuid;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_user_id is distinct from viewer then raise exception 'AUTH_CONTEXT_CHANGED'; end if;
  perform private.assert_active_account(viewer);
  if p_token is null or char_length(p_token) > 200 or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,160}\]$' then
    raise exception 'INVALID_PUSH_TOKEN';
  end if;
  select s.id into current_session from auth.sessions s
    where s.id = nullif(auth.jwt()->>'session_id','')::uuid and s.user_id = viewer
      and (s.not_after is null or s.not_after > now()) for share;
  if current_session is null then raise exception 'INVALID_PUSH_SESSION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('push-token:' || p_token, 0));
  if exists (select 1 from private.push_devices d where d.token = p_token and d.user_id = viewer
    and d.session_id = current_session and d.disabled_at is null) then return; end if;
  perform private.enforce_rate_limit('push_registration', 20, interval '1 hour');
  -- A changed owner/session receives a fresh ID; old queued content cascades away.
  delete from private.push_devices where token = p_token;
  if (select count(*) from private.push_devices where user_id = viewer and disabled_at is null) >= 10 then
    raise exception 'PUSH_DEVICE_LIMIT';
  end if;
  insert into private.push_devices(user_id, session_id, token) values (viewer, current_session, p_token);
end;
$$;

create function public.unregister_push_device(p_token text, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_user_id is distinct from auth.uid() then raise exception 'AUTH_CONTEXT_CHANGED'; end if;
  -- An old login cannot unregister a later login's binding, even on the same account.
  delete from private.push_devices where (p_token is null or token = p_token) and user_id = auth.uid()
    and session_id = nullif(auth.jwt()->>'session_id','')::uuid;
end;
$$;

create function private.delete_account_push_devices()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from private.push_devices where user_id = new.id;
  return new;
end;
$$;
create trigger profiles_delete_push_devices after update of account_status on public.profiles
  for each row when (new.account_status <> 'active') execute function private.delete_account_push_devices();

create table private.push_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references private.push_devices(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','ticket','provider_accepted','failed','cancelled')),
  attempts integer not null default 0,
  ticket_id text check (ticket_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  ticket_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  last_error text check (char_length(last_error) <= 64),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(notification_id, device_id)
);
create index push_delivery_device_idx on private.push_delivery_queue(device_id);
create index push_delivery_pending_idx on private.push_delivery_queue(status, next_attempt_at)
  where status in ('pending','ticket');
create index push_delivery_cleanup_idx on private.push_delivery_queue(created_at);
alter table private.push_delivery_queue enable row level security;
revoke all on private.push_delivery_queue from public, anon, authenticated, service_role;

create function private.push_notification_eligible(p_device_id uuid, p_notification_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.push_devices d
    join auth.sessions s on s.id = d.session_id and s.user_id = d.user_id
      and (s.not_after is null or s.not_after > now())
    join public.notification_preferences preferences on preferences.user_id = d.user_id and preferences.push_enabled
    join public.notifications n on n.id = p_notification_id and n.user_id = d.user_id
    where d.id = p_device_id and d.disabled_at is null and private.is_active_account(d.user_id)
      and n.read_at is null
      and private.can_receive_notification(n.user_id, n.category, n.actor_id)
      and (n.category = 'system' or private.notification_target_visible(n.user_id, n.target_type, n.target_id))
  );
$$;

create function private.enqueue_push_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.push_delivery_queue(notification_id, device_id)
    select new.id, d.id from private.push_devices d
    where d.user_id = new.user_id and private.push_notification_eligible(d.id, new.id)
    on conflict do nothing;
  return new;
end;
$$;
create trigger notifications_enqueue_push after insert on public.notifications
  for each row execute function private.enqueue_push_notification();

create function public.claim_push_notifications(p_phase text default 'send', p_limit integer default 100)
returns table(id uuid, lease_id uuid, token text, user_id uuid, notification_id uuid,
  category text, body text, route text, ticket_id text)
language plpgsql security definer set search_path = '' as $$
declare
  item private.push_delivery_queue;
  lease uuid;
begin
  if p_phase is null or p_phase not in ('send','receipt') then raise exception 'INVALID_PUSH_PHASE'; end if;
  delete from private.push_delivery_queue q where q.id in (
    select old.id from private.push_delivery_queue old where old.created_at < now() - interval '7 days'
    order by old.created_at limit 500 for update skip locked
  );
  for item in
    select q.* from private.push_delivery_queue q
    where q.status = case p_phase when 'send' then 'pending' else 'ticket' end
      and q.next_attempt_at <= now() and (q.lease_until is null or q.lease_until <= now())
    order by q.next_attempt_at, q.id limit greatest(1, least(coalesce(p_limit,100),100))
    for update skip locked
  loop
    if (p_phase = 'send' and (item.attempts >= 5 or item.created_at < now() - interval '24 hours'))
      or (p_phase = 'receipt' and item.ticket_at < now() - interval '24 hours') then
      update private.push_delivery_queue q set status = 'failed', finished_at = now(), lease_id = null, lease_until = null,
        last_error = case p_phase when 'send' then 'RETRY_EXHAUSTED' else 'RECEIPT_EXPIRED' end where q.id = item.id;
      continue;
    end if;
    if p_phase = 'send' and not private.push_notification_eligible(item.device_id, item.notification_id) then
      update private.push_delivery_queue q set status = 'cancelled', finished_at = now(), lease_id = null, lease_until = null
        where q.id = item.id;
      continue;
    end if;
    lease := gen_random_uuid();
    update private.push_delivery_queue q set lease_id = lease, lease_until = now() + interval '2 minutes',
      attempts = q.attempts + case p_phase when 'send' then 1 else 0 end where q.id = item.id;
    return query select item.id, lease, case p_phase when 'send' then d.token else null end,
      d.user_id, n.id, n.category, n.body, n.route, item.ticket_id
      from private.push_devices d join public.notifications n on n.id = item.notification_id where d.id = item.device_id;
  end loop;
end;
$$;

create function public.complete_push_notification(p_id uuid, p_lease_id uuid, p_result text,
  p_ticket_id text default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare item private.push_delivery_queue;
begin
  select * into item from private.push_delivery_queue q where q.id = p_id and q.lease_id = p_lease_id
    and q.lease_until > now() and q.status in ('pending','ticket') for update;
  if item.id is null then raise exception 'PUSH_LEASE_EXPIRED'; end if;
  if p_result is null or p_result not in ('ticket','provider_accepted','retry','failed','device_not_registered','receipt_pending')
    or (p_result = 'ticket' and (item.status <> 'pending' or p_ticket_id is null
      or p_ticket_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'))
    or (p_result in ('provider_accepted','receipt_pending') and item.status <> 'ticket')
    or (p_error is not null and p_error !~ '^[A-Za-z0-9_]{1,64}$') then
    raise exception 'INVALID_PUSH_RESULT';
  end if;
  if p_result = 'device_not_registered' then
    update private.push_devices set disabled_at = now() where id = item.device_id;
  end if;
  update private.push_delivery_queue set
    status = case p_result when 'ticket' then 'ticket' when 'receipt_pending' then 'ticket'
      when 'retry' then case when item.attempts >= 5 then 'failed' else 'pending' end
      when 'provider_accepted' then 'provider_accepted' else 'failed' end,
    ticket_id = case when p_result = 'ticket' then p_ticket_id when p_result = 'retry' then null else item.ticket_id end,
    ticket_at = case when p_result = 'ticket' then now() when p_result = 'retry' then null else item.ticket_at end,
    next_attempt_at = now() + case when p_result in ('ticket','receipt_pending') then interval '15 minutes'
      else interval '1 minute' * power(2, least(item.attempts, 5)) end,
    lease_id = null, lease_until = null, last_error = p_error,
    finished_at = case when p_result in ('provider_accepted','failed','device_not_registered')
      or (p_result = 'retry' and item.attempts >= 5) then now() else null end
  where id = item.id;
end;
$$;

revoke all on function public.register_push_device(text,uuid), public.unregister_push_device(text,uuid) from public, anon, authenticated;
grant execute on function public.register_push_device(text,uuid), public.unregister_push_device(text,uuid) to authenticated;
revoke all on function private.delete_account_push_devices(), private.push_notification_eligible(uuid,uuid),
  private.enqueue_push_notification() from public, anon, authenticated, service_role;
revoke all on function public.claim_push_notifications(text,integer), public.complete_push_notification(uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.claim_push_notifications(text,integer), public.complete_push_notification(uuid,uuid,text,text,text) to service_role;

comment on table private.push_delivery_queue is 'Expo tickets only confirm queue acceptance; provider_accepted confirms APNs/FCM acceptance, never device delivery. Pruned after 7 days.';
