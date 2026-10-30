-- Meetup stage 1 leftovers (owner 2026-10-30 "ㅇㅇ 1 진행해", mockup output/design/gling-meetup-rsvp-20261029 decisions 1·3).
-- 1. A waitlist offer made within 6 hours of the start gets 1 hour to reply instead of the host's usual window.
-- 2. Free members may be in one meetup at a time as a participant (hosting still follows meetupLimit).
--    Ships switched off; turn on with: update private.meetup_join_cap set enabled=true, updated_at=now();
-- No-show records already stay per host (private.meetup_absences.host_id), which was decision 2.

do $$
declare definition text; anchor text:='  if free_seats-open_offers<1 then return false; end if;';
begin
  definition:=pg_get_functiondef('private.offer_meetup_waitlist(uuid,integer)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'MEETUP_OFFER_CHANGED'; end if;
  execute replace(definition,anchor,anchor||E'\n  if p_hours is not null and private.meetup_next_start(event)<=clock_timestamp()+interval ''6 hours'' then p_hours:=least(p_hours,1); end if;');
end $$;

create table private.meetup_join_cap (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  free_limit integer not null default 1 check (free_limit between 1 and 10),
  updated_at timestamptz not null default now()
);
insert into private.meetup_join_cap default values;
alter table private.meetup_join_cap enable row level security;
revoke all on private.meetup_join_cap from public, anon, authenticated;

-- Pending requests are checked too so the member hears it before the host acts; approval rechecks.
-- The errors are the ones current apps already explain (requester: membership upgrade; host: try later).
create function private.guard_meetup_free_join_cap() returns trigger
language plpgsql security definer set search_path='' as $$
declare cap private.meetup_join_cap;
begin
  if new.status not in ('pending','approved') or (tg_op='UPDATE' and old.status=new.status) then return new; end if;
  select * into cap from private.meetup_join_cap where id;
  if not coalesce(cap.enabled,false) or private.meetup_tier_rank(new.requester_id)>=1 then return new; end if;
  if (select count(*) from public.meetup_requests r join public.posts p on p.id=r.post_id
      where r.requester_id=new.requester_id and r.status='approved' and r.post_id<>new.post_id
        and private.meetup_is_open(p.status,p.room_preview))>=cap.free_limit then
    raise exception '%',case when new.status='approved' then 'REQUESTER_MEETUP_LIMIT_REACHED' else 'MEETUP_LIMIT_REACHED' end;
  end if;
  return new;
end $$;
revoke all on function private.guard_meetup_free_join_cap() from public, anon, authenticated;
create trigger meetup_requests_free_join_cap before insert or update of status on public.meetup_requests
  for each row execute function private.guard_meetup_free_join_cap();
