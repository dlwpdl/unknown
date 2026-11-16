-- Notification tune (owner 2026-11-16): one push budget (3 a day, 120 minutes apart), no night pushes for meetup
-- follow-ups, two new kinds (city_new_posts, live_bubble_nearby), comment push titles, 14 copy lines, no duplicate
-- meetup rows and newcomer notes that no longer sit behind the Meetups switch or the push budget.
-- Most functions below were redefined by several earlier migrations, so each is patched in place: the text is read
-- from the live definition and every anchor must appear exactly the expected number of times, or the migration stops
-- instead of silently dropping an older fix.

-- ============================================================ helper (session only)
create function pg_temp.rep(def text, find text, repl text, times integer default 1) returns text
language plpgsql as $$
declare found integer := (length(def) - length(replace(def, find, ''))) / greatest(length(find), 1);
begin
  if found <> times then
    raise exception 'NOTIFICATION_TUNE_ANCHOR % (expected %, found %)', left(find, 80), times, found;
  end if;
  return replace(def, find, repl);
end $$;

-- ============================================================ 1. columns, switches, checks
alter table public.notification_preferences
  add column new_posts boolean not null default true,
  add column bubble_alerts boolean not null default true;
-- Off until the app that can turn them off is public (old apps have no switch for them).
alter table private.notification_switches
  add column new_posts boolean not null default false,
  add column bubble_alerts boolean not null default false;

do $$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid = 'public.notifications'::regclass and conname = 'notifications_kind_check';
  if definition is null or definition not like 'CHECK (%' then raise exception 'NOTIFICATION_TUNE_KIND_CHECK'; end if;
  if definition not like '%city_new_posts%' then
    alter table public.notifications drop constraint notifications_kind_check;
    execute 'alter table public.notifications add constraint notifications_kind_check '
      || replace(definition, 'CHECK (', 'CHECK (kind = ''city_new_posts'' or kind = ''live_bubble_nearby'' or ') || ' not valid';
    alter table public.notifications validate constraint notifications_kind_check;
  end if;
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid = 'public.notifications'::regclass and conname = 'notifications_category_check';
  if definition is null or definition not like 'CHECK (%' then raise exception 'NOTIFICATION_TUNE_CATEGORY_CHECK'; end if;
  if definition not like '%new_posts%' then
    alter table public.notifications drop constraint notifications_category_check;
    execute 'alter table public.notifications add constraint notifications_category_check '
      || replace(definition, 'CHECK (', 'CHECK (category = ''new_posts'' or category = ''bubble_alerts'' or ') || ' not valid';
    alter table public.notifications validate constraint notifications_category_check;
  end if;
end $$;

