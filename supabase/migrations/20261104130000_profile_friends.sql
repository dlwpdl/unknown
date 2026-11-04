-- Profile redesign (owner 2026-11-04, P1·P2·P3·P5): friends need the other person's acceptance, the profile shows a map
-- of saved places and record counts, and a business shows who saved it.
-- '사용자 저장' (private.saved_users) stays a private bookmark and never becomes a friendship.
-- Saved places stay owner-only until the owner turns on sharing with friends. The default is off and nothing saved
-- before is shared retroactively; changing that default is the owner's decision.
-- Maps only ever show catalog places and consented businesses linked to one: saved posts (rent, used goods, meetups),
-- saved people and real-estate or source records never reach a map, so no saved home address can be pinned.

create table private.friendships (
  user_low_id uuid not null references public.profiles(id) on delete cascade,
  user_high_id uuid not null references public.profiles(id) on delete cascade,
  requester_id uuid not null,
  accepted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_low_id,user_high_id),
  check(user_low_id<user_high_id),
  check(requester_id=user_low_id or requester_id=user_high_id),
  check(accepted_at is null or accepted_at>=created_at)
);
create index friendships_high on private.friendships(user_high_id,user_low_id);
create index friendships_pending_requester on private.friendships(requester_id) where accepted_at is null;

