-- Keep discovery local at creation, inbox reads and the existing queued-send check.
alter table public.notifications add column city_id text references public.cities(id);

create function private.notification_city_matches(n public.notifications)
returns boolean language sql stable security definer set search_path='' as $$
  select n.kind not in ('interest_post','nearby_meetup','trending_post','trending_hashtag',
    'trending_meetup','weekly_ranking','city_food','city_places') or exists (
    select 1 from public.profiles r where r.id=n.user_id and r.city_id=n.city_id
      and case n.target_type
        when 'post' then exists(select 1 from public.posts p where p.id=n.target_id and p.city_id=r.city_id)
        when 'ticketmaster_event' then exists(select 1 from private.ticketmaster_notification_events e
          where e.target_id=n.target_id and e.city_id=r.city_id)
        when 'tag' then n.kind='trending_hashtag' and n.target_id is not null
        else false end
  );
$$;
alter function private.notification_city_matches(public.notifications) owner to postgres;
revoke all on function private.notification_city_matches(public.notifications) from public,anon,authenticated,service_role;

create function private.can_read_notification(n public.notifications)
returns boolean language sql stable security definer set search_path='' as $$
  select private.can_read_notification(n.user_id,n.category,n.actor_id,n.target_type,n.target_id)
    and private.notification_city_matches(n);
$$;
alter function private.can_read_notification(public.notifications) owner to postgres;
revoke all on function private.can_read_notification(public.notifications) from public,anon,authenticated,service_role;
grant execute on function private.can_read_notification(public.notifications) to authenticated;

do $city$
declare definition text; anchor text; previous_path text:=current_setting('search_path');
begin
  -- Preserve newer cache expiry rules while rejecting a mismatched venue city.
  perform set_config('search_path','pg_catalog',true);
  definition:=pg_get_viewdef('private.ticketmaster_notification_events'::regclass,true);
  anchor:='(p.e ->> ''country''::text) = ''CA''::text';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_EVENT_VIEW_CHANGED'; end if;
  execute 'create or replace view private.ticketmaster_notification_events as '||replace(definition,anchor,
    anchor||$venue$ AND regexp_replace(lower(normalize(trim(p.e ->> 'city'),NFD)),U&'[\0300-\036f]','','g')=p.city_id$venue$);
  perform set_config('search_path',previous_path,true);

  definition:=pg_get_functiondef('private.notification_target_visible(uuid,text,uuid)'::regprocedure);
  anchor:='select case p_target_type';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_TOPIC_VISIBILITY_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$topic$
    when 'tag' then exists (
      select 1 from public.profiles r join public.posts p on p.city_id=r.city_id
      cross join lateral unnest(p.hashtags) h(hashtag)
      where r.id=p_user_id and p.status='published'
        and private.notification_target_visible(p_user_id,'post',p.id)
        and md5('trending-hashtag:'||r.city_id||':'||private.canonicalize_hashtag(h.hashtag))::uuid=p_target_id
    )$topic$);

  definition:=pg_get_functiondef('private.filter_notification()'::regprocedure);
  anchor:='  new.category := private.notification_category(new.kind, new.target_type);';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_NOTIFICATION_FILTER_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$stamp$
  if new.kind in ('interest_post','nearby_meetup','trending_post','trending_hashtag',
    'trending_meetup','weekly_ranking','city_food','city_places') then
    if new.target_type='post' then
      select p.city_id into new.city_id from public.posts p where p.id=new.target_id;
    elsif new.target_type='ticketmaster_event' then
      select e.city_id into new.city_id from private.ticketmaster_notification_events e where e.target_id=new.target_id;
    end if;
    if not private.notification_city_matches(new) then return null; end if;
  end if;$stamp$);

  definition:=pg_get_functiondef('private.push_notification_eligible(uuid,uuid)'::regprocedure);
  anchor:='and n.read_at is null';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_PUSH_ELIGIBILITY_CHANGED'; end if;
  execute replace(definition,anchor,anchor||E'\n      and private.notification_city_matches(n)');

  -- A tag without a post needs its producer's city, rather than guessing at send time.
  definition:=pg_get_functiondef('public.send_trending_topic_notifications()'::regprocedure);
  anchor:=E'insert into public.notifications(user_id, kind, actor_id, target_type, target_id, body, route)\n        select r.id, ''trending_hashtag''';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_HASHTAG_INSERT_CHANGED'; end if;
  definition:=replace(definition,anchor,replace(anchor,'body, route)','body, route, city_id)'));
  anchor:='select r.id, ''trending_hashtag'', null, ''tag'', null,';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_HASHTAG_TARGET_CHANGED'; end if;
  definition:=replace(definition,anchor,
    'select r.id, ''trending_hashtag'', null, ''tag'', md5(''trending-hashtag:''||city.city_id||'':''||hashtag.hashtag)::uuid,');
  anchor:='''/notifications''';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_HASHTAG_ROUTE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||', city.city_id');
end;
$city$;

-- Only known source cities are backfilled. Legacy unlinked tags remain private history.
update public.notifications n set city_id=p.city_id from public.posts p
where n.target_type='post' and n.target_id=p.id and n.kind in
 ('interest_post','nearby_meetup','trending_post','trending_hashtag','trending_meetup','weekly_ranking','city_food','city_places');
update public.notifications n set city_id=e.city_id from private.ticketmaster_notification_events e
where n.target_type='ticketmaster_event' and n.target_id=e.target_id and n.kind in ('trending_post','city_places');

alter policy "users read own notifications" on public.notifications
  using ((select private.is_admin()) or private.can_read_notification(notifications));
create or replace view public.user_notifications with (security_invoker=true) as
  select n.* from public.notifications n where private.can_read_notification(n);
notify pgrst,'reload schema';