-- ============================================================ 2. categories and preferences
do $$
declare def text;
begin
  def := pg_get_functiondef('private.notification_category(text,text)'::regprocedure);
  def := pg_temp.rep(def, $a$when 'friend_saved_place' then 'friend_saves'$a$,
    $a$when 'city_new_posts' then 'new_posts' when 'live_bubble_nearby' then 'bubble_alerts' when 'friend_saved_place' then 'friend_saves'$a$);
  execute def;

  def := pg_get_functiondef('private.can_receive_notification(uuid,text,uuid)'::regprocedure);
  def := pg_temp.rep(def, $a$p_category in ('friend_saves',$a$, $a$p_category in ('new_posts','bubble_alerts','friend_saves',$a$);
  execute def;

  def := pg_get_functiondef('public.get_notification_preferences()'::regprocedure);
  def := pg_temp.rep(def, $a$case when s.weekend_picks then 'weekend_picks' end$a$,
    $a$case when s.weekend_picks then 'weekend_picks' end,case when s.new_posts then 'new_posts' end,case when s.bubble_alerts then 'bubble_alerts' end$a$);
  def := pg_temp.rep(def, $a$"weekend_picks":true,$a$, $a$"weekend_picks":true,"new_posts":true,"bubble_alerts":true,$a$);
  execute def;

  def := pg_get_functiondef('public.update_notification_preferences(jsonb)'::regprocedure);
  def := pg_temp.rep(def, $a$in ('friend_saves','weekend_picks','post_likes'$a$, $a$in ('new_posts','bubble_alerts','friend_saves','weekend_picks','post_likes'$a$, 2);
  def := pg_temp.rep(def, $a$weekend_picks = coalesce((p_preferences->>'weekend_picks')::boolean, p.weekend_picks),$a$,
    $a$weekend_picks = coalesce((p_preferences->>'weekend_picks')::boolean, p.weekend_picks),
    new_posts = coalesce((p_preferences->>'new_posts')::boolean, p.new_posts),
    bubble_alerts = coalesce((p_preferences->>'bubble_alerts')::boolean, p.bubble_alerts),$a$);
  execute def;

  -- A live bubble row is visible to the people the bubble itself is visible to (it was admin-only for report alerts).
  def := pg_get_functiondef('private.notification_target_visible(uuid,text,uuid)'::regprocedure);
  def := pg_temp.rep(def, $a$when 'live_bubble' then private.is_admin_id(p_user_id)$a$,
    $a$when 'live_bubble' then private.is_admin_id(p_user_id) or private.live_bubble_visible(p_target_id,p_user_id)$a$);
  execute def;
end $$;

-- ============================================================ 3. push budget (3 a day, 120 minutes apart) and quiet hours
-- Next 08:00 in the recipient's zone when it is 22:00-08:00 there, for the three meetup follow-ups that are not time-critical.
create function private.night_push_due(p_kind text, p_body text, p_user uuid, p_zone text)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare zone text; local_at timestamp;
begin
  if not (p_kind in ('meetup_review_request', 'meetup_host_tip')
    or (p_kind = 'meetup_reminder' and p_body ~ ' 모임이 24시간 뒤에 시작해요\. \(.*\)$')) then return now(); end if;
  zone := coalesce(p_zone, (select c.timezone from public.profiles r join public.cities c on c.id = r.city_id where r.id = p_user), 'America/Vancouver');
  local_at := now() at time zone zone;
  if extract(hour from local_at) >= 22 then return ((local_at::date + 1 + time '08:00') at time zone zone); end if;
  if extract(hour from local_at) < 8 then return ((local_at::date + time '08:00') at time zone zone); end if;
  return now();
end $$;
alter function private.night_push_due(text, text, uuid, text) owner to postgres;
revoke all on function private.night_push_due(text, text, uuid, text) from public, anon, authenticated, service_role;

do $$
declare def text;
begin
  def := pg_get_functiondef('private.filter_notification()'::regprocedure);
  -- Newcomer notes are written under the category 'system' (no switch, outside the push budget).
  def := pg_temp.rep(def, $a$new.category := private.notification_category(new.kind, new.target_type);$a$,
    $a$new.category := private.notification_category(new.kind, new.target_type);
  if new.kind='trending_meetup' and current_setting('private.newcomer_nudge',true)='on' then new.category:='system'; end if;$a$);
  def := pg_temp.rep(def, $a$if new.kind in ('trending_post','city_food','city_places') then$a$,
    $a$if new.kind in ('trending_post','city_food','city_places','city_new_posts') then$a$);
  def := pg_temp.rep(def, $a$(n.category in ('trending','city_food','city_places','merchant_updates') or n.kind='trending_meetup')$a$,
    $a$(n.category in ('trending','city_food','city_places','merchant_updates','new_posts') or (n.kind='trending_meetup' and n.category='meetups'))$a$, 2);
  def := pg_temp.rep(def, $a$::date=local_at::date)>=8$a$, $a$::date=local_at::date)>=3$a$);
  def := pg_temp.rep(def, $a$interval '75 minutes'$a$, $a$interval '120 minutes'$a$);
  execute def;

  def := pg_get_functiondef('private.enqueue_push_notification()'::regprocedure);
  def := pg_temp.rep(def, $a$new.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby') or new.kind='trending_meetup';$a$,
    $a$new.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby','new_posts') or (new.kind='trending_meetup' and new.category='meetups');$a$);
  def := pg_temp.rep(def, $a$else now() end$a$, $a$else private.night_push_due(new.kind,new.body,new.user_id,d.timezone) end$a$);
  execute def;
end $$;

-- The claim gains two columns (push title, push TTL), so it is dropped and created again with the same grants.
do $$
declare def text;
  sender_name text := $a$(case when m.sender_business_id is null then
    (case when exists(select 1 from public.conversations c where c.id=m.conversation_id and c.kind='group') then
      coalesce((select h.profile->>'displayName' from private.chilling_host_profiles h join public.conversations c on c.group_post_id=h.post_id
        where c.id=m.conversation_id and h.author_id=m.sender_id),
        (select a.profile->>'displayName' from private.chilling_applications a join public.meetup_requests r on r.id=a.id
          join public.conversations c on c.group_post_id=r.post_id where c.id=m.conversation_id and r.requester_id=m.sender_id),'모임 멤버')
      else sender.nickname::text end)
    else (select b.name from private.merchants b where b.id=m.sender_business_id) end)$a$;
begin
  def := pg_get_functiondef('public.claim_push_notifications(text,integer)'::regprocedure);
  def := pg_temp.rep(def, $a$badge integer, rsvp_post_id uuid)$a$, $a$badge integer, rsvp_post_id uuid, push_title text, push_ttl integer)$a$);
  def := pg_temp.rep(def, $a$if recommendation.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby') or recommendation.kind='trending_meetup' then$a$,
    $a$if recommendation.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby','new_posts') or (recommendation.kind='trending_meetup' and recommendation.category='meetups') then$a$);
  def := pg_temp.rep(def, $a$(n.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby') or n.kind='trending_meetup')$a$,
    $a$(n.category in ('trending','city_food','city_places','merchant_updates','weekly_ranking','interests','nearby','new_posts') or (n.kind='trending_meetup' and n.category='meetups'))$a$, 2);
  def := pg_temp.rep(def, $a$interval '75 minutes'$a$, $a$interval '120 minutes'$a$);
  def := pg_temp.rep(def, $a$::date=(now() at time zone budget_zone)::date)>=8 then$a$, $a$::date=(now() at time zone budget_zone)::date)>=3 then$a$);
  -- Message push without the content preview names the sender (the meetup display name in meetup chats).
  def := pg_temp.rep(def, $a$else '메시지가 도착했어요.' end$a$,
    $a$else case when p_phase='send' and m.id is not null then $a$ || sender_name || $a$||'님이 메시지를 보냈어요.' else '메시지가 도착했어요.' end end$a$);
  -- Comment and reply pushes carry the comment text; a deleted or unreadable comment keeps the stored sentence.
  def := pg_temp.rep(def, $a$when n.target_type='ticketmaster_event' then null else n.body end end,$a$,
    $a$when n.target_type='ticketmaster_event' then null
        when push_comment.id is not null then left(trim(regexp_replace(push_comment.body,'[[:space:][:cntrl:]]+',' ','g')),100)
        else n.body end end,$a$);
  def := pg_temp.rep(def, $a$left join public.profiles sender on sender.id=m.sender_id$a$,
    $a$left join public.profiles sender on sender.id=m.sender_id
      left join public.comments push_comment on p_phase='send' and n.kind in ('comment','reply') and n.target_type='comment'
        and push_comment.id=n.target_id and push_comment.deleted_at is null
        and nullif(trim(regexp_replace(push_comment.body,'[[:space:][:cntrl:]]+',' ','g')),'') is not null
        and private.comment_visible_to(push_comment.id,n.user_id)$a$);
  def := pg_temp.rep(def, $a$and private.meetup_tool_member(notice.post_id,n.user_id)) end$a$,
    $a$and private.meetup_tool_member(notice.post_id,n.user_id)) end,
      case when p_phase='send' and push_comment.id is not null then
          coalesce((select mm.name from private.merchants mm where mm.id=push_comment.business_author_id),
            (select pp.nickname::text from public.profiles pp where pp.id=push_comment.author_id),'이웃')
          ||case n.kind when 'reply' then '님의 답글' else '님의 댓글' end
        when p_phase='send' and n.kind='city_new_posts' then n.title end,
      case when p_phase='send' and n.kind='live_bubble_nearby' then
        (select greatest(60,least(3600,extract(epoch from b.expires_at-now())::integer)) from private.live_bubbles b where b.id=n.target_id) end$a$);
  drop function public.claim_push_notifications(text, integer);
  execute def;
  revoke all on function public.claim_push_notifications(text, integer) from public, anon, authenticated, service_role;
  grant execute on function public.claim_push_notifications(text, integer) to service_role;
