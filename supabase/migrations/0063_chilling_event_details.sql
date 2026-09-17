-- Public event metadata only. Missing eventKind remains a legacy ongoing group.
-- Profile sharing, private venues, registration answers and paid tools are not stored here.
create function private.validate_chilling_event(p_post_id uuid, p_preview jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare starts_at timestamptz; ends_at timestamptz; capacity numeric;
begin
  if p_preview->>'eventKind' is null or p_preview->>'eventKind' not in ('once','group') then
    raise exception 'INVALID_EVENT_KIND';
  end if;
  if jsonb_typeof(p_preview->'capacity') is distinct from 'number' then raise exception 'INVALID_EVENT_CAPACITY'; end if;
  capacity := (p_preview->>'capacity')::numeric;
  if capacity not between 2 and 50 or capacity<>trunc(capacity) then raise exception 'INVALID_EVENT_CAPACITY'; end if;
  if capacity < 1+(select count(*) from public.meetup_requests where post_id=p_post_id and status='approved') then
    raise exception 'EVENT_CAPACITY_BELOW_MEMBERS';
  end if;
  if p_preview->>'eventKind'='once' then
    begin
      starts_at := (p_preview->>'startsAt')::timestamptz;
      ends_at := (p_preview->>'endsAt')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then raise exception 'INVALID_EVENT_SCHEDULE';
    end;
    if starts_at is null or ends_at is null or not isfinite(starts_at) or not isfinite(ends_at)
      or starts_at>=ends_at or ends_at<=now() or p_preview->>'cadence' is not null then
      raise exception 'INVALID_EVENT_SCHEDULE';
    end if;
    if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_preview->>'timezone') then
      raise exception 'INVALID_EVENT_TIMEZONE';
    end if;
  else
    if p_preview->>'startsAt' is not null or p_preview->>'endsAt' is not null or p_preview->>'timezone' is not null then
      raise exception 'INVALID_EVENT_SCHEDULE';
    end if;
    if jsonb_typeof(p_preview->'cadence') is distinct from 'string'
      or char_length(trim(p_preview->>'cadence')) not between 1 and 80 then raise exception 'INVALID_EVENT_CADENCE'; end if;
  end if;
end;
$$;

create function private.guard_chilling_event_details()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    -- Count/closed changes must keep working after expiration (approval, leaving, closing).
    if (new.room_preview->'eventKind',new.room_preview->'startsAt',new.room_preview->'endsAt',new.room_preview->'timezone',new.room_preview->'cadence',new.room_preview->'capacity')
      is not distinct from
      (old.room_preview->'eventKind',old.room_preview->'startsAt',old.room_preview->'endsAt',old.room_preview->'timezone',old.room_preview->'cadence',old.room_preview->'capacity') then return new; end if;
    if not (coalesce(new.room_preview,'{}') ?| array['eventKind','startsAt','endsAt','timezone','cadence'])
      and not (coalesce(old.room_preview,'{}') ?| array['eventKind','startsAt','endsAt','timezone','cadence']) then return new; end if;
  elsif not (coalesce(new.room_preview,'{}') ?| array['eventKind','startsAt','endsAt','timezone','cadence']) then return new;
  end if;
  perform private.validate_chilling_event(new.id,new.room_preview);
  return new;
end;
$$;
create trigger posts_chilling_event_details before insert or update of room_preview on public.posts
for each row execute function private.guard_chilling_event_details();

create function public.configure_chilling_event(
  p_post_id uuid, p_kind text, p_starts_at timestamptz default null, p_ends_at timestamptz default null,
  p_timezone text default null, p_cadence text default null, p_capacity integer default 8
)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); meetup public.posts; preview jsonb;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  -- Same statement/row lock order as request, approval and close; do not trust client counts.
  perform private.lock_relationships();
  select * into meetup from public.posts
    where id=p_post_id and author_id=u and status='published' and room_preview is not null for update;
  if meetup.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if coalesce(meetup.room_preview->>'closed','false')='true' then raise exception 'MEETUP_CLOSED'; end if;
  preview := meetup.room_preview||jsonb_build_object('eventKind',p_kind,'startsAt',p_starts_at,'endsAt',p_ends_at,
    'timezone',p_timezone,'cadence',trim(p_cadence),'capacity',p_capacity);
  perform private.validate_chilling_event(p_post_id,preview);
  update public.posts set room_preview=preview where id=p_post_id;
end;
$$;

create function private.assert_chilling_open(p_preview jsonb)
returns void language plpgsql set search_path='' as $$
begin
  if p_preview->>'eventKind'='once' and (p_preview->>'endsAt')::timestamptz<=now() then raise exception 'MEETUP_EXPIRED'; end if;
end;
$$;
create function private.guard_chilling_request_expiry()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status not in ('pending','approved') then return new; end if;
  if tg_op='UPDATE' and old.status=new.status and old.post_id=new.post_id then return new; end if;
  perform private.assert_chilling_open((select room_preview from public.posts where id=new.post_id));
  return new;
end;
$$;
create trigger meetup_requests_chilling_expiry before insert or update of status,post_id on public.meetup_requests
for each row execute function private.guard_chilling_request_expiry();

-- Check before idempotent request returns/rate/capacity checks as well as guarding direct writes.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.request_meetup_join(uuid,text)'::regprocedure);
  anchor:='  if coalesce(meetup.room_preview->>''closed'',''false'')=''true'' then raise exception ''MEETUP_CLOSED''; end if;';
  if strpos(definition,anchor)=0 then raise exception 'request_meetup_join anchor missing'; end if;
  execute replace(definition,anchor,anchor||E'\n  perform private.assert_chilling_open(meetup.room_preview);');
  definition:=pg_get_functiondef('public.respond_meetup_request(uuid,text)'::regprocedure);
  anchor:='  if p_response=''approved'' then';
  if strpos(definition,anchor)=0 then raise exception 'respond_meetup_request anchor missing'; end if;
  execute replace(definition,anchor,anchor||E'\n    perform private.assert_chilling_open(p.room_preview);');
end;
$$;

revoke all on function private.validate_chilling_event(uuid,jsonb),private.guard_chilling_event_details(),
  private.assert_chilling_open(jsonb),private.guard_chilling_request_expiry() from public,anon,authenticated;
revoke all on function public.configure_chilling_event(uuid,text,timestamptz,timestamptz,text,text,integer) from public,anon,authenticated;
grant execute on function public.configure_chilling_event(uuid,text,timestamptz,timestamptz,text,text,integer) to authenticated;
