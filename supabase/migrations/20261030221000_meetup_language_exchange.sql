-- Language exchange meetups (owner 2026-10-30 "언어교환 모임 굿"; design output/reviews/meetup-host-tools-2026-10-29 §5, policy §6-10).
-- Additive only. room_preview.category keeps the six existing values: the published app (v1.4.6) renders
-- tr(CHILLING_CATEGORY_LABELS[category]) and an unknown value reaches String.replace on undefined, so the exchange is
-- stored beside it and category stays 'casual' (old apps show "가볍게"). Existing functions are patched by anchor, so a
-- drifted production definition stops the migration.
--
--   posts.room_preview.languageExchange = {"languages":["ko","en"],"share":50}
--     share = percent of member seats (host excluded) for languages[0]; each side keeps at least one seat.
--   private.meetup_member_languages(post_id,user_id,speaks,learns) = the side an applicant or waitlisted member chose.
--     Old-app applicants have no row and count toward the meetup capacity only.
-- Seat arithmetic is mirrored by src/lib/meetup-language.ts (scripts/meetup-language.test.mjs).

create table private.meetup_member_languages (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  speaks text not null check (speaks in ('ko','en','fr')),
  learns text not null check (learns in ('ko','en','fr')),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (post_id,user_id),
  check (speaks<>learns)
);
create index meetup_member_languages_side_idx on private.meetup_member_languages(post_id,speaks);
alter table private.meetup_member_languages enable row level security;
revoke all on private.meetup_member_languages from public,anon,authenticated,service_role;
alter table private.meetup_member_languages owner to postgres;

-- 1. Validation and seat arithmetic.
create function private.meetup_language_exchange(p_value jsonb,p_capacity integer) returns jsonb
language plpgsql immutable set search_path='' as $$
declare languages jsonb:=p_value->'languages'; share numeric;
begin
  if jsonb_typeof(p_value) is distinct from 'object' or jsonb_typeof(languages) is distinct from 'array' then raise exception 'INVALID_LANGUAGE_EXCHANGE'; end if;
  if (p_value-array['languages','share'])<>'{}'::jsonb or jsonb_array_length(languages)<>2
    or jsonb_typeof(languages->0) is distinct from 'string' or jsonb_typeof(languages->1) is distinct from 'string'
    or languages->>0 not in ('ko','en','fr') or languages->>1 not in ('ko','en','fr') or languages->>0=languages->>1
    or jsonb_typeof(p_value->'share') is distinct from 'number' then raise exception 'INVALID_LANGUAGE_EXCHANGE'; end if;
  share:=(p_value->>'share')::numeric;
  if share<>trunc(share) or share not between 10 and 90 then raise exception 'INVALID_LANGUAGE_EXCHANGE'; end if;
  if p_capacity is null or p_capacity<3 then raise exception 'LANGUAGE_EXCHANGE_CAPACITY'; end if;
  return jsonb_build_object('languages',languages,'share',share::integer);
end $$;

-- Seats for one side, or null when the meetup has no exchange or fewer than two member seats (capacity edited down).
create function private.meetup_language_seats(p_room jsonb,p_language text) returns integer
language sql immutable set search_path='' as $$
  select case when p_language=x.languages->>0 then x.first when p_language=x.languages->>1 then x.seats-x.first end
  from (select p_room->'languageExchange'->'languages' languages,s.seats,
      greatest(1,least(s.seats-1,(s.seats*(p_room->'languageExchange'->>'share')::integer+50)/100)) first
    from (select coalesce((p_room->>'capacity')::integer,8)-1 seats) s) x
  where p_room ? 'languageExchange' and x.seats>=2;
$$;

create function private.meetup_language_taken(p_post_id uuid,p_language text,p_except uuid) returns integer
language sql stable security definer set search_path='' as $$
  select count(*)::integer from public.meetup_requests r
    join private.meetup_member_languages l on l.post_id=r.post_id and l.user_id=r.requester_id
  where r.post_id=p_post_id and r.status='approved' and l.speaks=p_language and r.id is distinct from p_except;
$$;

create function private.assert_meetup_language_choice(p_room jsonb,p_speaks text,p_learns text) returns void
language plpgsql immutable set search_path='' as $$
begin
  if p_room is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if not (p_room ? 'languageExchange') or p_speaks is null or p_learns is null or p_speaks=p_learns
    or not (p_room->'languageExchange'->'languages' ? p_speaks) or not (p_room->'languageExchange'->'languages' ? p_learns) then
    raise exception 'INVALID_LANGUAGE_CHOICE';
  end if;
end $$;

-- A pending or approved member keeps the side they are already counted on.
create function private.save_meetup_language(p_post_id uuid,p_user_id uuid,p_speaks text,p_learns text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.meetup_requests where post_id=p_post_id and requester_id=p_user_id and status in('pending','approved')) then return; end if;
  insert into private.meetup_member_languages(post_id,user_id,speaks,learns) values(p_post_id,p_user_id,p_speaks,p_learns)
    on conflict(post_id,user_id) do update set speaks=excluded.speaks,learns=excluded.learns,updated_at=clock_timestamp();
