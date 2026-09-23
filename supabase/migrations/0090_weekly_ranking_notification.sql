-- 주간 랭킹 알림을 "지금 뜨는 글"과 분리하고, 트렌딩 토글이 저장되지 않던 버그를 고친다.
-- notification_preferences.trending 컬럼은 예전부터 있었지만 update 허용 목록에 없어서
-- 앱에서 끄면 INVALID_PREFERENCES 로 실패했다.
alter table public.notification_preferences add column if not exists weekly_ranking boolean not null default true;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'comment','reply','post_like','comment_like','message',
  'meetup_request','meetup_approved','meetup_rejected',
  'interest_post','nearby_meetup','moderation_warning','moderation_blocked',
  'safety_alert','trending_post','weekly_ranking',
  'admin_security','admin_multiacct','admin_error_spike'
));

create or replace function private.notification_category(p_kind text, p_target_type text)
returns text language sql immutable set search_path='' as $$
  select case p_kind
    when 'post_like' then 'post_likes' when 'comment_like' then 'comment_likes'
    when 'comment' then 'replies' when 'reply' then 'replies'
    when 'message' then case when p_target_type = 'user' then 'direct_requests' else 'messages' end
    when 'meetup_request' then 'meetups' when 'meetup_approved' then 'meetups' when 'meetup_rejected' then 'meetups'
    when 'interest_post' then 'interests' when 'nearby_meetup' then 'nearby'
    when 'trending_post' then 'trending' when 'weekly_ranking' then 'weekly_ranking'
    else 'system' end;
$$;
alter table public.notifications drop constraint notifications_category_check;
alter table public.notifications add constraint notifications_category_check check (category in (
  'post_likes','comment_likes','replies','direct_requests','messages','meetups','interests','nearby','trending','weekly_ranking','system'
));

-- 설정 저장 허용 목록에 주간 랭킹 키를 더한다. (trending 은 0049 에서 이미 추가됨)
do $$
declare definition text; anchor text;
begin
  definition := pg_get_functiondef('public.update_notification_preferences(jsonb)'::regprocedure);
  if strpos(definition, '''nearby'',''trending'',''weekly_ranking'',''push_enabled'') then') > 0 then
    null; -- 이미 적용됨
  elsif strpos(definition, '''nearby'',''trending'',''push_enabled'') then') > 0 then
    definition := replace(definition, '''nearby'',''trending'',''push_enabled'') then', '''nearby'',''trending'',''weekly_ranking'',''push_enabled'') then');
  elsif strpos(definition, '''nearby'',''push_enabled'') then') > 0 then
    definition := replace(definition, '''nearby'',''push_enabled'') then', '''nearby'',''trending'',''weekly_ranking'',''push_enabled'') then');
  else
    raise exception 'notification preference allowlist anchor missing';
  end if;
  anchor := 'trending = coalesce((p_preferences->>''trending'')::boolean, p.trending),';
  if strpos(definition, 'weekly_ranking = coalesce') > 0 then
    null; -- 이미 적용됨
  elsif strpos(definition, anchor) = 0 then
    raise exception 'notification preference update anchor missing';
  else
    definition := replace(definition, anchor, anchor || '
    weekly_ranking = coalesce((p_preferences->>''weekly_ranking'')::boolean, p.weekly_ranking),');
  end if;
  execute definition;

  -- 주간 랭킹은 이제 자기 종류와 자기 설정을 쓴다.
  definition := pg_get_functiondef('private.publish_weekly_ranking()'::regprocedure);
  if strpos(definition, '''weekly_ranking'', null, ''post'', first.post_id') = 0 then
    if strpos(definition, '''trending_post'', null, ''post'', first.post_id') = 0 then
      raise exception 'weekly ranking kind anchor missing';
    end if;
    definition := replace(definition, '''trending_post'', null, ''post'', first.post_id',
      '''weekly_ranking'', null, ''post'', first.post_id');
  end if;
  if strpos(definition, 'coalesce(prefs.weekly_ranking, true)') = 0 then
    if strpos(definition, 'coalesce(prefs.trending, true)') = 0 then raise exception 'weekly ranking opt-out anchor missing'; end if;
    definition := replace(definition, 'coalesce(prefs.trending, true)', 'coalesce(prefs.weekly_ranking, true)');
  end if;
  execute definition;
end;
$$;

notify pgrst, 'reload schema';
