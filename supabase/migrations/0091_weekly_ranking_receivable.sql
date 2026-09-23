-- 0090에서 주간 랭킹 알림 종류와 설정 토글을 추가했지만, 수신 가능 카테고리 목록(can_receive_notification)에
-- 'weekly_ranking'이 없어 BEFORE INSERT 트리거가 알림을 조용히 버렸다. 목록에 추가한다.
create or replace function private.can_receive_notification(p_user_id uuid, p_category text, p_actor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and (
    p_category = 'system' or (
      p_category in ('post_likes','comment_likes','replies','direct_requests','messages','meetups','interests','nearby','trending','weekly_ranking')
      and private.is_active_account(p_user_id)
      and (p_actor_id is null or (p_actor_id <> p_user_id and private.is_active_account(p_actor_id)
        and not private.is_blocked_between(p_user_id, p_actor_id)))
      and coalesce((select (to_jsonb(p)->>p_category)::boolean from public.notification_preferences p where user_id = p_user_id),
        p_category not in ('interests','nearby'))
    )
  );
$$;

revoke all on function private.can_receive_notification(uuid, text, uuid) from public, anon, authenticated;
