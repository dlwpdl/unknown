CREATE OR REPLACE FUNCTION public.claim_push_notifications(p_phase text DEFAULT 'send'::text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, lease_id uuid, token text, user_id uuid, notification_id uuid, category text, body text, route text, ticket_id text, post_title text, post_preview text, event_title text)
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
          (case when m.sender_business_id is null then sender.nickname::text else (select b.name from private.merchants b where b.id=m.sender_business_id) end)||': '||case m.kind
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
      case when preview_event.target_id is not null then left(btrim(regexp_replace(regexp_replace(preview_event.name,'<[^>]*>',' ','g'),'[[:space:][:cntrl:]]+',' ','g')),300) end
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
$function$
