-- Two alerts (owner 2026-11-13): a friend saved a place, and Friday's "이번 주말 갈 만한 곳". Both ship switched off
-- (owner "일단 구축은해놓고 액티베이트 시켜야만 되게"): nothing is written or pushed until someone runs, in production,
--   update private.notification_switches set friend_saves=true,updated_at=now();   -- 친구가 저장한 곳
--   update private.notification_switches set weekend_picks=true,updated_at=now();  -- 금요일 주말 갈 만한 곳
-- Members turn each one off in 알림 설정 (friend_saves, weekend_picks); the rows stay hidden there while a switch is off.
create table private.notification_switches(
  id boolean primary key default true check(id),
  friend_saves boolean not null default false,
  weekend_picks boolean not null default false,
  updated_at timestamptz not null default now());
insert into private.notification_switches(id) values(true);
alter table private.notification_switches enable row level security;
alter table private.notification_switches owner to postgres;
revoke all on private.notification_switches from public,anon,authenticated,service_role;

alter table public.notification_preferences add column friend_saves boolean not null default true,
  add column weekend_picks boolean not null default true;

-- Same anchored edits as 20261105030000_live_bubbles: each anchor must occur exactly once, so a changed definition stops here.
do $$
declare definition text; item record;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
  if definition is null or definition not like 'CHECK (%' or definition like '%friend_saved_place%' then raise exception 'FRIEND_SAVE_KIND_CHANGED'; end if;
  alter table public.notifications drop constraint notifications_kind_check;
  execute 'alter table public.notifications add constraint notifications_kind_check '||
    replace(definition,'CHECK (','CHECK (kind = ''friend_saved_place'' or kind = ''weekend_picks'' or ');
  select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_category_check';
  if definition is null or definition not like 'CHECK (%' or definition like '%friend_saves%' then raise exception 'FRIEND_SAVE_CATEGORY_CHANGED'; end if;
  alter table public.notifications drop constraint notifications_category_check;
  execute 'alter table public.notifications add constraint notifications_category_check '||
    replace(definition,'CHECK (','CHECK (category = ''friend_saves'' or category = ''weekend_picks'' or ');
  for item in select * from (values
    ('private.notification_category(text,text)',$a$when 'message_reaction' then 'messages'$a$,
      $r$when 'friend_saved_place' then 'friend_saves' when 'weekend_picks' then 'weekend_picks' when 'message_reaction' then 'messages'$r$),
    ('private.can_receive_notification(uuid,text,uuid)',$a$p_category in ('merchant_updates',$a$,$r$p_category in ('friend_saves','weekend_picks','merchant_updates',$r$),
    ('public.get_notification_preferences()',$a$"push_muted":[]}'::jsonb$a$,$r$"friend_saves":true,"weekend_picks":true,"push_muted":[]}'::jsonb$r$),
    -- switched_on lets the app show the two settings rows only once a switch is on.
    ('public.get_notification_preferences()',$a$return coalesce($a$,$r$return coalesce((select jsonb_build_object('switched_on',to_jsonb(array_remove(array[
      case when s.friend_saves then 'friend_saves' end,case when s.weekend_picks then 'weekend_picks' end],null)))
      from private.notification_switches s where s.id),'{}'::jsonb) || coalesce($r$),
    ('public.update_notification_preferences(jsonb)',$a$if entry.key in ('post_likes',$a$,$r$if entry.key in ('friend_saves','weekend_picks','post_likes',$r$),
    ('public.update_notification_preferences(jsonb)',$a$where value in ('post_likes',$a$,$r$where value in ('friend_saves','weekend_picks','post_likes',$r$),
    ('public.update_notification_preferences(jsonb)',$a$push_muted = coalesce(muted, p.push_muted)$a$,
      $r$friend_saves = coalesce((p_preferences->>'friend_saves')::boolean, p.friend_saves),
    weekend_picks = coalesce((p_preferences->>'weekend_picks')::boolean, p.weekend_picks),
    push_muted = coalesce(muted, p.push_muted)$r$)
  ) v(signature,anchor,replacement) loop
    definition:=pg_get_functiondef(item.signature::regprocedure);
    if array_length(string_to_array(definition,item.anchor),1)<>2 then raise exception 'FRIEND_SAVE_ALERTS_CHANGED %',item.signature; end if;
    execute replace(definition,item.anchor,item.replacement);
  end loop;
end $$;

-- Shown names are capped so the body stays one line; tags and control characters never reach a push.
create function private.alert_name(p_name text) returns text
language sql immutable set search_path='' as $$
  select case when char_length(n)>40 then left(n,39)||'…' else nullif(n,'') end
  from (select btrim(regexp_replace(regexp_replace(coalesce(p_name,''),'<[^>]*>',' ','g'),'[[:space:][:cntrl:]]+',' ','g')) n) x
$$;

-- A new place or business save tells each friend who may see it (private.get_friend_saved_places rules, map places only).
-- One row per friend per 24 hours: later saves rewrite that row as a count and mark it unread, with no second push.
-- Unsaving leaves the row alone (owner: 저장을 바로 풀면 굳이 지우지 않아도 돼요).
create function private.notify_friends_of_save() returns trigger
language plpgsql security definer set search_path='' as $$
declare saver uuid:=new.user_id; ref jsonb; v_city text; v_key text; place text; nickname text; total integer; friend uuid; row_id uuid;
begin
  if not coalesce((select s.friend_saves from private.notification_switches s where s.id),false)
    or not coalesce((select ps.saved_places_to_friends from private.profile_sharing ps where ps.user_id=saver),true) then return null; end if;
  -- Already saved through its other alias (set_saved_merchant_notifications re-inserts a business saved through its place).
  if tg_table_name='saved_places' then
    if exists(select 1 from private.webshop_place_links l join private.saved_merchants sm on sm.merchant_id=l.merchant_id and sm.user_id=saver
      where l.place_key=new.place_key and l.city_id=new.city_id) then return null; end if;
    select p.city_id,p.place_key into v_city,v_key from private.profile_saved_places(saver) p where p.city_id=new.city_id and p.place_key=new.place_key limit 1;
    ref:=private.saved_ref('place',new.place_key,new.city_id);
  else
    if exists(select 1 from private.webshop_place_links l join private.saved_places s on s.place_key=l.place_key and s.city_id=l.city_id and s.user_id=saver
      where l.merchant_id=new.merchant_id) then return null; end if;
    select p.city_id,p.place_key into v_city,v_key from private.profile_saved_places(saver) p where p.merchant_id=new.merchant_id limit 1;
    ref:=private.saved_ref('merchant',new.merchant_id::text,null);
  end if;
  if v_key is null then return null; end if;
  -- The business name when it has a page, else the map place's own name.
  place:=private.alert_name(coalesce(private.saved_card(ref)->>'title',private.saved_place_info(v_city,v_key)->>'name'));
  if place is null then return null; end if;
  select pr.nickname::text into nickname from public.profiles pr where pr.id=saver;
  nickname:=coalesce(nickname,'이웃');
  perform pg_advisory_xact_lock(hashtextextended('friend-save:'||saver::text,0));
  select count(*)::integer into total from private.profile_saved_places(saver) p where p.place_key is not null and p.saved_at>now()-interval '1 day';
  for friend in select case when f.user_low_id=saver then f.user_high_id else f.user_low_id end from private.friendships f
    where f.accepted_at is not null and (f.user_low_id=saver or f.user_high_id=saver) loop
    continue when not private.friend_pair_ok(saver,friend);
    select n.id into row_id from public.notifications n where n.user_id=friend and n.actor_id=saver and n.kind='friend_saved_place'
      and n.created_at>now()-interval '1 day' order by n.created_at desc limit 1;
    if row_id is null then
      -- English copy: friend_saved_place in src/lib/notification-copy.ts.
      perform private.create_notification(friend,'friend_saved_place',saver,'user',saver,
        nickname||'님이 ‘'||place||'’ 저장했어요.','/places/'||v_key||'?cityId='||v_city);
    elsif total>=2 then
      update public.notifications set body=nickname||'님이 장소 '||total||'곳을 저장했어요.',route='/user/'||saver::text,read_at=null
        where id=row_id and body<>nickname||'님이 장소 '||total||'곳을 저장했어요.';
    end if;
  end loop;
  return null;
end $$;
create trigger saved_places_notify_friends after insert on private.saved_places for each row execute function private.notify_friends_of_save();
create trigger saved_merchants_notify_friends after insert on private.saved_merchants for each row execute function private.notify_friends_of_save();

-- Friday 11:00–13:59 in each open city's own time zone, one row per member per week: 2–3 names from this weekend's
-- events, places 3+ members saved in the last 7 days (get_city_place_saves' 뜨는 중), then that week's TOP 50 rotation.
-- The row points at the member (target 'user') so the usual push checks pass; it opens the first named place or event.
create function private.send_weekend_picks(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare city record; local_now timestamp; names text[]; first_route text; v_body text; sent integer:=0; added integer;
begin
  if not coalesce((select s.weekend_picks from private.notification_switches s where s.id),false) then return 0; end if;
  for city in select c.id,c.timezone from public.cities c where c.is_open and c.timezone is not null loop
    local_now:=p_now at time zone city.timezone;
    continue when extract(isodow from local_now)<>5 or extract(hour from local_now) not between 11 and 13
      or not pg_try_advisory_xact_lock(hashtextextended('weekend-picks:'||city.id,0));
    with events as (
      select private.alert_name(e.name) name,'/events/'||e.event_id||'?cityId='||e.city_id route,1 tier,row_number() over(order by e.is_festival desc,e.starts_at,e.event_id) n
      from private.ticketmaster_notification_events e
      where e.city_id=city.id and e.starts_at between p_now and ((local_now::date+3)::timestamp at time zone city.timezone)
    ), saves as (
      select s.place_key,s.user_id from private.saved_places s where s.city_id=city.id and s.created_at between p_now-interval '7 days' and p_now
      union all
      select l.place_key,sm.user_id from private.webshop_place_links l join private.saved_merchants sm on sm.merchant_id=l.merchant_id
      where l.city_id=city.id and sm.created_at between p_now-interval '7 days' and p_now
    ), trending as (
      select x.place_key,row_number() over(order by count(distinct x.user_id) desc,x.place_key) n from saves x
      where private.is_active_account(x.user_id) and not private.is_operated_character(x.user_id)
      group by x.place_key having count(distinct x.user_id)>=3
    ), top50 as (
      select r->>'placeId' place_key,row_number() over(order by md5((r->>'placeId')||to_char(local_now,'IYYY-IW'))) n
      from private.city_place_catalog c cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload->'cities'->city.id->'recommendations')='array'
        then c.payload->'cities'->city.id->'recommendations' else '[]'::jsonb end) r
      where c.id and jsonb_typeof(r->'placeId')='string'
    ), picks as (
      select name,route,tier,n from events where n<=1
      union all
      select private.alert_name(private.saved_card(private.saved_ref('place',p.place_key,city.id))->>'title'),'/places/'||p.place_key||'?cityId='||city.id,p.tier,p.n
      from (select place_key,2 tier,n from trending where n<=3 union all select place_key,3,n from top50 where n<=6) p
    ), shown as (
      select distinct on (lower(name)) name,route,tier,n from picks where name is not null order by lower(name),tier,n
    )
    select array_agg(name order by tier,n),(array_agg(route order by tier,n))[1] into names,first_route
    from (select * from shown order by tier,n limit 3) x;
    continue when coalesce(cardinality(names),0)<2;
    -- English copy: weekend_picks in src/lib/notification-copy.ts.
    v_body:='이번 주말 갈 만한 곳 골라 뒀어요. '||array_to_string(names,', ');
    insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route,created_at)
    select r.id,'weekend_picks',null,'user',r.id,v_body,first_route,p_now
    from public.profiles r join auth.users u on u.id=r.id
    where r.city_id=city.id and r.account_status='active' and not private.is_operated_character(r.id)
      and u.raw_app_meta_data->'review_access' is distinct from 'true'::jsonb
      and not exists(select 1 from public.notifications n where n.user_id=r.id and n.kind='weekend_picks' and n.created_at>p_now-interval '6 days');
    get diagnostics added=row_count;
    sent:=sent+added;
  end loop;
  return sent;
end $$;

do $$ declare signature text; begin
 foreach signature in array array['private.alert_name(text)','private.notify_friends_of_save()','private.send_weekend_picks(timestamp with time zone)'] loop
  execute 'alter function '||signature||' owner to postgres';
  execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
 end loop;
end $$;

-- Hourly like the newcomer nudges: each city's own clock decides, so DST needs no schedule change.
select cron.unschedule(jobid) from cron.job where jobname='gling-weekend-picks';
select cron.schedule('gling-weekend-picks','5 * * * *',$job$ select private.send_weekend_picks(); $job$);
notify pgrst,'reload schema';
