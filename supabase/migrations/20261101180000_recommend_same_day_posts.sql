-- Owner 2026-11-01: "오늘 11월 1일인데 어제 페스티벌정보를 가라고 알람옴 ... 날짜 다지난 왜 보내".
-- A post titled "오늘 저녁 ... 핼러윈 불꽃놀이" (posted 10-31) was pushed again 11-01 09:00 because posts stayed eligible for 48 hours.
-- Recommendation pushes now only use posts made on the recipient's local day. Everything else is the live definition unchanged.
CREATE OR REPLACE FUNCTION private.send_city_recommendations(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
          and (p.created_at at time zone recipient.zone)::date=(p_now at time zone recipient.zone)::date
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
$function$;
revoke all on function private.send_city_recommendations(timestamptz) from public,anon,authenticated,service_role;