end $$;

-- ============================================================ 4. copy (14 lines; wording comes from the contract)
do $$
declare def text;
begin
  -- meetup_request: applicant's meetup display name and the meetup title.
  def := pg_get_functiondef('private.request_meetup_join(uuid,text)'::regprocedure);
  def := pg_temp.rep(def, $a$'모임 참여 요청이 도착했어요. 한번 확인해 주세요.',$a$,
    $a$coalesce(nullif((select cp.profile->>'displayName' from private.chilling_profiles cp where cp.id=current_user_id),''),'모임 멤버')
      ||'님이 '||left(meetup.title,60)||' 모임에 같이 가고 싶대요.',$a$);
  execute def;

  -- interest_post / nearby_meetup, and the same-meetup duplicate (item 7).
  def := pg_get_functiondef('private.process_discovery_posts(integer)'::regprocedure);
  def := pg_temp.rep(def, $a$case when match.interested then '관심 있는 주제에 새 글이 올라왔어요. 한번 읽어볼까요?' else '우리 동네에 새 모임이 생겼어요. 어떤 모임인지 볼까요?' end,$a$,
    $a$case when match.interested then '#'||coalesce(match.topic,'')||'에 새 글이 올라왔어요. ‘'||left(post.title,60)||'’'
        else coalesce((select c.name from public.cities c where c.id=post.city_id),'우리 동네')||'에 새 모임이 생겼어요. ‘'||left(post.title,60)||'’' end,$a$);
  def := pg_temp.rep(def, $a$)) interested) match$a$,
    $a$)) interested,
      case when post.tag_id=any(prefs.interest_tag_ids) then (select t.label from public.tags t where t.id=post.tag_id)
        else (select private.canonicalize_hashtag(h) from unnest(post.hashtags) h
          where lower(private.canonicalize_hashtag(h))=any(prefs.interest_hashtags) limit 1) end topic) match$a$);
  -- Someone who already got the followed host's "new meetup" note for this post gets no second row for it.
  def := pg_temp.rep(def, $a$(prefs.nearby and post.room_preview is not null and coalesce(post.room_preview->>'closed','false')<>'true')$a$,
    $a$(prefs.nearby and post.room_preview is not null and coalesce(post.room_preview->>'closed','false')<>'true'
        and not exists(select 1 from private.host_follow_alerts hfa where hfa.user_id=prefs.user_id and hfa.post_id=post.id))$a$);
  execute def;

  -- saved_merchant_post
  def := pg_get_functiondef('private.notify_saved_merchant_post(uuid,boolean)'::regprocedure);
  def := pg_temp.rep(def, $a$for recipient in select s.user_id,c.timezone from private.saved_merchants s$a$,
    $a$for recipient in select s.user_id,s.merchant_id,c.timezone from private.saved_merchants s$a$);
  def := pg_temp.rep(def, $a$'저장한 비즈니스에 새 소식이 있어요. 한번 살펴보세요.'$a$,
    $a$coalesce((select private.alert_name(m.name) from private.merchants m where m.id=recipient.merchant_id),'저장한 비즈니스')||'에 새 소식이 올라왔어요.'$a$);
  execute def;

  -- trending_hashtag
  def := pg_get_functiondef('public.send_trending_topic_notifications()'::regprocedure);
  def := pg_temp.rep(def, $a$'요즘 관심이 모이는 주제예요. #' || regexp_replace(hashtag.hashtag, '^#', '')$a$,
    $a$'요즘 #' || regexp_replace(hashtag.hashtag, '^#', '') || ' 글이 많이 올라와요.'$a$);
  execute def;

  -- weekly_ranking
  def := pg_get_functiondef('private.publish_weekly_ranking()'::regprocedure);
  def := pg_temp.rep(def, $a$left(first.title, 60),$a$,
    $a$'이번 주 '||coalesce((select c.name from public.cities c where c.id=city.city_id),'우리 동네')||'에서 제일 많이 읽은 글이에요. ‘'||left(first.title, 60)||'’',$a$);
  execute def;

  -- meetup_review_request
  def := pg_get_functiondef('private.send_meetup_review_requests(timestamptz)'::regprocedure);
  def := pg_temp.rep(def, $a$for item in select s.id,a.user_id from private.meetup_sessions s$a$,
    $a$for item in select s.id,a.user_id,(select p.title from public.posts p where p.id=s.post_id) title from private.meetup_sessions s$a$);
  def := pg_temp.rep(def, $a$'모임은 어땠어요? 참석을 확인하고 함께한 경험과 매너를 남겨 주세요.'$a$,
    $a$left(coalesce(item.title,'이번'),60)||' 모임 잘 다녀왔어요? 같이 간 분들 후기 남겨 주세요.'$a$);
  execute def;

  -- meetup_cancelled (host cancelled) and the closed-to-sign-ups case: the kind stays meetup_cancelled, only the sentence differs.
  def := pg_get_functiondef('private.notify_meetup_event_change()'::regprocedure);
  def := pg_temp.rep(def, $a$perform private.send_meetup_notice(new.id,'meetup_cancelled',left(old.title,160)||' 모임이 마감되거나 취소됐어요. 모임 글에서 확인해 주세요.');$a$,
    $a$perform private.send_meetup_notice(new.id,'meetup_cancelled',left(old.title,160)||case when new.status<>'published' then ' 모임이 취소됐어요.' else ' 모임 모집이 끝났어요.' end);$a$);
  execute def;

  -- meetup_approved
  def := pg_get_functiondef('public.respond_meetup_request(uuid,text)'::regprocedure);
  def := pg_temp.rep(def, $a$'모임에 함께할 수 있게 됐어요. 모임 채팅에서 인사해 볼까요?'$a$,
    $a$left(p.title,60)||' 모임에 같이 가게 됐어요. 채팅방에 인사 한마디 남겨 보세요.'$a$);
  execute def;

  -- merchant_review_received
  def := pg_get_functiondef('private.notify_merchant_review_received()'::regprocedure);
  def := pg_temp.rep(def, $a$'내 비즈니스에 새 이용 후기가 올라왔어요. 확인해 보세요.'$a$,
    $a$coalesce((select private.alert_name(m.name) from private.merchants m where m.id=new.merchant_id),'내 비즈니스')||'에 새 후기가 올라왔어요.'$a$);
  execute def;

  -- live_bubble_accepted
  def := pg_get_functiondef('public.respond_live_bubble_request(uuid,text)'::regprocedure);
  def := pg_temp.rep(def, $a$'님이 대화 신청을 받았어요. 지금 이야기해 보세요.'$a$, $a$'님이 대화 신청을 수락했어요. 지금 말 걸어 보세요.'$a$);
  execute def;
