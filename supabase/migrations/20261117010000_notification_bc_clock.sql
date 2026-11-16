-- B.C. stays on UTC-7 from 2026-11-01, but this database's zone data still says UTC-8 each winter (see 20261106130000).
-- 20261117000000 read local hours straight from America/Vancouver, so in Vancouver the quiet hours ran 23:00-09:00,
-- the evening roundup would have gone at 19:00 and newcomer notes 11:00-23:00. Same rule as the meetup reminders:
-- only the calculation switches zone, through private.meetup_clock_zone. Drop with it once the database has tz 2026b.
create function pg_temp.rep(def text, find text, repl text) returns text
language plpgsql as $$
declare found integer := (length(def) - length(replace(def, find, ''))) / greatest(length(find), 1);
begin
  if found <> 1 then raise exception 'NOTIFICATION_BC_CLOCK_ANCHOR % (found %)', left(find, 80), found; end if;
  return replace(def, find, repl);
end $$;

do $$
begin
  execute pg_temp.rep(pg_get_functiondef('private.night_push_due(text,text,uuid,text)'::regprocedure),
    $a$zone := coalesce(p_zone, (select c.timezone from public.profiles r join public.cities c on c.id = r.city_id where r.id = p_user), 'America/Vancouver');$a$,
    $a$zone := private.meetup_clock_zone(coalesce(p_zone, (select c.timezone from public.profiles r join public.cities c on c.id = r.city_id where r.id = p_user), 'America/Vancouver'), now());$a$);
  execute pg_temp.rep(pg_get_functiondef('private.send_new_posts_roundup(timestamptz)'::regprocedure),
    $a$(select coalesce(private.recommendation_timezone(r.id), city.timezone) zone) z$a$,
    $a$(select private.meetup_clock_zone(coalesce(private.recommendation_timezone(r.id), city.timezone), p_now) zone) z$a$);
  execute pg_temp.rep(pg_get_functiondef('private.process_bubble_alerts(integer)'::regprocedure),
    $a$now() at time zone coalesce(private.recommendation_timezone(r.id), city.timezone)) between 8 and 21$a$,
    $a$now() at time zone private.meetup_clock_zone(coalesce(private.recommendation_timezone(r.id), city.timezone), now())) between 8 and 21$a$);
  execute pg_temp.rep(pg_get_functiondef('private.send_newcomer_nudges(timestamptz)'::regprocedure),
    $a$zone:=coalesce(private.recommendation_timezone(member.id),'America/Vancouver');$a$,
    $a$zone:=private.meetup_clock_zone(coalesce(private.recommendation_timezone(member.id),'America/Vancouver'),p_now);$a$);
end $$;
