-- 운영 현황 지표에 "24시간 전 대비"를 붙이기 위한 조회.
-- 처리 대기 항목은 지금 열려 있는 건수와 24시간 전에 열려 있던 건수를 함께 센다.
-- (24시간 전 시점에 존재했고 아직 resolved/reviewed 되지 않은 건 = created_at <= t and (resolved_at is null or resolved_at > t))
create or replace function public.get_admin_count_deltas()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  return (
  with point as (select now() - interval '24 hours' as t)
  select jsonb_build_object(
    'openReports', jsonb_build_object(
      'now', (select count(*) from public.reports where status = 'open'),
      'before', (select count(*) from public.reports, point where created_at <= point.t and (resolved_at is null or resolved_at > point.t))
    ),
    'alertsOpen', jsonb_build_object(
      'now', (select count(*) from public.safety_alerts where status = 'open'),
      'before', (select count(*) from public.safety_alerts, point where created_at <= point.t and (reviewed_at is null or reviewed_at > point.t))
    ),
    'safetyPending', jsonb_build_object(
      'now', (select count(*) from public.safety_review_queue where status in ('pending', 'processing', 'failed')),
      'before', (select count(*) from public.safety_review_queue, point where created_at <= point.t and (reviewed_at is null or reviewed_at > point.t))
    ),
    'safetyHigh', jsonb_build_object(
      'now', (select count(*) from public.safety_review_queue where risk_level in ('high', 'critical')),
      'before', (select count(*) from public.safety_review_queue, point where created_at <= point.t and risk_level in ('high', 'critical'))
    ),
    'profiles', jsonb_build_object(
      'now', (select count(*) from public.profiles),
      'before', (select count(*) from public.profiles, point where created_at <= point.t)
    ),
    'posts', jsonb_build_object(
      'now', (select count(*) from public.posts),
      'before', (select count(*) from public.posts, point where created_at <= point.t)
    ),
    'messages', jsonb_build_object(
      'now', (select count(*) from public.messages),
      'before', (select count(*) from public.messages, point where created_at <= point.t)
    )
  ));
end;
$$;

revoke execute on function public.get_admin_count_deltas() from public, anon, authenticated;
grant execute on function public.get_admin_count_deltas() to authenticated;
