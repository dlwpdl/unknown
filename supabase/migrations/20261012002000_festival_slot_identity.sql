-- Keep a derived identity, rather than requiring expired upstream content to move an assignment.
alter table private.festival_slot_overrides add column festival_key text;
with current_events as materialized (
  select city_id,slot,private.cached_ticketmaster_event(city_id,event_id) event from private.festival_slot_overrides
)
update private.festival_slot_overrides s set festival_key=md5(jsonb_build_array(lower(btrim(c.event->>'name')),lower(btrim(coalesce(c.event->>'venue',''))),left(coalesce(nullif(c.event->>'localDate',''),c.event->>'startsAt'),4))::text)
from current_events c where s.city_id=c.city_id and s.slot=c.slot and c.event is not null;
alter table private.festival_slot_overrides alter column festival_key set not null;
alter table private.festival_slot_overrides add unique(city_id,festival_key);

create or replace function public.set_admin_festival_slot(p_city_id text,p_slot integer,p_event_id text default null,p_ends_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare event jsonb; starts_at timestamptz; identity_key text;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_slot is null or p_slot not between 1 and 7 or p_city_id is null
    or p_city_id not in ('vancouver','toronto','montreal','calgary','edmonton')
    or not exists(select 1 from public.cities c where c.id=p_city_id and c.is_open)
    or (p_ends_at is not null and (not isfinite(p_ends_at) or p_ends_at<=now())) then
    raise exception 'INVALID_FESTIVAL_SLOT';
  end if;
  -- Serialize assignments for the same city, including different tickets for one festival.
  perform 1 from public.cities c where c.id=p_city_id for update;
  perform public.log_admin_access('analytics');
  if p_event_id is null then
    delete from private.festival_slot_overrides where city_id=p_city_id and slot=p_slot;
    return;
  end if;
  if p_event_id !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception 'INVALID_FESTIVAL_SLOT'; end if;
  event:=private.cached_ticketmaster_event(p_city_id,p_event_id);
  if event is null or not coalesce(pg_input_is_valid(event->>'startsAt','timestamp with time zone'),false) then raise exception 'FESTIVAL_UNAVAILABLE'; end if;
  starts_at:=(event->>'startsAt')::timestamptz;
  if not isfinite(starts_at) or starts_at<=now() or event->>'country' is distinct from 'CA'
    or lower(translate(event->>'city','éÉ','eE')) is distinct from p_city_id
    or event->>'status' in ('canceled','cancelled','postponed')
    or coalesce(event->>'timeUnconfirmed','true')<>'false'
    or not coalesce(event->>'name' ~* 'festival|fest\y|페스티벌|축제',false) then
    raise exception 'FESTIVAL_UNAVAILABLE';
  end if;
  identity_key:=md5(jsonb_build_array(lower(btrim(event->>'name')),lower(btrim(coalesce(event->>'venue',''))),left(coalesce(nullif(event->>'localDate',''),event->>'startsAt'),4))::text);
  delete from private.festival_slot_overrides s where s.city_id=p_city_id and s.slot<>p_slot
    and (s.event_id=p_event_id or s.festival_key=identity_key);
  insert into private.festival_slot_overrides(city_id,slot,event_id,festival_key,ends_at,updated_by)
    values(p_city_id,p_slot,p_event_id,identity_key,least(coalesce(p_ends_at,starts_at),starts_at),auth.uid())
  on conflict(city_id,slot) do update set event_id=excluded.event_id,festival_key=excluded.festival_key,ends_at=excluded.ends_at,updated_at=now(),updated_by=excluded.updated_by;
end;
$$;
revoke all on function public.set_admin_festival_slot(text,integer,text,timestamptz) from public,anon;
grant execute on function public.set_admin_festival_slot(text,integer,text,timestamptz) to authenticated;

notify pgrst,'reload schema';
