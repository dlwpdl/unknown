-- Regular meetups can pick weekdays and a time (I-meet-14 step 2). The picked schedule rides in
-- room_preview.recurrence = {days:[0..6], time:'HH:MM', timezone:'<IANA>'}; cadence keeps the text made
-- from it, so older apps and the web still show a schedule. Apps before this migration simply never send it,
-- and new apps retry without it on servers that do not have this migration yet.
set local lock_timeout = '5s';

-- Accept and store the key; every other create_chilling_event check stays as it is.
do $$
declare definition text;
  allowed text:='''languageExchange'',''access'']';
  stored text:='''recommendedAgeMax'',p_event->''recommendedAgeMax'')';
begin
  definition:=pg_get_functiondef('public.create_chilling_event(text,text,text,jsonb,text,text[])'::regprocedure);
  if strpos(definition,allowed)=0 or strpos(definition,stored)=0 then raise exception 'create_chilling_event recurrence anchor missing'; end if;
  execute replace(replace(definition,allowed,'''languageExchange'',''access'',''recurrence'']'),
    stored,stored||'||jsonb_strip_nulls(jsonb_build_object(''recurrence'',p_event->''recurrence''))');
end;
$$;

-- Public schedule data, never an admission check. A cadence or kind edit from the edit screen (which does not
-- send recurrence) drops a stale recurrence so cards never show days the host has since rewritten.
create function private.guard_meetup_recurrence() returns trigger
language plpgsql set search_path='' as $$
declare recurrence jsonb:=new.room_preview->'recurrence';
begin
  if coalesce(recurrence,'null'::jsonb)='null'::jsonb then return new; end if;
  if tg_op='UPDATE' and recurrence is not distinct from old.room_preview->'recurrence' then
    if (new.room_preview->'cadence',new.room_preview->'eventKind') is not distinct from (old.room_preview->'cadence',old.room_preview->'eventKind') then return new; end if;
    new.room_preview:=new.room_preview-'recurrence';
    return new;
  end if;
  if new.room_preview->>'eventKind' is distinct from 'group' then raise exception 'INVALID_EVENT_RECURRENCE'; end if;
  if jsonb_typeof(recurrence) is distinct from 'object' or (recurrence-array['days','time','timezone'])<>'{}'::jsonb then raise exception 'INVALID_EVENT_RECURRENCE'; end if;
  if jsonb_typeof(recurrence->'days') is distinct from 'array' or jsonb_array_length(recurrence->'days') not between 1 and 7 then raise exception 'INVALID_EVENT_RECURRENCE'; end if;
  if exists(select 1 from jsonb_array_elements(recurrence->'days') day where jsonb_typeof(day) is distinct from 'number' or day::text !~ '^[0-6]$') then raise exception 'INVALID_EVENT_RECURRENCE'; end if;
  if (select count(distinct day::text) from jsonb_array_elements(recurrence->'days') day)<>jsonb_array_length(recurrence->'days') then raise exception 'INVALID_EVENT_RECURRENCE'; end if;
  if jsonb_typeof(recurrence->'time') is distinct from 'string' or recurrence->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'INVALID_EVENT_RECURRENCE'; end if;
  if jsonb_typeof(recurrence->'timezone') is distinct from 'string'
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=recurrence->>'timezone') then raise exception 'INVALID_EVENT_RECURRENCE'; end if;
  return new;
end;
$$;
revoke all on function private.guard_meetup_recurrence() from public,anon,authenticated,service_role;
create trigger posts_meetup_recurrence before insert or update of room_preview on public.posts
for each row execute function private.guard_meetup_recurrence();

-- New meetup-create controls (three steps, weekday picker, city change, place search, host visibility).
insert into private.behavior_targets(id) values
('meetup.create.next'),('meetup.create.cadence.day'),('meetup.create.cadence.time'),('meetup.create.cadence.mode'),
('meetup.create.city'),('meetup-create.place.search'),('meetup-create.host-visibility')
on conflict do nothing;