end $$;

-- Waitlist selection: live offers on the same side hold a seat, like the meetup-wide open_offers in offer_meetup_waitlist.
create function private.meetup_language_seat_open(p_post_id uuid,p_user_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare side text; seats integer;
begin
  select speaks into side from private.meetup_member_languages where post_id=p_post_id and user_id=p_user_id;
  if side is null then return true; end if;
  seats:=private.meetup_language_seats((select room_preview from public.posts where id=p_post_id),side);
  return seats is null or private.meetup_language_taken(p_post_id,side,null)+(select count(*) from private.meetup_waitlist w
    join private.meetup_member_languages l on l.post_id=w.post_id and l.user_id=w.user_id
    where w.post_id=p_post_id and l.speaks=side and w.cancelled_at is null and w.invited_at is not null and w.offer_expires_at>clock_timestamp())<seats;
end $$;

-- 2. A full side takes no new request and no approval; the other side and the meetup stay open.
-- Same shape as guard_meetup_capacity_admission; the name sorts after it so a full meetup still reports MEETUP_FULL first.
create function private.guard_meetup_language_side() returns trigger
language plpgsql security definer set search_path='' as $$
declare side text; room jsonb; seats integer;
begin
  if new.status not in ('pending','approved') then return new; end if;
  if tg_op='UPDATE' and old.post_id=new.post_id and (old.status='approved' or old.status=new.status) then return new; end if;
  select speaks into side from private.meetup_member_languages where post_id=new.post_id and user_id=new.requester_id;
  if side is null then return new; end if;
  perform private.lock_relationships();
  select room_preview into room from public.posts where id=new.post_id for update;
  seats:=private.meetup_language_seats(room,side);
  if seats is not null and private.meetup_language_taken(new.post_id,side,new.id)>=seats then raise exception 'LANGUAGE_SIDE_FULL'; end if;
  return new;
end $$;
create trigger meetup_requests_z_language_side before insert or update of status,post_id on public.meetup_requests
  for each row execute function private.guard_meetup_language_side();

-- 3. Creation: the existing six-argument RPC accepts languageExchange; everything else in it is unchanged.
-- Offers and host invitations skip waitlisted people whose side has no free seat.
-- Account deletion reuses the host-tools purge hook that purge_account_data and delete_my_account already call.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.create_chilling_event(text,text,text,jsonb,text,text[])'::regprocedure);
  anchor:='''hostProfileRevision'']';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'LANGUAGE_EXCHANGE_CREATE_ALLOWLIST_CHANGED'; end if;
  definition:=replace(definition,anchor,'''hostProfileRevision'',''languageExchange'']');
  -- Reject a bad exchange before create_post; validate_chilling_event still owns the capacity rules.
  anchor:='  -- Preserve create_post''s consent, moderation, membership, quota, cooldown and slot checks.';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'LANGUAGE_EXCHANGE_CREATE_GUARD_CHANGED'; end if;
  definition:=replace(definition,anchor,$patch$  if p_event ? 'languageExchange' then
    if category<>'casual' then raise exception 'INVALID_EVENT_CATEGORY'; end if;
    perform private.meetup_language_exchange(p_event->'languageExchange',
      case when jsonb_typeof(p_event->'capacity')='number' then least(floor((p_event->>'capacity')::numeric),100000)::integer end);
  end if;
$patch$||anchor);
  anchor:='  return post_id;';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'LANGUAGE_EXCHANGE_CREATE_RETURN_CHANGED'; end if;
  execute replace(definition,anchor,$patch$  if p_event ? 'languageExchange' then
    update public.posts set room_preview=room_preview||jsonb_build_object('languageExchange',
      private.meetup_language_exchange(p_event->'languageExchange',(p_event->>'capacity')::integer)) where id=post_id;
  end if;
$patch$||anchor);

  anchor:='private.meetup_waitlist_eligible(w.post_id,w.user_id)';
  definition:=pg_get_functiondef('private.offer_meetup_waitlist(uuid,integer)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'LANGUAGE_EXCHANGE_OFFER_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' and private.meetup_language_seat_open(w.post_id,w.user_id)');
  definition:=pg_get_functiondef('public.invite_next_meetup_waitlist(uuid)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'LANGUAGE_EXCHANGE_INVITE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' and private.meetup_language_seat_open(w.post_id,w.user_id)');

  anchor:='  delete from private.meetup_templates where owner_id=p_user_id;';
  definition:=pg_get_functiondef('private.purge_meetup_tool_account_data(uuid)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'LANGUAGE_EXCHANGE_PURGE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||E'\n  delete from private.meetup_member_languages where user_id=p_user_id or post_id in(select id from public.posts where author_id=p_user_id);');
end $$;