create table private.profile_sharing (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  saved_places_to_friends boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
-- Business pages count savers by place too.
create index saved_places_place on private.saved_places(city_id,place_key);

do $$ declare t text; begin
 foreach t in array array['friendships','profile_sharing'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  execute format('alter table private.%I owner to postgres',t);
 end loop;
end $$;

create function private.are_friends(p_a uuid,p_b uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.friendships where user_low_id=least(p_a,p_b) and user_high_id=greatest(p_a,p_b) and accepted_at is not null)
$$;

create function private.friendship_state(p_viewer uuid,p_user uuid) returns text
language sql stable security definer set search_path='' as $$
  select coalesce((select case when f.accepted_at is not null then 'friends' when f.requester_id=p_viewer then 'outgoing' else 'incoming' end
    from private.friendships f where f.user_low_id=least(p_viewer,p_user) and f.user_high_id=greatest(p_viewer,p_user)),'none')
$$;

-- No request reaches or comes from an operated character, a blocked or reported pair, or an inactive account.
create function private.friend_pair_ok(p_viewer uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_viewer is not null and p_user is not null and p_viewer<>p_user
    and private.is_active_account(p_viewer) and private.is_active_account(p_user)
    and not private.is_blocked_between(p_viewer,p_user)
    and not private.has_reported(p_viewer,'user',p_user) and not private.has_reported(p_user,'user',p_viewer)
    and not private.is_operated_character(p_viewer) and not private.is_operated_character(p_user)
$$;

create function private.friend_count(p_user uuid) returns integer
language sql stable security definer set search_path='' as $$
  select count(*)::integer from private.friendships f
  where f.accepted_at is not null and (f.user_low_id=p_user or f.user_high_id=p_user)
    and private.is_active_account(case when f.user_low_id=p_user then f.user_high_id else f.user_low_id end)
$$;

-- One row per saved place or business; place_key is null for a business without a map place.
create function private.profile_saved_places(p_user uuid) returns table(city_id text,place_key text,merchant_id uuid,saved_at timestamptz)
language sql stable security definer set search_path='' as $$
  select distinct on (coalesce(x.merchant_id::text,x.city_id||':'||x.place_key)) x.city_id,x.place_key,x.merchant_id,x.saved_at
  from (
    select s.city_id,s.place_key,m.id merchant_id,s.created_at saved_at
    from private.saved_places s
    left join private.webshop_place_links l on l.place_key=s.place_key and l.city_id=s.city_id
    left join private.merchants m on m.id=l.merchant_id and m.city_id=l.city_id and m.record_kind='business'
      and m.deleted_at is null and m.status<>'paused' and m.consent='granted'
    where s.user_id=p_user
    union all
    select m.city_id,l.place_key,m.id,sm.created_at
    from private.saved_merchants sm
    join private.merchants m on m.id=sm.merchant_id and m.record_kind='business' and m.deleted_at is null and m.status<>'paused' and m.consent='granted'
    left join private.webshop_place_links l on l.merchant_id=m.id and l.city_id=m.city_id
    where sm.user_id=p_user
  ) x
  order by coalesce(x.merchant_id::text,x.city_id||':'||x.place_key),x.saved_at desc
$$;

-- Weeks run Monday 00:00 to Sunday 24:00 in Vancouver time. The run stays alive through the current week until that
-- week ends without a save, so Monday morning does not reset last week's run. Removing a save removes its week.
create function private.saved_week_streak(p_saved_at timestamptz[],p_now timestamptz) returns integer
language sql stable set search_path='' as $$
  with weeks as (
    select distinct date_trunc('week',t at time zone 'America/Vancouver')::date w from unnest(p_saved_at) t where t<=p_now
  ), anchor as (
    select case when exists(select 1 from weeks where weeks.w=c.w) then c.w else c.w-7 end s
    from (select date_trunc('week',p_now at time zone 'America/Vancouver')::date w) c
  )
  select count(*)::integer from (select weeks.w,row_number() over(order by weeks.w desc) n from weeks,anchor where weeks.w<=anchor.s) r,anchor
  where r.w=anchor.s-((r.n-1)*7)::integer
$$;

-- Counts are public like the 시안: saved count, streak, meetups, friends. The saved places themselves are returned only
-- to the owner, or to a friend when the owner shares them.
create function public.get_profile_overview(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); own boolean; state text; shows boolean; places jsonb; total integer; streak integer;
begin
  if p_user_id is null then raise exception 'INVALID_PROFILE'; end if;
  own:=uid is not null and uid=p_user_id;
  if own then
    if not private.is_active_account(uid) then return null; end if;
  elsif public.get_public_user_profile(p_user_id) is null then return null;
  end if;
  state:=case when own or uid is null then null else private.friendship_state(uid,p_user_id) end;
  shows:=own or (state='friends' and not private.is_operated_character(p_user_id)
    and coalesce((select s.saved_places_to_friends from private.profile_sharing s where s.user_id=p_user_id),false));
  select count(*)::integer,private.saved_week_streak(coalesce(array_agg(p.saved_at),'{}'::timestamptz[]),now())
    into total,streak from private.profile_saved_places(p_user_id) p;
  if shows then
    select coalesce(jsonb_agg(jsonb_build_object('cityId',p.city_id,'placeKey',p.place_key,'merchantId',p.merchant_id) order by p.saved_at desc),'[]'::jsonb)
      into places from (select * from private.profile_saved_places(p_user_id) x where x.place_key is not null order by x.saved_at desc limit 300) p;
  end if;
  return jsonb_build_object('userId',p_user_id,'own',own,'savedCount',total,'savedWeekStreak',streak,
    'meetupCount',(select count(*)::integer from public.posts x where x.author_id=p_user_id and x.status='published' and x.deleted_at is null
      and x.business_author_id is null and x.tag_id=(select t.id from public.tags t where t.slug='meetup')
      and (own or not private.has_reported(uid,'post',x.id))),
    'friendCount',private.friend_count(p_user_id),'friendship',state,
    'canRequestFriend',coalesce(state='none' and private.friend_pair_ok(uid,p_user_id),false),
    'savedPlaces',places,'mapHiddenReason',case when shows then null when state='friends' then 'not_shared' else 'not_friends' end,
    'sharesSavedPlaces',case when own then coalesce((select s.saved_places_to_friends from private.profile_sharing s where s.user_id=uid),false) end,
    'friendRequestCount',case when own then (select count(*)::integer from private.friendships f
      where f.accepted_at is null and f.requester_id<>uid and (f.user_low_id=uid or f.user_high_id=uid)
        and private.is_active_account(f.requester_id) and not private.is_blocked_between(uid,f.requester_id)) end);
end $$;

-- request · accept · decline · cancel · remove, always between the signed-in member and p_user_id.
create function public.set_friendship(p_user_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); lo uuid; hi uuid; f private.friendships; nickname text;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action is null or p_action not in ('request','accept','decline','cancel','remove') then raise exception 'INVALID_FRIEND_ACTION'; end if;
  if p_user_id is null or p_user_id=uid then raise exception 'FRIEND_UNAVAILABLE'; end if;
  perform private.assert_active_account(uid);
  lo:=least(uid,p_user_id); hi:=greatest(uid,p_user_id);
  perform pg_advisory_xact_lock(hashtextextended(lo::text||':'||hi::text||':friendship',4101));
  select * into f from private.friendships where user_low_id=lo and user_high_id=hi;
  -- They asked first: asking back is the same as accepting.
  if p_action='request' and f.user_low_id is not null and f.accepted_at is null and f.requester_id=p_user_id then p_action:='accept'; end if;
  if p_action='request' then
    if f.user_low_id is null then
      if not private.friend_pair_ok(uid,p_user_id) then raise exception 'FRIEND_UNAVAILABLE'; end if;
      if (select count(*) from private.friendships where requester_id=uid and accepted_at is null)>=100 then raise exception 'FRIEND_REQUEST_LIMIT'; end if;
      insert into private.friendships(user_low_id,user_high_id,requester_id) values(lo,hi,uid);
      -- One alert per pair per week, so cancelling and asking again cannot repeat it.
      if not exists(select 1 from public.notifications n where n.user_id=p_user_id and n.actor_id=uid and n.kind='friend_request'
        and n.created_at>now()-interval '7 days') then
        select p.nickname::text into nickname from public.profiles p where p.id=uid;
        perform private.create_notification(p_user_id,'friend_request',uid,'user',uid,coalesce(nickname,'이웃')||'님이 친구 요청을 보냈어요.','/user/'||uid::text);
      end if;
    end if;
  elsif p_action='accept' then
    if f.accepted_at is null then
      if f.user_low_id is null or f.requester_id=uid then raise exception 'FRIEND_REQUEST_NOT_FOUND'; end if;
      if not private.friend_pair_ok(uid,p_user_id) then raise exception 'FRIEND_UNAVAILABLE'; end if;
      update private.friendships set accepted_at=clock_timestamp() where user_low_id=lo and user_high_id=hi;
      select p.nickname::text into nickname from public.profiles p where p.id=uid;
      perform private.create_notification(p_user_id,'friend_accepted',uid,'user',uid,coalesce(nickname,'이웃')||'님과 친구가 됐어요.','/user/'||uid::text);
    end if;
  elsif p_action='decline' then
    delete from private.friendships where user_low_id=lo and user_high_id=hi and accepted_at is null and requester_id=p_user_id;
  elsif p_action='cancel' then
    delete from private.friendships where user_low_id=lo and user_high_id=hi and accepted_at is null and requester_id=uid;
  else
    delete from private.friendships where user_low_id=lo and user_high_id=hi and accepted_at is not null;
  end if;
  return jsonb_build_object('userId',p_user_id,'friendship',private.friendship_state(uid,p_user_id),
    'canRequestFriend',private.friendship_state(uid,p_user_id)='none' and private.friend_pair_ok(uid,p_user_id),
    'friendCount',private.friend_count(p_user_id));
end $$;

create function public.get_my_friends() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  return (select jsonb_build_object(
    'incoming',coalesce(jsonb_agg(x.item order by x.since desc) filter (where x.kind='incoming'),'[]'::jsonb),
    'outgoing',coalesce(jsonb_agg(x.item order by x.since desc) filter (where x.kind='outgoing'),'[]'::jsonb),
    'friends',coalesce(jsonb_agg(x.item order by x.since desc) filter (where x.kind='friends'),'[]'::jsonb))
  from (select case when f.accepted_at is not null then 'friends' when f.requester_id=uid then 'outgoing' else 'incoming' end kind,
      coalesce(f.accepted_at,f.created_at) since,
      jsonb_build_object('id',p.id,'nickname',p.nickname,'cityId',p.city_id,'neighborhood',p.neighborhood,'since',coalesce(f.accepted_at,f.created_at)) item
    from private.friendships f
    join public.profiles p on p.id=case when f.user_low_id=uid then f.user_high_id else f.user_low_id end
    where (f.user_low_id=uid or f.user_high_id=uid) and p.account_status='active'
      and not private.is_blocked_between(uid,p.id) and not private.has_reported(uid,'user',p.id)
    order by coalesce(f.accepted_at,f.created_at) desc limit 600) x);
end $$;

create function public.set_profile_sharing(p_saved_places_to_friends boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_saved_places_to_friends is null then raise exception 'INVALID_PROFILE_SHARING'; end if;
  perform private.assert_active_account(uid);
  insert into private.profile_sharing(user_id,saved_places_to_friends) values(uid,p_saved_places_to_friends)
    on conflict(user_id) do update set saved_places_to_friends=excluded.saved_places_to_friends,updated_at=clock_timestamp();
  return jsonb_build_object('savedPlacesToFriends',p_saved_places_to_friends);
end $$;

-- Real, active members who saved a business directly or through its linked map place.
create function private.merchant_savers(p_merchant uuid) returns table(user_id uuid,saved_at timestamptz)
language sql stable security definer set search_path='' as $$
  select x.user_id,max(x.saved_at) from (
    select sm.user_id,sm.created_at saved_at from private.saved_merchants sm where sm.merchant_id=p_merchant
    union all
    select s.user_id,s.created_at from private.webshop_place_links l
      join private.saved_places s on s.place_key=l.place_key and s.city_id=l.city_id where l.merchant_id=p_merchant
  ) x where private.is_active_account(x.user_id) and not private.is_operated_character(x.user_id)
  group by x.user_id
$$;

-- Who saved a business: a member count, plus the viewer's friends who share their saved places. A similar place needs
-- at least 3 members who saved both, so one person's saves never show through.
create function public.get_merchant_saves(p_merchant_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); v_city text; week_start timestamptz;
begin
  if p_merchant_id is null or public.get_merchant_profile(p_merchant_id) is null then return null; end if;
  -- A business that has not agreed to its Gling profile yet shows no saves.
  select m.city_id into v_city from private.merchants m where m.id=p_merchant_id and m.consent='granted';
  if v_city is null then return null; end if;
  week_start:=date_trunc('week',now() at time zone 'America/Vancouver') at time zone 'America/Vancouver';
  return jsonb_build_object('merchantId',p_merchant_id,
    'saverCount',(select count(*)::integer from private.merchant_savers(p_merchant_id)),
    'friends',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'nickname',f.nickname,'savedAt',f.saved_at) order by f.saved_at desc),'[]'::jsonb)
      from (select p.id,p.nickname,s.saved_at from private.merchant_savers(p_merchant_id) s
        join public.profiles p on p.id=s.user_id
        join private.profile_sharing ps on ps.user_id=s.user_id and ps.saved_places_to_friends
        where uid is not null and s.user_id<>uid and private.are_friends(uid,s.user_id) and private.friend_pair_ok(uid,s.user_id)
        order by s.saved_at desc limit 20) f),
    'similar',(select coalesce(jsonb_agg(jsonb_build_object('merchantId',o.merchant_id,'name',o.name,'saverCount',o.savers,'weekCount',o.week_count)
        order by o.together desc,o.savers desc,o.merchant_id),'[]'::jsonb)
      from (select co.merchant_id,m.name,co.together,
          (select count(*)::integer from private.merchant_savers(co.merchant_id)) savers,
          (select count(*)::integer from private.merchant_savers(co.merchant_id) w where w.saved_at>=week_start) week_count
        from (select x.merchant_id,count(distinct x.user_id) together from (
            select sm.user_id,sm.merchant_id from private.merchant_savers(p_merchant_id) s join private.saved_merchants sm on sm.user_id=s.user_id
            union all
            select s.user_id,l.merchant_id from private.merchant_savers(p_merchant_id) s join private.saved_places sp on sp.user_id=s.user_id
              join private.webshop_place_links l on l.place_key=sp.place_key and l.city_id=sp.city_id
          ) x where x.merchant_id<>p_merchant_id group by x.merchant_id having count(distinct x.user_id)>=3) co
        join private.merchants m on m.id=co.merchant_id and m.city_id=v_city and m.consent='granted'
        where public.get_merchant_profile(co.merchant_id) is not null
        order by co.together desc,savers desc,co.merchant_id limit 3) o));
