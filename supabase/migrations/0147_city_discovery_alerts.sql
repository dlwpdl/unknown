-- Split the existing city recommendations; keep prior opt-outs and the shared budget.
alter table public.notification_preferences
  add column city_food boolean not null default true,
  add column city_places boolean not null default true;
update public.notification_preferences set city_food=trending,city_places=trending;

create function private.city_recommendation_category(p_target_type text,p_target_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when p_target_type='ticketmaster_event' then 'city_places'
    when p_target_type='post' then coalesce((
      select case
        when t.slug='food' or (t.slug in ('life','business') and p.title||' '||p.body
          ~* '카페|레스토랑|맛집|식당|커피|베이커리|\m(caf[eé]s?|restaurants?|bakery|coffee)\M') then 'city_food'
        when t.slug in ('travel','festival') or (t.slug in ('life','business') and p.title||' '||p.body
          ~* '도서관|산책|뷰포인트|명소|공원|박물관|미술관|\m(library|park|museum|gallery|viewpoint)\M') then 'city_places'
        else 'trending' end
      from public.posts p join public.tags t on t.id=p.tag_id where p.id=p_target_id and p.status='published'
    ),'trending') else 'trending' end;
$$;
alter function private.city_recommendation_category(text,uuid) owner to postgres;
revoke all on function private.city_recommendation_category(text,uuid) from public,anon,authenticated,service_role;

do $$
declare definition text; anchor text; signature text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
  if definition is null then raise exception 'CITY_NOTIFICATION_KIND_CHECK_REQUIRED'; end if;
  alter table public.notifications drop constraint notifications_kind_check;
  execute 'alter table public.notifications add constraint notifications_kind_check check(kind in (''city_food'',''city_places'') or '
    ||substring(definition from 7)||')';
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.notifications'::regclass and conname='notifications_category_check';
  if definition is null then raise exception 'CITY_NOTIFICATION_CATEGORY_CHECK_REQUIRED'; end if;
  alter table public.notifications drop constraint notifications_category_check;
  execute 'alter table public.notifications add constraint notifications_category_check check(category in (''city_food'',''city_places'') or '
    ||substring(definition from 7)||')';

  definition:=pg_get_functiondef('public.get_notification_preferences()'::regprocedure);
  anchor:='"push_enabled":false';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_NOTIFICATION_DEFAULTS_CHANGED'; end if;
  execute replace(definition,anchor,anchor||',"city_food":true,"city_places":true');
  definition:=pg_get_functiondef('public.update_notification_preferences(jsonb)'::regprocedure);
  anchor:='''merchant_reviews'',''push_enabled''';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_NOTIFICATION_ALLOWLIST_CHANGED'; end if;
  definition:=replace(definition,anchor,'''merchant_reviews'',''city_food'',''city_places'',''push_enabled''');
  anchor:='merchant_reviews = coalesce((p_preferences->>''merchant_reviews'')::boolean, p.merchant_reviews),';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_NOTIFICATION_UPDATE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||E'\n    city_food = coalesce((p_preferences->>''city_food'')::boolean, p.city_food),'
    ||E'\n    city_places = coalesce((p_preferences->>''city_places'')::boolean, p.city_places),');
  definition:=pg_get_functiondef('private.can_receive_notification(uuid,text,uuid)'::regprocedure);
  anchor:='p_category in (';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_NOTIFICATION_GATE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||'''city_food'',''city_places'',');
  definition:=pg_get_functiondef('private.notification_category(text,text)'::regprocedure);
  anchor:='case p_kind';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_NOTIFICATION_MAP_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' when ''city_food'' then ''city_food'' when ''city_places'' then ''city_places''');

  -- Current preferences, city and content still win for alerts queued before this release.
  definition:=pg_get_functiondef('private.push_notification_eligible(uuid,uuid)'::regprocedure);
  anchor:='and n.read_at is null';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_PUSH_ELIGIBILITY_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$gate$
      and (n.kind not in ('trending_post','city_food','city_places') or (
        coalesce((to_jsonb(preferences)->>private.city_recommendation_category(n.target_type,n.target_id))::boolean,false)
        and (n.category not in ('city_food','city_places') or n.category=private.city_recommendation_category(n.target_type,n.target_id))
        and (n.target_type<>'post' or exists (
          select 1 from public.posts p join public.profiles r on r.id=n.user_id and r.city_id=p.city_id where p.id=n.target_id
        ))
      ))$gate$);

  definition:=pg_get_functiondef('private.send_city_recommendations(timestamptz)'::regprocedure);
  anchor:=$fresh$p.created_at>p_now-interval '2 hours' and (t.slug in ('food','travel','festival')
            or (t.slug='life' and p.title||' '||p.body ~* '카페|도서관|산책|뷰포인트|명소|cafe|library|restaurant')) fresh_discovery,
          t.slug$fresh$;
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_RECOMMENDATION_CLASSIFICATION_CHANGED'; end if;
  definition:=replace(definition,anchor,$fresh$p.created_at>p_now-interval '2 hours' and private.city_recommendation_category('post',p.id)<>'trending' fresh_discovery,
          t.slug,private.city_recommendation_category('post',p.id) recommendation_category$fresh$);
  anchor:='select p.id target_id,''post''::text target_type,p.author_id,';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_RECOMMENDATION_POST_CHANGED'; end if;
  definition:=replace(definition,anchor,anchor||'p.recommendation_category category,');
  anchor:='select e.target_id,''ticketmaster_event'',null::uuid,';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_RECOMMENDATION_EVENT_CHANGED'; end if;
  definition:=replace(definition,anchor,anchor||'''city_places'',');
  anchor:='(case when rising then';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_RECOMMENDATION_BODY_CHANGED'; end if;
  definition:=replace(definition,anchor,$body$(case when recommendation_category='city_food' then
          case when fresh_discovery then '새로 올라온 맛집·레스토랑 · '
            when rising then '요즘 관심이 높아진 맛집·레스토랑 · '
            else '오늘 '||city.name||' 맛집·레스토랑 · ' end
          when rising then$body$);
  anchor:='select r.id,''trending_post'',pick.author_id';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_RECOMMENDATION_INSERT_CHANGED'; end if;
  definition:=replace(definition,anchor,'select r.id,case pick.category when ''trending'' then ''trending_post'' else pick.category end,pick.author_id');
  anchor:='prefs.push_enabled and prefs.trending';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'CITY_RECOMMENDATION_PREFERENCES_CHANGED'; end if;
  definition:=replace(definition,anchor,'prefs.push_enabled and coalesce((to_jsonb(prefs)->>pick.category)::boolean,false)');
  execute definition;

  -- Keep the same locks, limits, quiet hours and retry code for every recommendation type.
  foreach signature in array array['private.send_city_recommendations(timestamptz)',
    'private.enqueue_push_notification()','public.claim_push_notifications(text,integer)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    anchor:='n.category=''trending''';
    if position(anchor in definition)=0 then raise exception 'CITY_RECOMMENDATION_BUDGET_CHANGED: %',signature; end if;
    definition:=replace(definition,anchor,'n.category in (''trending'',''city_food'',''city_places'')');
    definition:=replace(definition,'new.category=''trending''','new.category in (''trending'',''city_food'',''city_places'')');
    definition:=replace(definition,'recommendation.category=''trending''','recommendation.category in (''trending'',''city_food'',''city_places'')');
    definition:=replace(definition,'''trending'',''meetups'',''interests'',''nearby''','''trending'',''city_food'',''city_places'',''meetups'',''interests'',''nearby''');
    execute definition;
  end loop;
end;
$$;
notify pgrst,'reload schema';