-- 4. App RPCs. Joining and the waitlist go through the existing paths, so every profile, consent, capacity,
-- block, tier and rate check still applies; the side guard runs on the request insert.
create function public.request_language_exchange_join(p_post_id uuid,p_answer text,p_consent_version text,p_profile_revision text,p_speaks text,p_learns text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  perform private.assert_meetup_language_choice((select room_preview from public.posts where id=p_post_id and status='published'),p_speaks,p_learns);
  perform private.save_meetup_language(p_post_id,u,p_speaks,p_learns);
  return public.request_chilling_join_v2(p_post_id,p_answer,p_consent_version,p_profile_revision);
end $$;

create function public.set_language_exchange_waitlist(p_post_id uuid,p_speaks text,p_learns text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  perform private.assert_meetup_language_choice((select room_preview from public.posts where id=p_post_id and status='published'),p_speaks,p_learns);
  perform private.save_meetup_language(p_post_id,u,p_speaks,p_learns);
  perform public.set_meetup_waitlist(p_post_id,true);
end $$;

-- Seats and approvals per side for anyone who can see the meetup; the host also gets pending/waitlist counts,
-- each pending or approved request's side, and how many requests came from apps without the language step.
create function public.get_meetup_languages(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; host boolean;
begin
  event:=private.meetup_tool_context(p_post_id,u,false);
  if not (event.room_preview ? 'languageExchange') then return null; end if;
  host:=event.author_id=u;
  return jsonb_build_object(
    'languages',event.room_preview->'languageExchange'->'languages',
    'share',event.room_preview->'languageExchange'->'share',
    'sides',(select jsonb_agg(jsonb_build_object('language',x.language,
        'seats',private.meetup_language_seats(event.room_preview,x.language),
        'approved',private.meetup_language_taken(event.id,x.language,null),
        'pending',case when host then (select count(*) from public.meetup_requests r
          join private.meetup_member_languages l on l.post_id=r.post_id and l.user_id=r.requester_id
          where r.post_id=event.id and r.status='pending' and l.speaks=x.language) end,
        'waiting',case when host then (select count(*) from private.meetup_waitlist w
          join private.meetup_member_languages l on l.post_id=w.post_id and l.user_id=w.user_id
          where w.post_id=event.id and w.cancelled_at is null and w.invited_at is null and l.speaks=x.language
            and private.meetup_waitlist_eligible(w.post_id,w.user_id)) end) order by x.position)
      from jsonb_array_elements_text(event.room_preview->'languageExchange'->'languages') with ordinality x(language,position)),
    'mine',(select jsonb_build_object('speaks',l.speaks,'learns',l.learns) from private.meetup_member_languages l
      where l.post_id=event.id and l.user_id=u),
    'requests',case when host then (select coalesce(jsonb_object_agg(r.id::text,jsonb_build_object('speaks',l.speaks,'learns',l.learns)),'{}'::jsonb)
      from public.meetup_requests r join private.meetup_member_languages l on l.post_id=r.post_id and l.user_id=r.requester_id
      where r.post_id=event.id and r.status in('pending','approved')) end,
    'unknown',case when host then (select jsonb_build_object('approved',count(*) filter (where r.status='approved'),'pending',count(*) filter (where r.status='pending'))
      from public.meetup_requests r where r.post_id=event.id and r.status in('pending','approved')
        and not exists(select 1 from private.meetup_member_languages l where l.post_id=r.post_id and l.user_id=r.requester_id)) end);
end $$;

-- 5. Grants, owners and analytics targets.
revoke all on function private.meetup_language_exchange(jsonb,integer),private.meetup_language_seats(jsonb,text),
  private.meetup_language_taken(uuid,text,uuid),private.assert_meetup_language_choice(jsonb,text,text),
  private.save_meetup_language(uuid,uuid,text,text),private.meetup_language_seat_open(uuid,uuid),private.guard_meetup_language_side()
  from public,anon,authenticated,service_role;
revoke all on function public.request_language_exchange_join(uuid,text,text,text,text,text),public.set_language_exchange_waitlist(uuid,text,text),
  public.get_meetup_languages(uuid) from public,anon,authenticated,service_role;
grant execute on function public.request_language_exchange_join(uuid,text,text,text,text,text),public.set_language_exchange_waitlist(uuid,text,text),
  public.get_meetup_languages(uuid) to authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in('meetup_language_exchange','meetup_language_seats','meetup_language_taken',
        'assert_meetup_language_choice','save_meetup_language','meetup_language_seat_open','guard_meetup_language_side'))
      or (n.nspname='public' and p.proname in('request_language_exchange_join','set_language_exchange_waitlist','get_meetup_languages')) loop
    execute format('alter function %s owner to postgres',f.signature);
  end loop;
end $$;

insert into private.behavior_targets(id) values
 ('meetup-create.language.pair'),('meetup-create.language.share'),('meetup.join.language')
on conflict do nothing;
notify pgrst,'reload schema';
