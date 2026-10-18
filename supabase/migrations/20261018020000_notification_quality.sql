-- Persist event identity because the short-lived provider cache cannot deduplicate seven days of history.
alter table public.notifications add column recommendation_key uuid;
create index notifications_recommendation_key_idx on public.notifications(user_id,recommendation_key,created_at desc)
  where recommendation_key is not null;

create function private.event_recommendation_key(p_city_id text,p_target_id uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare event record; details jsonb; venue text;
begin
  select e.*,c.timezone into event from private.ticketmaster_notification_events e
    join public.cities c on c.id=e.city_id where e.city_id=p_city_id and e.target_id=p_target_id;
  if not found then return p_target_id; end if;
  details:=private.cached_ticketmaster_event(event.city_id,event.event_id);
  venue:=nullif(lower(btrim(regexp_replace(regexp_replace(details->>'venue','<[^>]*>',' ','g'),'[[:space:][:cntrl:]]+',' ','g'))),'');
  if venue is null then return p_target_id; end if;
  return md5(jsonb_build_array(event.city_id,
    lower(btrim(regexp_replace(regexp_replace(event.name,'<[^>]*>',' ','g'),'[[:space:][:cntrl:]]+',' ','g'))),
    venue,(event.starts_at at time zone event.timezone)::date)::text)::uuid;
end;
$$;
alter function private.event_recommendation_key(text,uuid) owner to postgres;
revoke all on function private.event_recommendation_key(text,uuid) from public,anon,authenticated,service_role;

-- Recover keys only where the original source is still available; keep IDs, reads and delivery history.
update public.notifications n set recommendation_key=private.event_recommendation_key(e.city_id,e.target_id)
from private.ticketmaster_notification_events e where n.target_type='ticketmaster_event' and n.target_id=e.target_id
  and n.kind in ('trending_post','city_places') and n.created_at>now()-interval '7 days';

create function private.event_recommendation_body(p_user_id uuid,p_event jsonb,p_city_id text,p_existing_body text default null)
returns text language plpgsql security definer set search_path='' as $$
declare openings text[]:=array['행사 소식이에요.','일정을 살펴봐요.','이런 행사도 있어요.','외출 계획에 참고해요.'];
  previous text; chosen integer:=1; i integer; facts text;
begin
  facts:=private.festival_notification_body(p_event,p_city_id);
  if p_existing_body is not null then
    for i in 1..cardinality(openings) loop
      if starts_with(p_existing_body,openings[i]||' ') then chosen:=i; exit; end if;
    end loop;
  else
    select n.body into previous from public.notifications n
    where n.user_id=p_user_id and n.target_type='ticketmaster_event'
      and n.kind in ('trending_post','city_places')
      and n.created_at>now()-interval '7 days'
      and exists(select 1 from unnest(openings) intro where starts_with(n.body,intro||' '))
    order by n.created_at desc,n.id desc limit 1;
    for i in 1..cardinality(openings) loop
      if starts_with(previous,openings[i]||' ') then chosen:=mod(i,cardinality(openings))+1; exit; end if;
    end loop;
  end if;
  -- Facts take precedence over a decorative opening; never cut a word to fit an alert.
  if char_length(openings[chosen]||' '||facts)>90 then return facts; end if;
  return openings[chosen]||' '||facts;
end;
$$;
alter function private.event_recommendation_body(uuid,jsonb,text,text) owner to postgres;
revoke all on function private.event_recommendation_body(uuid,jsonb,text,text) from public,anon,authenticated,service_role;

do $quality$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('private.festival_notification_body(jsonb,text)'::regprocedure);
  anchor:='return btrim(intro)||'' 같이 갈 사람!?'';';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'EVENT_FACT_FORMATTER_CHANGED'; end if;
  execute replace(definition,anchor,'return btrim(intro);');

  definition:=pg_get_functiondef('private.stamp_festival_notification_content()'::regprocedure);
  anchor:='new.body:=private.festival_notification_body(details,event.city_id);';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'EVENT_STAMP_CHANGED'; end if;
  execute replace(definition,anchor,'new.body:=private.event_recommendation_body(new.user_id,details,event.city_id);');

  definition:=pg_get_functiondef('private.filter_notification()'::regprocedure);
  anchor:='  if new.kind in (''trending_post'',''city_food'',''city_places'') then';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'RECOMMENDATION_FILTER_CHANGED'; end if;
  definition:=replace(definition,anchor,$key$  if new.target_type='ticketmaster_event' and new.kind in ('trending_post','city_places') then
    perform pg_advisory_xact_lock(hashtextextended('recommendation:'||new.user_id::text,0));
    new.recommendation_key:=private.event_recommendation_key(new.city_id,new.target_id);
    if exists(select 1 from public.notifications n where n.user_id=new.user_id
      and n.recommendation_key=new.recommendation_key and n.created_at>new.created_at-interval '7 days') then return null; end if;
  end if;
$key$||anchor);
  definition:=replace(definition,'where n.user_id=new.user_id','where n.user_id=new.user_id and n.kind<>''trending_hashtag''');
  execute definition;

  -- Topics remain in the inbox, but do not interrupt a person or consume a push slot.
  definition:=pg_get_functiondef('private.push_notification_eligible(uuid,uuid)'::regprocedure);
  anchor:='and n.read_at is null';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'PUSH_ELIGIBILITY_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' and n.kind<>''trending_hashtag''');

  definition:=pg_get_functiondef('public.claim_push_notifications(text,integer)'::regprocedure);
  anchor:='then private.festival_notification_body(private.cached_ticketmaster_event(preview_event.city_id,preview_event.event_id),preview_event.city_id)';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'EVENT_CLAIM_CONTENT_CHANGED'; end if;
  definition:=replace(definition,anchor,'then private.event_recommendation_body(n.user_id,private.cached_ticketmaster_event(preview_event.city_id,preview_event.event_id),preview_event.city_id,n.body)');
  anchor:='        select t.* into cfg from private.trending_config t where t.id;';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'RECOMMENDATION_CLAIM_CHANGED'; end if;
  definition:=replace(definition,anchor,$duplicate$        if recommendation.target_type='ticketmaster_event' then
          -- Recover old queue/history identities when their previously unavailable source returns.
          update public.notifications n set recommendation_key=private.event_recommendation_key(e.city_id,e.target_id)
          from private.ticketmaster_notification_events e where n.user_id=recommendation.user_id
            and n.recommendation_key is null and n.target_type='ticketmaster_event' and n.target_id=e.target_id
            and n.kind in ('trending_post','city_places') and n.created_at>now()-interval '7 days';
          select n.recommendation_key into recommendation.recommendation_key from public.notifications n where n.id=recommendation.id;
        end if;
        if recommendation.recommendation_key is not null and exists (
          select 1 from public.notifications other join private.push_delivery_queue q on q.notification_id=other.id
          where other.user_id=recommendation.user_id and other.id<>recommendation.id
            and other.recommendation_key=recommendation.recommendation_key and q.first_attempt_at>now()-interval '7 days') then
          update private.push_delivery_queue q set status='cancelled',finished_at=now(),lease_id=null,lease_until=null,
            last_error='DUPLICATE_EVENT' where q.id=item.id;
          continue;
        end if;
$duplicate$||anchor);
  execute definition;
end;
$quality$;

create or replace function private.send_city_recommendations(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare cfg private.trending_config; city record; recipient record; pick record; total integer:=0; local_hour integer;
begin
  select * into cfg from private.trending_config where id;
  if not found or not cfg.enabled then return 0; end if;
  for city in select id,name from public.cities where is_open loop
    if not pg_try_advisory_xact_lock(hashtextextended('city-recommendation:'||city.id,0)) then continue; end if;
    for recipient in
      select r.id,prefs.*,private.recommendation_timezone(r.id) zone
      from public.profiles r join public.notification_preferences prefs on prefs.user_id=r.id
      join auth.users u on u.id=r.id
      where r.city_id=city.id and r.account_status='active' and prefs.push_enabled
        and coalesce(u.email,'') not like '%@seed.gling.invalid'
        and u.raw_app_meta_data->'review_access' is distinct from 'true'::jsonb
        and private.recommendation_time(p_now,private.recommendation_timezone(r.id))
    loop
      perform pg_advisory_xact_lock(hashtextextended('recommendation:'||recipient.id::text,0));
      if exists(select 1 from public.notifications n where n.user_id=recipient.id and n.kind<>'trending_hashtag'
        and (n.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby') or n.kind='trending_meetup')
        and n.created_at>p_now-interval '75 minutes' and n.created_at<=p_now) then continue; end if;
      if (select count(*) from public.notifications n where n.user_id=recipient.id and n.kind<>'trending_hashtag'
        and (n.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby') or n.kind='trending_meetup')
        and (n.created_at at time zone recipient.zone)::date=(p_now at time zone recipient.zone)::date)>=8 then continue; end if;
      local_hour:=extract(hour from p_now at time zone recipient.zone);
      with activity as (
        select v.post_id,v.user_id,v.created_at from public.post_views v where v.created_at between p_now-interval '4 hours' and p_now
        union all select r.post_id,r.user_id,r.created_at from public.post_reactions r where r.kind='like' and r.created_at between p_now-interval '4 hours' and p_now
        union all select c.post_id,c.author_id,c.created_at from public.comments c where c.deleted_at is null and c.created_at between p_now-interval '4 hours' and p_now
      ), real_activity as (
        select a.post_id,count(distinct a.user_id) filter(where a.created_at>p_now-interval '2 hours') recent,
          count(distinct a.user_id) filter(where a.created_at<=p_now-interval '2 hours') previous
        from activity a join auth.users u on u.id=a.user_id join public.profiles r on r.id=u.id and r.account_status='active'
        where coalesce(u.email,'') not like '%@seed.gling.invalid' and u.raw_app_meta_data->'review_access' is distinct from 'true'::jsonb
          and coalesce(u.raw_app_meta_data->>'role','')<>'admin' group by a.post_id
      ), posts as (
        select p.*,t.slug,private.city_recommendation_category('post',p.id) category,
          coalesce(a.recent,0)>=3 and coalesce(a.recent,0)>coalesce(a.previous,0) rising,
          recipient.interests and (p.tag_id=any(recipient.interest_tag_ids) or exists (
            select 1 from unnest(p.hashtags) h where lower(private.canonicalize_hashtag(h))=any(recipient.interest_hashtags))) interesting
        from public.posts p join public.tags t on t.id=p.tag_id join auth.users u on u.id=p.author_id
        left join real_activity a on a.post_id=p.id
        where p.city_id=city.id and p.status='published' and p.created_at between p_now-interval '48 hours' and p_now
          and (p.expires_at is null or p.expires_at>p_now) and private.is_active_account(p.author_id)
          and coalesce(u.email,'') not like '%@seed.gling.invalid' and u.raw_app_meta_data->'review_access' is distinct from 'true'::jsonb
      ), events as (
        select e.*,private.event_recommendation_key(e.city_id,e.target_id) event_key,
          (select count(distinct x.user_id) from private.ticketmaster_event_clicks x
            join auth.users u on u.id=x.user_id join public.profiles r on r.id=u.id and r.account_status='active'
            where x.target_id=e.target_id and x.created_at between p_now-interval '48 hours' and p_now
              and coalesce(u.email,'') not like '%@seed.gling.invalid'
              and u.raw_app_meta_data->'review_access' is distinct from 'true'::jsonb
              and coalesce(u.raw_app_meta_data->>'role','')<>'admin') members
        from private.ticketmaster_notification_events e where e.city_id=city.id and e.starts_at>p_now
      ), candidates as (
        select p.id target_id,'post'::text target_type,p.author_id,p.category,null::uuid event_key,
          left(p.title,80) body,'/post/'||p.id::text route,
          case when slug='festival' then 0 when rising then 1
            when category='city_food' and local_hour in (12,13) then 1
            when category='city_places' and local_hour>=16 then 1
            when category in ('city_food','city_places') then 2 else 3 end priority,
          -extract(epoch from p.created_at) sort_time
        from posts p where (rising or interesting or category in ('city_food','city_places')) and p.author_id<>recipient.id
          and coalesce((to_jsonb(recipient)->>p.category)::boolean,false)
        union all
        select e.target_id,'ticketmaster_event',null::uuid,'city_places',e.event_key,e.name,
          '/events/'||e.event_id||'?cityId='||e.city_id,
          case when is_festival and starts_at<=p_now+interval '3 days' then 0 when members>=3 then 1 else 3 end,
          extract(epoch from e.starts_at)
        from events e where recipient.city_places
          and ((is_festival and starts_at<=p_now+interval '14 days') or (members>=3 and starts_at<=p_now+interval '30 days'))
      )
      select c.* into pick from candidates c
      where private.notification_target_visible(recipient.id,c.target_type,c.target_id)
        and not exists(select 1 from public.notifications n where n.user_id=recipient.id
          and n.created_at>p_now-interval '7 days' and (n.target_id=c.target_id or (c.event_key is not null and n.recommendation_key=c.event_key))
          and (n.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','meetups','interests','nearby')))
      order by c.priority,c.sort_time,c.target_id limit 1;
      if not found then continue; end if;
      insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route,created_at)
      values(recipient.id,case pick.category when 'trending' then 'trending_post' else pick.category end,
        pick.author_id,pick.target_type,pick.target_id,pick.body,pick.route,p_now);
      if found then total:=total+1; end if;
    end loop;
  end loop;
  return total;
end;
$$;
revoke all on function private.send_city_recommendations(timestamptz) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
