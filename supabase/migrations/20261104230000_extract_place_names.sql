-- extract-place-names 호출 제한: 회원 1명당 최근 24시간 30회. private 스키마는 API에 노출되지 않아
-- begin_membership_sync(0028)처럼 회원 본인 세션으로 부르는 public 래퍼를 둔다. 관리자는 0087에서 제한이 풀린다.
create function public.begin_place_name_extraction()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  perform private.enforce_rate_limit('place_name_extraction', 30, interval '1 day');
end;
$$;
revoke all on function public.begin_place_name_extraction() from public, anon, authenticated;
grant execute on function public.begin_place_name_extraction() to authenticated;
