-- Private shared Discovery cache and account-wide call budget. No client can read keys or mutate quota.
create table public.ticketmaster_event_cache (
  cache_key text primary key check (length(cache_key) <= 160),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index ticketmaster_event_cache_expiry on public.ticketmaster_event_cache(expires_at);
alter table public.ticketmaster_event_cache enable row level security;
revoke all on public.ticketmaster_event_cache from public, anon, authenticated;
grant all on public.ticketmaster_event_cache to service_role;

create table public.ticketmaster_request_budget (
  singleton boolean primary key default true check (singleton),
  day date not null default (now() at time zone 'UTC')::date,
  calls integer not null default 0 check (calls >= 0),
  last_called_at timestamptz not null default '-infinity'
);
insert into public.ticketmaster_request_budget(singleton) values(true);
alter table public.ticketmaster_request_budget enable row level security;
revoke all on public.ticketmaster_request_budget from public, anon, authenticated;
grant all on public.ticketmaster_request_budget to service_role;

create function public.reserve_ticketmaster_request() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_day date := (v_now at time zone 'UTC')::date;
begin
  -- One locked row across all Edge instances: fail closed rather than exceeding the partner quota.
  update public.ticketmaster_request_budget set
    calls = case when day = v_day then calls + 1 else 1 end,
    day = v_day, last_called_at = v_now
  where singleton and last_called_at <= v_now - interval '510 milliseconds'
    and (day <> v_day or calls < 4500);
  return found;
end;
$$;
revoke all on function public.reserve_ticketmaster_request() from public, anon, authenticated;
grant execute on function public.reserve_ticketmaster_request() to service_role;

-- Retain no stale event data for longer than one day (15 minute read TTL).
select cron.schedule('ticketmaster-cache-cleanup', '19 * * * *',
  $$delete from public.ticketmaster_event_cache where updated_at < now() - interval '23 hours'$$);