end $$;
-- city_places_event: the four lead-in phrases are already gone from what the server writes (20261018203000), so no change.

-- ============================================================ 5. newcomer notes leave the Meetups switch and the push budget
do $$
declare def text;
begin
  def := pg_get_functiondef('private.send_newcomer_nudges(timestamptz)'::regprocedure);
  def := pg_temp.rep(def, $a$ and coalesce(prefs.meetups,true)$a$, '');
  -- Without the recommendation window these go out when written, so keep them to daytime (they used to wait for 09:00-19:45).
  def := pg_temp.rep(def, $a$elsif extract(hour from local_now)<10 then continue;$a$,
    $a$elsif extract(hour from local_now)<10 or extract(hour from local_now)>=22 then continue;$a$);
  def := pg_temp.rep(def, $a$sent_id:=private.create_notification(member.id,'trending_meetup',null,'post',target,body,'/post/'||target::text);$a$,
    $a$perform set_config('private.newcomer_nudge','on',true);
    sent_id:=private.create_notification(member.id,'trending_meetup',null,'post',target,body,'/post/'||target::text);
    perform set_config('private.newcomer_nudge','off',true);$a$);
  execute def;
end $$;

-- ============================================================ 6. new posts roundup (city_new_posts)
create function private.send_new_posts_roundup(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare city record; member record; total integer; top_title text; sent integer := 0;
begin
  if not coalesce((select s.new_posts from private.notification_switches s where s.id), false) then return 0; end if;
  for city in select c.id, c.name, c.timezone from public.cities c where c.is_open and c.timezone is not null
    and extract(hour from p_now at time zone c.timezone) between 16 and 20 loop
    -- Fewer than 4 public posts in the last 24 hours in this city: nobody gets a note.
    continue when (select count(*) from public.posts p where p.city_id = city.id and p.status = 'published'
      and p.created_at > p_now - interval '24 hours' and p.created_at <= p_now) < 4;
    for member in
      select r.id from public.profiles r
      left join public.notification_preferences prefs on prefs.user_id = r.id
      cross join lateral (select coalesce(private.recommendation_timezone(r.id), city.timezone) zone) z
      where r.city_id = city.id and r.account_status = 'active' and coalesce(prefs.new_posts, true)
        and extract(hour from p_now at time zone z.zone) = 18 and extract(minute from p_now at time zone z.zone) < 15
        and not private.is_operated_character(r.id)
        and not exists(select 1 from auth.users u where u.id = r.id and u.raw_app_meta_data->'review_access' = 'true'::jsonb)
        -- Opened the app today (their calendar day): they have seen it.
        and not exists(select 1 from private.analytics_visits v where v.user_id = r.id
          and v.last_at >= (((p_now at time zone z.zone)::date)::timestamp at time zone z.zone))
        and (select count(*) from public.notifications n where n.user_id = r.id and n.kind = 'city_new_posts'
          and n.created_at > p_now - interval '7 days') < 3
        and not exists(select 1 from public.notifications n where n.user_id = r.id and n.kind = 'city_new_posts'
          and n.created_at > p_now - interval '12 hours')
    loop
      select count(*)::integer, (array_agg(v.title order by v.view_count desc, v.created_at desc))[1] into total, top_title
      from (select p.id, p.title, p.view_count, p.created_at from public.posts p
        where p.city_id = city.id and p.status = 'published' and p.deleted_at is null and p.held_at is null
          and p.created_at > p_now - interval '24 hours' and p.created_at <= p_now and p.author_id <> member.id
        order by p.created_at desc limit 200) v
      where private.notification_target_visible(member.id, 'post', v.id);
      continue when total < 4;
      -- The row goes through the same guards as every note: preference, push budget, active window.
      insert into public.notifications(user_id, kind, actor_id, target_type, target_id, body, route, title)
      values (member.id, 'city_new_posts', null, 'user', member.id,
        '‘' || left(btrim(regexp_replace(top_title, '[[:space:][:cntrl:]]+', ' ', 'g')), 80) || '’ 말고도 ' || (total - 1) || '개 더 올라왔어요.',
        '/', city.name || ' 새 글 ' || total || '개');
      sent := sent + 1;
    end loop;
  end loop;
  return sent;
end $$;
alter function private.send_new_posts_roundup(timestamptz) owner to postgres;
revoke all on function private.send_new_posts_roundup(timestamptz) from public, anon, authenticated, service_role;

-- ============================================================ 7. nearby bubbles (live_bubble_nearby)
-- A queue keeps the poster's call short; the minute job fans out in batches.
create table private.bubble_alert_jobs(
  bubble_id uuid primary key references private.live_bubbles(id) on delete cascade,
  after_user_id uuid not null default '00000000-0000-0000-0000-000000000000',
  queued_at timestamptz not null default now());
-- One city-wide alert per author per 24 hours, whatever the author posts.
create table private.bubble_alert_authors(
  author_id uuid primary key references auth.users(id) on delete cascade,
  last_at timestamptz not null);
alter table private.bubble_alert_jobs enable row level security;
alter table private.bubble_alert_authors enable row level security;
revoke all on private.bubble_alert_jobs, private.bubble_alert_authors from public, anon, authenticated, service_role;
alter table private.bubble_alert_jobs owner to postgres;
alter table private.bubble_alert_authors owner to postgres;

create function private.queue_bubble_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Friends-only bubbles and the 글링 pins never alert anyone.
  if new.audience <> 'city' or new.kind <> 'member' then return new; end if;
  if not coalesce((select s.bubble_alerts from private.notification_switches s where s.id), false) then return new; end if;
  insert into private.bubble_alert_authors(author_id, last_at) values (new.author_id, now())
    on conflict (author_id) do update set last_at = now() where private.bubble_alert_authors.last_at <= now() - interval '24 hours';
  if found then insert into private.bubble_alert_jobs(bubble_id) values (new.id) on conflict do nothing; end if;
  return new;
end $$;
alter function private.queue_bubble_alert() owner to postgres;
revoke all on function private.queue_bubble_alert() from public, anon, authenticated, service_role;
create trigger live_bubbles_queue_alert after insert on private.live_bubbles
  for each row execute function private.queue_bubble_alert();

create function private.process_bubble_alerts(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = '' as $$
declare job private.bubble_alert_jobs; b private.live_bubbles; city record; batch uuid[]; remaining integer := greatest(1, least(coalesce(p_limit, 500), 500));
  inserted integer; processed integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('bubble-alerts', 0)) then return 0; end if;
  for job in select j.* from private.bubble_alert_jobs j order by j.queued_at, j.bubble_id limit 5 for update skip locked loop
    select * into b from private.live_bubbles x where x.id = job.bubble_id and x.audience = 'city' and x.kind = 'member'
      and x.ended_at is null and x.hidden_at is null and x.expires_at > now();
    if b.id is null or not coalesce((select s.bubble_alerts from private.notification_switches s where s.id), false)
      or not private.is_active_account(b.author_id) then
      delete from private.bubble_alert_jobs where bubble_id = job.bubble_id; continue;
    end if;
    -- The same word check the post call ran; anything that would not pass it is never put in front of a whole city.
    begin perform private.assert_content_allowed(b.body);
    exception when others then delete from private.bubble_alert_jobs where bubble_id = job.bubble_id; continue; end;
    select c.id, c.name, c.timezone into city from public.cities c where c.id = b.city_id;
    select coalesce(array_agg(x.id order by x.id), '{}') into batch from (
      select r.id from public.profiles r where r.city_id = b.city_id and r.id > job.after_user_id order by r.id limit remaining) x;
    insert into public.notifications(user_id, kind, actor_id, target_type, target_id, body, route)
    select r.id, 'live_bubble_nearby', null, 'live_bubble', b.id,
      '지금 ' || coalesce(city.name, '우리 동네') || '에 말풍선이 떴어요. ‘' || left(btrim(regexp_replace(b.body, '[[:space:][:cntrl:]]+', ' ', 'g')), 60) || '’',
      '/discover'
    from public.profiles r
    left join public.notification_preferences prefs on prefs.user_id = r.id
    where r.id = any(batch) and r.account_status = 'active' and r.id <> b.author_id
      and coalesce(prefs.bubble_alerts, true)
      and not private.is_operated_character(r.id)
      and private.live_bubble_visible(b.id, r.id)
      -- Night in the recipient's own zone: skipped, not postponed (a bubble is gone within the hour).
      and extract(hour from now() at time zone coalesce(private.recommendation_timezone(r.id), city.timezone)) between 8 and 21
      and not exists(select 1 from public.notifications n where n.user_id = r.id and n.kind = 'live_bubble_nearby'
        and n.created_at > now() - interval '24 hours');
    get diagnostics inserted = row_count;
    processed := processed + inserted;
    if cardinality(batch) < remaining then delete from private.bubble_alert_jobs where bubble_id = job.bubble_id;
    else update private.bubble_alert_jobs set after_user_id = batch[cardinality(batch)] where bubble_id = job.bubble_id; end if;
    remaining := remaining - cardinality(batch);
    exit when remaining <= 0;
  end loop;
  return processed;
end $$;
alter function private.process_bubble_alerts(integer) owner to postgres;
revoke all on function private.process_bubble_alerts(integer) from public, anon, authenticated, service_role;

-- ============================================================ 8. minute job: two more steps (no new schedule)
do $$
declare def text;
begin
  def := pg_get_functiondef('private.run_minute_jobs()'::regprocedure);
  def := pg_temp.rep(def, $a$exception when others then raise warning 'gling-minute-jobs discovery % %', sqlstate, sqlerrm; end;$a$,
    $a$exception when others then raise warning 'gling-minute-jobs discovery % %', sqlstate, sqlerrm; end;
  begin perform private.process_bubble_alerts(500);
  exception when others then raise warning 'gling-minute-jobs bubbles % %', sqlstate, sqlerrm; end;
  -- Local 18:00 window of the new-posts note: the hourly pass at :07 lands inside it for every zone the app serves.
  begin if extract(minute from now()) = 7 then perform private.send_new_posts_roundup(); end if;
  exception when others then raise warning 'gling-minute-jobs new-posts % %', sqlstate, sqlerrm; end;$a$);
  execute def;
end $$;

notify pgrst, 'reload schema';
