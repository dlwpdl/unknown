-- "열리면 알려 주세요" (owner 2026-11-16): on an event or place with no open public meetup, one button asks to hear when
-- one opens, and shows how many people are waiting (count only, never who). The first public meetup linked to that
-- event/place tells the waiting people once and ends their request. Free for everyone.
-- A meetup links to an event by its "행사 ID: <id>" line and to a place by its trailing "장소 정보: <OSM url>" line
-- (what meetup-create writes). Partner places have no such link, so only OSM places can be waited on.

create table private.meetup_waiting (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('event','place')),
  ref text not null check (char_length(ref) between 1 and 100),
  city_id text not null check (city_id ~ '^[a-z][a-z0-9-]{0,63}$'),
  created_at timestamptz not null default now(),
  primary key (user_id,kind,ref),
  check ((kind='event' and ref ~ '^[A-Za-z0-9_-]{1,100}$') or (kind='place' and ref ~ '^osm:(node|way|relation):[1-9][0-9]{0,18}$'))
);
create index meetup_waiting_ref_idx on private.meetup_waiting(kind,ref,city_id);
alter table private.meetup_waiting enable row level security;
revoke all on private.meetup_waiting from public, anon, authenticated, service_role;

-- Same reading rules as the app (src/lib/meetup-destination.ts): a place line wins; an event id counts only once.
create function private.meetup_place_ref(p_body text) returns text
language sql immutable set search_path='' as $$
  select 'osm:'||m[1]||':'||m[2] from regexp_match(p_body,E'\n\n장소: [^\r\n]{1,250}\n장소 정보: https://www\\.openstreetmap\\.org/(node|way|relation)/([1-9][0-9]{0,18})$') m;
$$;
create function private.meetup_event_ref(p_body text) returns text
language sql immutable set search_path='' as $$
  select case when private.meetup_place_ref(p_body) is null
    and (select count(*) from regexp_matches(p_body,E'(?:^|\n)행사 ID: ','g'))=1
    then (regexp_match(left(p_body,5000),E'(?:^|\n)행사 ID: ([A-Za-z0-9_-]{1,100})(?:\r?\n|$)'))[1] end;
$$;

create function private.meetup_waiting_state(p_user uuid,p_kind text,p_ref text,p_city text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    -- shortcut: scans the city's meetup posts; fine while meetups number in the hundreds, add an index on the link if not.
    'open',exists(select 1 from public.posts p where p.city_id=p_city and p.status='published' and p.room_preview is not null
      and private.meetup_is_open(p.status,p.room_preview) and coalesce(p.room_preview->>'access','')<>'invite'
      and case p_kind when 'event' then private.meetup_event_ref(p.body)=p_ref else private.meetup_place_ref(p.body)=p_ref end),
    'count',(select count(*) from private.meetup_waiting w where w.kind=p_kind and w.ref=p_ref and w.city_id=p_city),
    'mine',exists(select 1 from private.meetup_waiting w where w.user_id=p_user and w.kind=p_kind and w.ref=p_ref));
$$;

create function private.meetup_waiting_check(p_kind text,p_ref text,p_city text) returns void
language plpgsql set search_path='' as $$
begin
  if p_kind not in ('event','place') or p_city is null or p_city !~ '^[a-z][a-z0-9-]{0,63}$' or p_ref is null
    or (p_kind='event' and p_ref !~ '^[A-Za-z0-9_-]{1,100}$')
    or (p_kind='place' and p_ref !~ '^osm:(node|way|relation):[1-9][0-9]{0,18}$') then raise exception 'INVALID_WAITING_TARGET'; end if;
end $$;

create function public.get_meetup_waiting(p_kind text,p_ref text,p_city_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.meetup_waiting_check(p_kind,p_ref,p_city_id);
  return private.meetup_waiting_state(u,p_kind,p_ref,p_city_id);
end $$;

create function public.set_meetup_waiting(p_kind text,p_ref text,p_city_id text,p_on boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.meetup_waiting_check(p_kind,p_ref,p_city_id);
  if p_on is null then raise exception 'INVALID_WAITING_TARGET'; end if;
  perform private.enforce_rate_limit('meetup_waiting',30,interval '1 day');
  if p_on then
    if (private.meetup_waiting_state(u,p_kind,p_ref,p_city_id)->>'open')::boolean then raise exception 'MEETUP_ALREADY_OPEN'; end if;
    if (select count(*) from private.meetup_waiting where user_id=u)>=30 then raise exception 'WAITING_LIMIT'; end if;
    insert into private.meetup_waiting(user_id,kind,ref,city_id) values(u,p_kind,p_ref,p_city_id) on conflict do nothing;
  else
    delete from private.meetup_waiting where user_id=u and kind=p_kind and ref=p_ref;
  end if;
  return private.meetup_waiting_state(u,p_kind,p_ref,p_city_id);
end $$;

-- A new public meetup tells everyone waiting for its event/place, once, and ends their request.
-- Like the follower alert: only meetups created in the last hour (older posts also update room_preview).
create function private.notify_meetup_waiting() returns trigger
language plpgsql security definer set search_path='' as $$
declare waiting record; event_ref text:=private.meetup_event_ref(new.body); place_ref text:=private.meetup_place_ref(new.body);
begin
  if new.created_at<now()-interval '1 hour' or not private.meetup_is_open(new.status,new.room_preview)
    or coalesce(new.room_preview->>'access','')='invite' or not private.is_active_account(new.author_id)
    or (event_ref is null and place_ref is null) then return new; end if;
  -- shortcut: fans out inside the creating transaction; move to a queue if one event ever has thousands waiting.
  for waiting in
    with taken as (
      delete from private.meetup_waiting w
      where w.city_id=new.city_id and w.user_id<>new.author_id
        and ((w.kind='event' and w.ref=event_ref) or (w.kind='place' and w.ref=place_ref))
        and not private.is_blocked_between(w.user_id,new.author_id)
        and not (coalesce(new.room_preview->>'newcomerOnly','')='true' and private.newcomer_ends_at(w.user_id) is null)
      returning w.user_id)
    select user_id from taken
  loop
    perform private.create_notification(waiting.user_id,'meetup_changed',new.author_id,'post',new.id,
      '기다리던 모임이 열렸어요. '||left(new.title,80),'/post/'||new.id::text);
  end loop;
  return new;
end $$;
create trigger posts_notify_meetup_waiting after insert or update of room_preview,status on public.posts
  for each row when (new.room_preview ? 'eventKind' and new.status='published') execute function private.notify_meetup_waiting();

-- Account deletion: the waiting requests go with the account.
create function private.purge_meetup_waiting_account_data(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  delete from private.meetup_waiting where user_id=p_user_id;
end $$;
do $$
declare definition text; anchor text:='perform private.purge_meetup_convenience_account_data(current_user_id);';
begin
  definition:=pg_get_functiondef('private.purge_account_data(text)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MEETUP_WAITING_PURGE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' perform private.purge_meetup_waiting_account_data(current_user_id);');
end $$;

revoke all on function private.meetup_place_ref(text), private.meetup_event_ref(text), private.meetup_waiting_state(uuid,text,text,text),
  private.meetup_waiting_check(text,text,text), private.notify_meetup_waiting(), private.purge_meetup_waiting_account_data(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_meetup_waiting(text,text,text), public.set_meetup_waiting(text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.get_meetup_waiting(text,text,text), public.set_meetup_waiting(text,text,text,boolean) to authenticated;

insert into private.behavior_targets(id) values ('meetup.waiting.join'),('meetup.waiting.leave'),('meetup.waiting.retry') on conflict do nothing;
notify pgrst,'reload schema';
