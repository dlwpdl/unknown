-- Notification overhaul (owner 2026-10-26; contract in the client/server handoff).
-- Full definitions below are built from the effective text after 20261026080000. The guard stops the
-- migration instead of silently overwriting a function that production changed outside this chain.
do $$
declare item record;
begin
 for item in select * from (values
  ('private.notification_category(text,text)','c1f0b28f6f011b64c1de1153e574369f'),
  ('private.can_receive_notification(uuid,text,uuid)','1b7ab3526a70e7727f1dbea2250eb1e4'),
  ('public.get_notification_preferences()','5bba63417f95ca11a1ad869557c0d2d7'),
  ('public.update_notification_preferences(jsonb)','abc617daa92047d5fa983a9b7201b777'),
  ('private.push_notification_eligible(uuid,uuid)','7d02e9ac3cc1f7fe1ef48336ffff6dd4'),
  ('private.enqueue_push_notification()','bc4307c8866f143956410d4c17fb8a9a'),
  ('public.claim_push_notifications(text,integer)','5ef2ffa92a467a33a66b6d7c2866b9f0'),
  ('public.set_message_reaction(uuid,boolean)','3745d687389350a35d559996903f959c'),
  ('public.send_trending_topic_notifications()','b826b84d42d852444667a0b1a292eea0')) v(signature,expected) loop
  if (select md5(prosrc) from pg_proc where oid=item.signature::regprocedure) is distinct from item.expected then
   raise exception 'NOTIFICATION_OVERHAUL_DRIFT %',item.signature;
  end if;
 end loop;
end $$;

-- 1. Per-category push mute: the in-app row stays, only the push is skipped.
alter table public.notification_preferences add column push_muted text[] not null default '{}'
  check (cardinality(push_muted) <= 40);
-- 2. Account security notices can no longer be turned off.
update public.notification_preferences set account_security = true where not account_security;
-- 3. Device language for push copy ('ko' when unknown, as before).
alter table private.push_devices add column locale text check (locale in ('ko','en'));

do $$
declare definition text;
begin
 select pg_get_constraintdef(oid) into definition from pg_constraint
  where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
 if definition is null or definition not like 'CHECK (%' or definition not like '%admin_persona_contact%' then raise exception 'NOTIFICATION_OVERHAUL_KIND_CHANGED'; end if;
 alter table public.notifications drop constraint notifications_kind_check;
 execute 'alter table public.notifications add constraint notifications_kind_check '||
  replace(definition,'CHECK (','CHECK (kind = ''like_summary'' or kind = ''admin_digest'' or ');
end $$;

-- The hourly like summary scans only the last day of likes.
create index notifications_like_recent_idx on public.notifications(created_at) where kind in ('post_like','comment_like');