end $$;

-- Blocking or reporting someone ends the friendship or the pending request.
create function private.end_friendship() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid; other uuid;
begin
  if tg_table_name='blocks' then actor:=new.blocker_id; other:=new.blocked_id;
  elsif new.target_type='user' then actor:=new.reporter_id; other:=new.target_id;
  else return null; end if;
  delete from private.friendships where user_low_id=least(actor,other) and user_high_id=greatest(actor,other);
  return null;
end $$;
create trigger blocks_end_friendship after insert on public.blocks for each row execute function private.end_friendship();
create trigger reports_end_friendship after insert on public.reports for each row execute function private.end_friendship();

-- Friend alerts use the bell and the existing 'direct_requests' setting (people asking to connect).
do $$
declare definition text; anchor constant text:='when ''message_reaction'' then ''messages''';
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
   where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
  if definition is null or definition not like 'CHECK (%' or definition like '%friend_request%' then raise exception 'FRIEND_NOTIFICATION_KIND_CHANGED'; end if;
  alter table public.notifications drop constraint notifications_kind_check;
  execute 'alter table public.notifications add constraint notifications_kind_check '||
    replace(definition,'CHECK (','CHECK (kind = ''friend_request'' or kind = ''friend_accepted'' or ');
  definition:=pg_get_functiondef('private.notification_category(text,text)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'FRIEND_NOTIFICATION_CATEGORY_CHANGED'; end if;
  execute replace(definition,anchor,'when ''friend_request'' then ''direct_requests'' when ''friend_accepted'' then ''direct_requests'' '||anchor);
end $$;

do $$ declare signature text; begin
 foreach signature in array array['private.are_friends(uuid,uuid)','private.friendship_state(uuid,uuid)','private.friend_pair_ok(uuid,uuid)',
  'private.friend_count(uuid)','private.profile_saved_places(uuid)','private.saved_week_streak(timestamp with time zone[],timestamp with time zone)',
  'private.merchant_savers(uuid)','private.end_friendship()','public.get_profile_overview(uuid)','public.set_friendship(uuid,text)',
  'public.get_my_friends()','public.set_profile_sharing(boolean)','public.get_merchant_saves(uuid)'] loop
  execute 'alter function '||signature||' owner to postgres';
  execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
 end loop;
end $$;
grant execute on function public.get_profile_overview(uuid),public.get_merchant_saves(uuid) to anon,authenticated;
grant execute on function public.set_friendship(uuid,text),public.get_my_friends(),public.set_profile_sharing(boolean) to authenticated;
notify pgrst,'reload schema';
