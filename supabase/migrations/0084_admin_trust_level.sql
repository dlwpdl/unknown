-- 관리자 콘솔에서 신뢰 단계(1~3)를 직접 조정한다.
-- 실명인증 자체는 아직 도입 전이므로 이 값은 배지·노출 판단용이며 신분 확인 결과가 아니다.
-- 변경은 관리자 접근 로그(admin_access_logs)에 scope = 'trust_level'로 남는다.
create or replace function public.set_admin_verification_level(p_user_id uuid, p_level smallint)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_level smallint;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_level is null or p_level not between 1 and 3 then raise exception 'INVALID_TRUST_LEVEL'; end if;

  select verification_level into previous_level from public.profiles where id = p_user_id for update;
  if previous_level is null then raise exception 'USER_NOT_FOUND'; end if;
  if previous_level = p_level then return previous_level; end if;

  update public.profiles
  set verification_level = p_level,
      updated_at = now()
  where id = p_user_id;

  perform public.log_admin_access('trust_level', p_user_id, null);
  return previous_level;
end;
$$;

revoke execute on function public.set_admin_verification_level(uuid, smallint) from public, anon, authenticated;
grant execute on function public.set_admin_verification_level(uuid, smallint) to authenticated;