CREATE OR REPLACE FUNCTION private.notification_category(p_kind text, p_target_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_kind when 'meetup_review_request' then 'meetups' when 'saved_merchant_post' then 'merchant_updates' when 'merchant_review_received' then 'merchant_reviews' when 'merchant_operation' then 'merchant_operations' when 'meetup_morning' then 'meetups' when 'meetup_changed' then 'meetups' when 'meetup_cancelled' then 'meetups' when 'saved_merchant_post' then 'merchant_updates' when 'merchant_review_received' then 'merchant_reviews' when 'merchant_operation' then 'merchant_operations' when 'account_security' then 'account_security' when 'city_food' then 'city_food' when 'city_places' then 'city_places' when 'merchant_review_verified' then 'merchant_reviews' when 'merchant_review_rejected' then 'merchant_reviews' when 'merchant_review_reply' then 'merchant_reviews'
    when 'post_like' then 'post_likes' when 'comment_like' then 'comment_likes'
    when 'like_summary' then case when p_target_type = 'comment' then 'comment_likes' else 'post_likes' end
    when 'comment' then 'replies' when 'reply' then 'replies'
    when 'message' then case when p_target_type = 'user' then 'direct_requests' else 'messages' end
    when 'message_reaction' then 'messages'
    when 'meetup_reminder' then 'meetups' when 'meetup_request' then 'meetups' when 'meetup_approved' then 'meetups' when 'meetup_rejected' then 'meetups'
    when 'interest_post' then 'interests' when 'nearby_meetup' then 'nearby'
    when 'trending_post' then 'trending' when 'weekly_ranking' then 'weekly_ranking'
    when 'trending_hashtag' then 'trending' when 'trending_meetup' then 'meetups'
    else 'system' end;
$function$;

CREATE OR REPLACE FUNCTION private.can_receive_notification(p_user_id uuid, p_category text, p_actor_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_user_id is not null and (
    p_category = 'system' or (
      p_category in ('merchant_updates','merchant_operations','account_security','city_food','city_places','merchant_reviews','post_likes','comment_likes','replies','direct_requests','messages','meetups','interests','nearby','trending','weekly_ranking')
      and private.is_active_account(p_user_id)
      and (p_actor_id is null or (p_actor_id <> p_user_id and private.is_active_account(p_actor_id)
        and not private.is_blocked_between(p_user_id, p_actor_id)))
      and (p_category = 'account_security' or coalesce((select (to_jsonb(p)->>p_category)::boolean from public.notification_preferences p where user_id = p_user_id),
        p_category not in ('interests','nearby')))
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_notification_preferences()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return coalesce((select (to_jsonb(p) - 'user_id') || '{"account_security":true}'::jsonb from public.notification_preferences p where user_id = auth.uid()),
    '{"post_likes":true,"comment_likes":true,"replies":true,"direct_requests":true,"messages":true,"meetups":true,"interests":false,"nearby":false,"trending":true,"push_enabled":false,"merchant_updates":true,"merchant_operations":true,"account_security":true,"city_food":true,"city_places":true,"merchant_reviews":true,"message_preview":false,"interest_tag_ids":[],"interest_hashtags":[],"push_muted":[]}'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_notification_preferences(p_preferences jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  entry record;
  tags integer[];
  hashtags text[];
  muted text[];
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then raise exception 'INVALID_PREFERENCES'; end if;
  for entry in select * from jsonb_each(p_preferences) loop
    if entry.key in ('post_likes','comment_likes','replies','direct_requests','messages','meetups','interests','nearby','trending','weekly_ranking','merchant_reviews','city_food','city_places','merchant_updates','merchant_operations','account_security','push_enabled','message_preview') then
      if jsonb_typeof(entry.value) <> 'boolean' then raise exception 'INVALID_PREFERENCES'; end if;
    elsif entry.key = 'push_muted' then
      if jsonb_typeof(entry.value) <> 'array' or jsonb_array_length(entry.value) > 40
        or exists (select 1 from jsonb_array_elements(entry.value) v where jsonb_typeof(v) <> 'string') then raise exception 'INVALID_PREFERENCES'; end if;
    elsif entry.key in ('interest_tag_ids','interest_hashtags') then
      if jsonb_typeof(entry.value) <> 'array' then raise exception 'INVALID_PREFERENCES'; end if;
      if jsonb_array_length(entry.value) > 30 then raise exception 'INVALID_PREFERENCES'; end if;
      if entry.key = 'interest_hashtags' and jsonb_array_length(entry.value) > 20 then raise exception 'INVALID_PREFERENCES'; end if;
    else raise exception 'INVALID_PREFERENCES';
    end if;
  end loop;
  if p_preferences ? 'interest_tag_ids' then
    if exists (select 1 from jsonb_array_elements(p_preferences->'interest_tag_ids') v
      where jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]{1,5}$') then raise exception 'INVALID_INTEREST_TAGS'; end if;
    select coalesce(array_agg(distinct value::integer order by value::integer), '{}') into tags
      from jsonb_array_elements_text(p_preferences->'interest_tag_ids');
    if exists (select 1 from unnest(tags) requested(tag_id) where not exists (select 1 from public.tags t where t.id = requested.tag_id)) then
      raise exception 'INVALID_INTEREST_TAGS';
    end if;
  end if;
  if p_preferences ? 'interest_hashtags' then
    if exists (select 1 from jsonb_array_elements(p_preferences->'interest_hashtags') v
      where jsonb_typeof(v) <> 'string') then raise exception 'INVALID_INTEREST_HASHTAGS'; end if;
    if exists (select 1 from jsonb_array_elements_text(p_preferences->'interest_hashtags')
      where char_length(coalesce(private.canonicalize_hashtag(value), '')) not between 1 and 50) then
      raise exception 'INVALID_INTEREST_HASHTAGS';
    end if;
    select coalesce(array_agg(distinct lower(private.canonicalize_hashtag(value)) order by lower(private.canonicalize_hashtag(value))), '{}')
      into hashtags from jsonb_array_elements_text(p_preferences->'interest_hashtags');
  end if;
  if p_preferences ? 'push_muted' then
    -- Unknown categories (newer or older clients) and account security are dropped, not rejected.
    select coalesce(array_agg(distinct value order by value), '{}') into muted
      from jsonb_array_elements_text(p_preferences->'push_muted')
      where value in ('post_likes','comment_likes','replies','direct_requests','messages','meetups','interests','nearby','trending','weekly_ranking','merchant_reviews','city_food','city_places','merchant_updates','merchant_operations');
  end if;
  insert into public.notification_preferences (user_id) values (auth.uid()) on conflict do nothing;
  update public.notification_preferences p set
    post_likes = coalesce((p_preferences->>'post_likes')::boolean, p.post_likes),
    comment_likes = coalesce((p_preferences->>'comment_likes')::boolean, p.comment_likes),
    replies = coalesce((p_preferences->>'replies')::boolean, p.replies),
    direct_requests = coalesce((p_preferences->>'direct_requests')::boolean, p.direct_requests),
    messages = coalesce((p_preferences->>'messages')::boolean, p.messages),
    meetups = coalesce((p_preferences->>'meetups')::boolean, p.meetups),
    interests = coalesce((p_preferences->>'interests')::boolean, p.interests),
    nearby = coalesce((p_preferences->>'nearby')::boolean, p.nearby),
    trending = coalesce((p_preferences->>'trending')::boolean, p.trending),
    weekly_ranking = coalesce((p_preferences->>'weekly_ranking')::boolean, p.weekly_ranking),
    merchant_reviews = coalesce((p_preferences->>'merchant_reviews')::boolean, p.merchant_reviews),
    merchant_updates = coalesce((p_preferences->>'merchant_updates')::boolean, p.merchant_updates),
    merchant_operations = coalesce((p_preferences->>'merchant_operations')::boolean, p.merchant_operations),
    account_security = true,
    city_food = coalesce((p_preferences->>'city_food')::boolean, p.city_food),
    city_places = coalesce((p_preferences->>'city_places')::boolean, p.city_places),
    push_enabled = coalesce((p_preferences->>'push_enabled')::boolean, p.push_enabled),
    message_preview = coalesce((p_preferences->>'message_preview')::boolean, p.message_preview),
    interest_tag_ids = coalesce(tags, p.interest_tag_ids), interest_hashtags = coalesce(hashtags, p.interest_hashtags),
    push_muted = coalesce(muted, p.push_muted)
  where user_id = auth.uid();
  return public.get_notification_preferences();
end;
$function$;

CREATE OR REPLACE FUNCTION private.push_notification_eligible(p_device_id uuid, p_notification_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from private.push_devices d
    join auth.sessions s on s.id = d.session_id and s.user_id = d.user_id
      and (s.not_after is null or s.not_after > now())
    join public.notification_preferences preferences on preferences.user_id = d.user_id and preferences.push_enabled
    join public.notifications n on n.id = p_notification_id and n.user_id = d.user_id
    where d.id = p_device_id and d.disabled_at is null and private.is_active_account(d.user_id)
      and n.read_at is null
      and (n.category = 'account_security' or not n.category = any(preferences.push_muted))
      and (n.kind<>'admin_persona_contact' or private.admin_persona_contact_visible(n.user_id,n.target_type,n.target_id,n.created_at)) and (n.target_type<>'message' or not private.is_business_message(n.target_id) or private.business_chat_notification_visible(n)) and n.kind<>'trending_hashtag'
      and (n.kind<>'admin_meetup_request' or (n.target_type='meetup_request' and private.admin_meetup_alert_visible(n.user_id,n.target_id,n.created_at)))
      and private.notification_city_matches(n)
    and (n.kind<>'saved_merchant_post' or private.saved_merchant_post_visible(n.user_id,n.target_id))
    and (n.kind<>'merchant_review_received' or private.merchant_review_owner_visible(n.user_id,n.target_id))
      and (n.kind not in ('trending_post','city_food','city_places') or (
        coalesce((to_jsonb(preferences)->>private.city_recommendation_category(n.target_type,n.target_id))::boolean,false)
        and (n.category not in ('city_food','city_places') or n.category=private.city_recommendation_category(n.target_type,n.target_id))
        and (n.target_type<>'post' or exists (
          select 1 from public.posts p join public.profiles r on r.id=n.user_id and r.city_id=p.city_id where p.id=n.target_id
        ))
      ))
      and (n.category <> 'messages' or (n.kind='message' and n.target_type='message' and exists (
        select 1 from public.messages m where m.id=n.target_id and (m.sender_id=n.actor_id or (private.is_business_chat(m.conversation_id) and m.sender_business_id=n.actor_business_id and n.actor_id is null)) and m.hidden_at is null
      )))
      and private.can_receive_notification(n.user_id, n.category, n.actor_id)
      and (n.category = 'system' or private.notification_target_visible(n.user_id, n.target_type, n.target_id))
  );
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_push_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare recommendation boolean:=new.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby') or new.kind='trending_meetup';
  conversation uuid;
begin
  -- admin_signup/admin_meetup_request reach admins through the twice-daily admin_digest push.
  if new.kind in ('meetup_morning','admin_signup','admin_meetup_request') then return new; end if;
  -- One like push per target per day; the rest roll into the evening like_summary.
  if new.kind in ('post_like','comment_like') and exists(select 1 from public.notifications o
    join private.push_delivery_queue q on q.notification_id=o.id
    where o.user_id=new.user_id and o.id<>new.id and o.target_type=new.target_type and o.target_id=new.target_id
      and o.kind in ('post_like','comment_like','like_summary') and o.created_at>new.created_at-interval '24 hours') then return new; end if;
  -- A chat burst pushes once a minute per conversation; the in-app row is still created.
  if new.kind='message' and new.target_type='message' then
    select m.conversation_id into conversation from public.messages m where m.id=new.target_id;
    if exists(select 1 from public.notifications o join public.messages om on om.id=o.target_id
      join private.push_delivery_queue q on q.notification_id=o.id
      where o.user_id=new.user_id and o.id<>new.id and o.kind='message' and o.target_type='message'
        and o.created_at>new.created_at-interval '60 seconds' and om.conversation_id=conversation) then return new; end if;
  end if;
  if recommendation then
    perform pg_advisory_xact_lock(hashtextextended('recommendation:'||new.user_id::text,0));
    if exists(select 1 from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
      where n.user_id=new.user_id and n.id<>new.id and n.target_type=new.target_type and n.target_id=new.target_id
        and n.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','meetups','interests','nearby')
        and n.created_at>new.created_at-interval '7 days') then return new; end if;
  end if;
  insert into private.push_delivery_queue(notification_id,device_id,next_attempt_at)
    select new.id,d.id,case when recommendation then private.next_recommendation_slot(new.created_at,d.timezone) else now() end
    from private.push_devices d where d.user_id=new.user_id and private.push_notification_eligible(d.id,new.id)
      and (not recommendation or d.timezone is not null)
    on conflict do nothing;
  return new;
end;
$function$;

drop function public.claim_push_notifications(text,integer);
CREATE FUNCTION public.claim_push_notifications(p_phase text DEFAULT 'send'::text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, lease_id uuid, token text, user_id uuid, notification_id uuid, category text, body text, route text, ticket_id text, post_title text, post_preview text, event_title text, kind text, locale text, badge integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  item private.push_delivery_queue;
  lease uuid;
  recommendation record;
  cfg private.trending_config;
  local_time timestamp; due_at timestamptz; budget_zone text;
begin
  if p_phase is null or p_phase not in ('send','receipt') then raise exception 'INVALID_PUSH_PHASE'; end if;
  if p_phase='send' then perform private.flush_account_security_logins(); end if;
  delete from private.push_delivery_queue q where q.id in (
    select old.id from private.push_delivery_queue old where old.created_at < now() - interval '7 days'
    order by old.created_at limit 500 for update skip locked
  );
  for item in
    select q.* from private.push_delivery_queue q
    where q.status = case p_phase when 'send' then 'pending' else 'ticket' end
      and q.next_attempt_at <= now() and (q.lease_until is null or q.lease_until <= now())
    order by q.next_attempt_at, q.id limit greatest(1, least(coalesce(p_limit,100),100))
    for update skip locked
  loop
    if (p_phase = 'send' and (item.attempts >= 5 or item.created_at < now() - interval '24 hours'))
      or (p_phase = 'receipt' and item.ticket_at < now() - interval '24 hours') then
      update private.push_delivery_queue q set status = 'failed', finished_at = now(), lease_id = null, lease_until = null,
        last_error = case p_phase when 'send' then 'RETRY_EXHAUSTED' else 'RECEIPT_EXPIRED' end where q.id = item.id;
      continue;
    end if;
    if p_phase = 'send' and not private.push_notification_eligible(item.device_id, item.notification_id) then
      update private.push_delivery_queue q set status = 'cancelled', finished_at = now(), lease_id = null, lease_until = null
        where q.id = item.id;
      continue;
    end if;
    if p_phase='send' then
      select n.*,(select d.timezone from private.push_devices d where d.id=item.device_id) timezone into recommendation
        from public.notifications n where n.id=item.notification_id;
      if recommendation.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby') or recommendation.kind='trending_meetup' then
        perform pg_advisory_xact_lock(hashtextextended('recommendation:'||recommendation.user_id::text,0));
        if recommendation.target_type='ticketmaster_event' then
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
        select t.* into cfg from private.trending_config t where t.id;
        if not coalesce(cfg.enabled,false) or recommendation.timezone is null or recommendation.created_at<now()-interval '24 hours' then
          update private.push_delivery_queue q set status='cancelled',finished_at=now(),lease_id=null,lease_until=null,
            last_error='RECOMMENDATION_SUPPRESSED' where q.id=item.id;
          continue;
        end if;
        budget_zone:=coalesce(private.recommendation_timezone(recommendation.user_id),recommendation.timezone);
        local_time:=now() at time zone recommendation.timezone;
        due_at:=now();
        if (case when cfg.quiet_start_hour=cfg.quiet_end_hour then false
          when cfg.quiet_start_hour<cfg.quiet_end_hour then extract(hour from local_time)>=cfg.quiet_start_hour and extract(hour from local_time)<cfg.quiet_end_hour
          else extract(hour from local_time)>=cfg.quiet_start_hour or extract(hour from local_time)<cfg.quiet_end_hour end) then
          due_at:=now()+interval '15 minutes';
        end if;
        select greatest(due_at,coalesce(max(coalesce(q.last_attempt_at,q.first_attempt_at))+interval '75 minutes',due_at)) into due_at
        from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
        where n.user_id=recommendation.user_id and q.notification_id<>item.notification_id
          and (n.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby') or n.kind='trending_meetup');
        if (select count(distinct q.notification_id) from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
          where n.user_id=recommendation.user_id and q.notification_id<>item.notification_id
            and (n.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby') or n.kind='trending_meetup')
            and (coalesce(q.last_attempt_at,q.first_attempt_at) at time zone budget_zone)::date=(now() at time zone budget_zone)::date)>=8 then
          due_at:=greatest(due_at,((now() at time zone budget_zone)::date+1+time '09:00') at time zone budget_zone);
        end if;
        due_at:=private.next_recommendation_slot(due_at,recommendation.timezone);
        if due_at>now() then
          update private.push_delivery_queue q set next_attempt_at=due_at,lease_id=null,lease_until=null where q.id=item.id;
          continue;
        end if;
      end if;
    end if;
    lease := gen_random_uuid();
    update private.push_delivery_queue q set lease_id = lease, lease_until = now() + interval '2 minutes',
      first_attempt_at=case p_phase when 'send' then coalesce(q.first_attempt_at,now()) else q.first_attempt_at end,
      last_attempt_at=case p_phase when 'send' then now() else q.last_attempt_at end, attempts = q.attempts + case p_phase when 'send' then 1 else 0 end where q.id = item.id;
    return query select item.id, lease, case p_phase when 'send' then d.token else null end,
      d.user_id, n.id, n.category,
      case when n.category='messages' then
        case when p_phase='send' and coalesce(prefs.message_preview,false) and m.id is not null then
          (case when m.sender_business_id is null then 
    (case when exists(select 1 from public.conversations c where c.id=m.conversation_id and c.kind='group') then
      coalesce((select h.profile->>'displayName' from private.chilling_host_profiles h join public.conversations c on c.group_post_id=h.post_id
        where c.id=m.conversation_id and h.author_id=m.sender_id),
        (select a.profile->>'displayName' from private.chilling_applications a join public.meetup_requests r on r.id=a.id
          join public.conversations c on c.group_post_id=r.post_id where c.id=m.conversation_id and r.requester_id=m.sender_id),'모임 멤버')
      else sender.nickname::text end)
 else (select b.name from private.merchants b where b.id=m.sender_business_id) end)||': '||case m.kind
            when 'image' then '사진을 보냈어요.'
            when 'location' then '위치를 보냈어요.'
            else left(trim(regexp_replace(m.body,'[[:space:][:cntrl:]]+',' ','g')),100)
              ||case when char_length(trim(regexp_replace(m.body,'[[:space:][:cntrl:]]+',' ','g')))>100 then '…' else '' end
          end
        else '메시지가 도착했어요.' end
      else case when preview_event.target_id is not null
        then private.event_recommendation_body(n.user_id,private.cached_ticketmaster_event(preview_event.city_id,preview_event.event_id),preview_event.city_id,n.body)
        when n.target_type='ticketmaster_event' then null else n.body end end,
      case when n.category='messages' then '/chat?conversationId='||m.conversation_id::text||case when n.recipient_business_id is null then '' else '&businessId='||n.recipient_business_id::text end else case when preview_post.id is not null then '/post/'||preview_post.id::text else n.route end end,
      item.ticket_id,
      case when preview_post.id is not null then trim(regexp_replace(preview_post.title,'[[:space:][:cntrl:]]+',' ','g')) end,
      case when preview_post.id is not null then left(trim(regexp_replace(preview_post.body,'[[:space:][:cntrl:]]+',' ','g')),180)
        ||case when char_length(trim(regexp_replace(preview_post.body,'[[:space:][:cntrl:]]+',' ','g')))>180 then '…' else '' end end,
      case when preview_event.target_id is not null then left(btrim(regexp_replace(regexp_replace(preview_event.name,'<[^>]*>',' ','g'),'[[:space:][:cntrl:]]+',' ','g')),300) end,
      n.kind, d.locale,
      case when p_phase='send' then (select count(*)::integer from public.notifications unread where unread.user_id=d.user_id and unread.read_at is null) end
      from private.push_devices d join public.notifications n on n.id=item.notification_id
      left join public.notification_preferences prefs on prefs.user_id=d.user_id
      left join public.messages m on n.category='messages' and n.target_type='message' and m.id=n.target_id
        and (m.sender_id=n.actor_id or (private.is_business_chat(m.conversation_id) and m.sender_business_id=n.actor_business_id and n.actor_id is null)) and m.hidden_at is null
        and (private.can_read_message(m.conversation_id,n.user_id,m.sender_id,m.created_at) or private.business_chat_notification_visible(n))
      left join public.profiles sender on sender.id=m.sender_id
      left join private.ticketmaster_notification_events preview_event on p_phase='send' and n.target_type='ticketmaster_event'
        and preview_event.target_id=n.target_id and n.category in ('trending','city_places')
      left join public.posts preview_post on p_phase='send' and n.target_type='post' and preview_post.id=n.target_id
        and n.category in ('trending','weekly_ranking','city_food','city_places','interests','nearby')
      where d.id=item.device_id and (p_phase<>'send' or private.push_notification_eligible(d.id,n.id));
  end loop;
end;
$function$;
revoke all on function public.claim_push_notifications(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_push_notifications(text,integer) to service_role;

CREATE OR REPLACE FUNCTION public.set_message_reaction(p_message_id uuid, p_reacted boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  viewer uuid := auth.uid();
  target public.messages;
  hearts integer;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(viewer);
  select * into target from public.messages where id = p_message_id;
  if target.id is null then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if not private.can_read_conversation(target.conversation_id, viewer) then raise exception 'NOT_CONVERSATION_MEMBER'; end if;

  if p_reacted then
    insert into private.message_reactions(message_id, user_id) values (p_message_id, viewer) on conflict do nothing;
    if target.sender_id <> viewer then
      perform pg_advisory_xact_lock(hashtextextended('message-reaction:' || viewer::text || ':' || target.sender_id::text, 0));
      -- Re-toggling never adds rows; a burst across many messages stops at 10 an hour.
      if not exists (select 1 from public.notifications n where n.user_id = target.sender_id and n.kind = 'message_reaction'
          and n.actor_id = viewer and n.target_type = 'message' and n.target_id = target.id)
        and (select count(*) from public.notifications n where n.user_id = target.sender_id and n.kind = 'message_reaction'
          and n.actor_id = viewer and n.created_at > now() - interval '1 hour') < 10 then
        insert into public.notifications(user_id, kind, actor_id, target_type, target_id, body, route)
        values (target.sender_id, 'message_reaction', viewer, 'message', target.id,
          -- Meetup chats show the snapshot meetup name, never the account nickname (same rule as message pushes).
          coalesce(case when exists (select 1 from public.conversations c where c.id = target.conversation_id and c.kind = 'group') then
            coalesce((select h.profile->>'displayName' from private.chilling_host_profiles h join public.conversations c on c.group_post_id = h.post_id
              where c.id = target.conversation_id and h.author_id = viewer),
              (select a.profile->>'displayName' from private.chilling_applications a join public.meetup_requests r on r.id = a.id
                join public.conversations c on c.group_post_id = r.post_id where c.id = target.conversation_id and r.requester_id = viewer), '모임 멤버')
            else (select p.nickname::text from public.profiles p where p.id = viewer) end, '누군가') || '님이 내 메시지에 공감했어요.',
          '/chat?conversationId=' || target.conversation_id::text);
      end if;
    end if;
  else
    delete from private.message_reactions where message_id = p_message_id and user_id = viewer;
  end if;

  select count(*) into hearts from private.message_reactions where message_id = p_message_id;
  return hearts;
end;
$function$;

CREATE OR REPLACE FUNCTION public.send_trending_topic_notifications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cfg private.trending_config;
  city record;
  hashtag record;
  meetup record;
  delivered integer;
  sent integer := 0;
begin
  select * into cfg from private.trending_config;
  if not cfg.enabled or private.trending_quiet_now() then return 0; end if;

  for city in select distinct city_id from public.posts where status = 'published' loop
    -- 1) 요즘 뜨는 해시태그 · 같은 태그는 7일 뒤에 다시 알린다.
    select th.hashtag into hashtag from public.get_trending_hashtags(city.city_id, null, 7, 1) th limit 1;
    if hashtag.hashtag is not null and not exists (
      select 1 from private.trending_topic_sent s where s.city_id = city.city_id and s.kind = 'trending_hashtag'
        and s.topic_key = hashtag.hashtag and s.sent_at > now() - interval '7 days') then
      insert into private.trending_topic_sent(city_id, kind, topic_key) values (city.city_id, 'trending_hashtag', hashtag.hashtag)
        on conflict (city_id, kind, topic_key) do update set sent_at = now();
      with recipients as (
        insert into public.notifications(user_id, kind, actor_id, target_type, target_id, body, route, city_id)
        select r.id, 'trending_hashtag', null, 'tag', md5('trending-hashtag:'||city.city_id||':'||hashtag.hashtag)::uuid,
          '요즘 관심이 모이는 주제예요. #' || regexp_replace(hashtag.hashtag, '^#', ''),
          '/?hashtag=' || regexp_replace(hashtag.hashtag, '^#', ''), city.city_id
        from public.profiles r
        left join public.notification_preferences prefs on prefs.user_id = r.id
        where r.city_id = city.city_id and r.account_status = 'active' and coalesce(prefs.trending, true)
          and not exists (select 1 from auth.users u where u.id = r.id
            and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb))
        returning 1)
      select count(*) into delivered from recipients;
      update private.trending_topic_sent set recipients = delivered
        where city_id = city.city_id and kind = 'trending_hashtag' and topic_key = hashtag.hashtag;
      sent := sent + 1;
    end if;

    -- 2) 요즘 뜨는 모임 · 반응 점수 + 신청 수(48시간) 로 고르고, 같은 모임은 3일 쉰다.
    select c.post_id, c.title, c.score + 4 * j.joins as total
      into meetup
      from private.trending_candidates(city.city_id, 50) c
      join lateral (select count(*) as joins from public.meetup_requests r
        where r.post_id = c.post_id and r.created_at > now() - interval '48 hours') j on true
      where j.joins > 0
      order by total desc, c.created_at desc limit 1;

    if meetup.post_id is not null and not exists (
      select 1 from private.trending_topic_sent s where s.city_id = city.city_id and s.kind = 'trending_meetup'
        and s.topic_key = meetup.post_id::text and s.sent_at > now() - interval '3 days') then
      insert into private.trending_topic_sent(city_id, kind, topic_key) values (city.city_id, 'trending_meetup', meetup.post_id::text)
        on conflict (city_id, kind, topic_key) do update set sent_at = now();
      with recipients as (
        insert into public.notifications(user_id, kind, actor_id, target_type, target_id, body, route)
        select r.id, 'trending_meetup', null, 'post', meetup.post_id,
          left(coalesce(meetup.title, ''), 80),
          '/post/' || meetup.post_id::text
        from public.profiles r
        left join public.notification_preferences prefs on prefs.user_id = r.id
        where r.city_id = city.city_id and r.account_status = 'active' and coalesce(prefs.meetups, true)
          and not exists (select 1 from auth.users u where u.id = r.id
            and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb))
        returning 1)
      select count(*) into delivered from recipients;
      update private.trending_topic_sent set recipients = delivered
        where city_id = city.city_id and kind = 'trending_meetup' and topic_key = meetup.post_id::text;
      sent := sent + 1;
    end if;
  end loop;

  return sent;
end;
$function$;

-- 3. Locale-aware registration. A separate overload (no default) keeps the 2- and 3-argument calls unambiguous.
create function public.register_push_device(p_token text, p_user_id uuid, p_timezone text, p_locale text)
returns void language plpgsql security definer set search_path='' as $$
declare language text := lower(split_part(coalesce(p_locale,''),'-',1));
begin
  perform public.register_push_device(p_token,p_user_id,p_timezone);
  -- Unknown languages keep the stored value; no locale means Korean copy.
  if language in ('ko','en') then
    update private.push_devices set locale=language
      where token=p_token and user_id=auth.uid() and session_id=nullif(auth.jwt()->>'session_id','')::uuid;
  end if;
end $$;
revoke all on function public.register_push_device(text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.register_push_device(text,uuid,text,text) to authenticated;

-- 8. The admin dashboard address stays on the server.
create function public.get_admin_dashboard_origin()
returns text language sql stable security definer set search_path='' as $$
  select case when private.is_admin() then 'https://cayden-macbookpro.tailb6648f.ts.net' end;
$$;
revoke all on function public.get_admin_dashboard_origin() from public,anon,authenticated,service_role;
grant execute on function public.get_admin_dashboard_origin() to authenticated;

-- 5. Likes held back by the one-push-per-day rule become one like_summary at 19:00 local time.
create function private.send_like_summaries(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare item record; total integer := 0;
begin
  for item in
    with held as (
      select n.user_id, n.target_type, n.target_id, n.actor_id, n.created_at, n.route
      from public.notifications n
      where n.kind in ('post_like','comment_like') and n.read_at is null
        and n.created_at > p_now - interval '24 hours' and n.created_at <= p_now
        and not exists (select 1 from private.push_delivery_queue q where q.notification_id = n.id)
        -- Held back only: an earlier like push for this target went out, so members without push get no summaries.
        and exists (select 1 from public.notifications o join private.push_delivery_queue q on q.notification_id = o.id
          where o.user_id = n.user_id and o.target_type = n.target_type and o.target_id = n.target_id
            and o.kind in ('post_like','comment_like','like_summary')
            and o.created_at <= n.created_at and o.created_at > n.created_at - interval '24 hours')
        and not exists (select 1 from public.notifications s where s.user_id = n.user_id and s.kind = 'like_summary'
          and s.target_type = n.target_type and s.target_id = n.target_id and s.created_at >= n.created_at)
    )
    select h.user_id, h.target_type, h.target_id, count(distinct h.actor_id)::integer likers,
      (array_agg(h.actor_id order by h.created_at desc))[1] actor_id,
      (array_agg(h.route order by h.created_at desc))[1] route
    from held h
    where extract(hour from p_now at time zone coalesce(private.recommendation_timezone(h.user_id),'America/Vancouver')) = 19
    group by h.user_id, h.target_type, h.target_id
  loop
    if private.create_notification(item.user_id, 'like_summary', item.actor_id, item.target_type, item.target_id,
      (select a.nickname::text from public.profiles a where a.id = item.actor_id)
        || case when item.likers > 1 then '님 외 ' || (item.likers - 1) || '명이' else '님이' end
        || case when item.target_type = 'comment' then ' 내 댓글을 좋아해요.' else ' 내 글을 좋아해요.' end,
      item.route) is not null then total := total + 1; end if;
  end loop;
  return total;
end $$;
revoke all on function private.send_like_summaries(timestamptz) from public,anon,authenticated,service_role;

-- 6. New sign-ups and operated-meetup requests reach admins as a 09:00/18:00 Vancouver digest push.
create function private.send_admin_digests(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare admin record; since timestamptz; signups integer; requests integer; total integer := 0;
begin
  if extract(hour from p_now at time zone 'America/Vancouver') not in (9,18) then return 0; end if;
  for admin in select profile.id from public.profiles profile join auth.users u on u.id = profile.id
    where u.raw_app_meta_data->>'role' = 'admin' and profile.account_status = 'active' and profile.deleted_at is null loop
    perform pg_advisory_xact_lock(hashtextextended('admin-digest:' || admin.id::text, 0));
    if exists (select 1 from public.notifications n where n.user_id = admin.id and n.kind = 'admin_digest'
      and n.created_at > p_now - interval '6 hours') then continue; end if;
    select greatest(coalesce(max(n.created_at), '-infinity'), p_now - interval '24 hours') into since
      from public.notifications n where n.user_id = admin.id and n.kind = 'admin_digest';
    select count(*) filter (where n.kind = 'admin_signup'), count(*) filter (where n.kind = 'admin_meetup_request')
      into signups, requests from public.notifications n
      where n.user_id = admin.id and n.kind in ('admin_signup','admin_meetup_request') and n.created_at > since and n.created_at <= p_now;
    if signups + requests = 0 then continue; end if;
    insert into public.notifications(user_id, kind, target_type, target_id, body, route, created_at)
    values (admin.id, 'admin_digest', 'user', admin.id,
      case when signups > 0 and requests > 0 then '새로 가입한 사람 ' || signups || '명, 운영 모임 참여 신청 ' || requests || '건이 있어요.'
        when signups > 0 then '새로 가입한 사람이 ' || signups || '명 있어요.'
        else '운영 모임 참여 신청이 ' || requests || '건 있어요.' end,
      '/admin', p_now);
    total := total + 1;
  end loop;
  return total;
end $$;
revoke all on function private.send_admin_digests(timestamptz) from public,anon,authenticated,service_role;

-- Hourly runs: each function decides its own local hour, so DST needs no schedule change.
select cron.unschedule(jobid) from cron.job where jobname in ('gling-like-summaries','gling-admin-digest');
select cron.schedule('gling-like-summaries', '7 * * * *', $job$ select private.send_like_summaries(); $job$);
select cron.schedule('gling-admin-digest', '3 * * * *', $job$ select private.send_admin_digests(); $job$);

notify pgrst, 'reload schema';
