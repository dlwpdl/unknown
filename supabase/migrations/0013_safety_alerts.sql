-- 안전 분석 결과 중 high/critical 항목을 관리자에게 즉시 노출한다.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications
add constraint notifications_kind_check check (kind in (
  'comment', 'post_like', 'message', 'meetup_request',
  'meetup_approved', 'meetup_rejected',
  'moderation_warning', 'moderation_blocked', 'safety_alert'
));

create function public.raise_safety_alert(p_queue_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.safety_review_queue;
begin
  if auth.role() <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  select * into review from public.safety_review_queue where id = p_queue_id;
  if review is null or review.status <> 'reviewed' or review.risk_level not in ('high', 'critical') then
    raise exception 'ALERT_NOT_REQUIRED';
  end if;

  insert into public.notifications (user_id, kind, target_type, target_id, body, route)
  select
    profile.id,
    'safety_alert',
    review.target_type,
    review.target_id,
    case review.risk_level
      when 'critical' then '긴급 위험 콘텐츠가 감지됐어요. 즉시 검토가 필요합니다.'
      else '고위험 콘텐츠가 감지됐어요. 관리자 검토가 필요합니다.'
    end,
    '/admin?safety=' || review.id::text
  from public.profiles as profile
  join auth.users as auth_user on auth_user.id = profile.id
  where auth_user.raw_app_meta_data ->> 'role' = 'admin'
    and profile.account_status = 'active';
end;
$$;

revoke execute on function public.raise_safety_alert(bigint) from public, anon, authenticated;
grant execute on function public.raise_safety_alert(bigint) to service_role;
