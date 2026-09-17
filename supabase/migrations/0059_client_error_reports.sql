-- 앱에서 난 오류를 서버로 모은다.
--
-- 지금은 사용자 폰에서 앱이 죽어도 아무 기록이 남지 않는다. 출시 후에는 "자꾸 꺼져요"라는
-- 리뷰만 보고 원인을 모르는 상태가 된다.
--
-- 네이티브 충돌은 Apple 과 Google 이 이미 무료로 수집해 준다(App Store Connect, Play Console).
-- 여기서 채우는 것은 그쪽에 잡히지 않는 자바스크립트 오류다. 새 업체를 붙이지 않으므로
-- 개인정보 처리방침에 처리자를 추가하지 않아도 되고, 심사에 새로 고지할 것도 없다.

create table private.client_errors (
  id bigint generated always as identity primary key,
  fingerprint text not null,          -- 같은 오류를 한 줄로 묶는 열쇠
  message text not null,
  stack text,
  screen text,
  platform text not null check (platform in ('ios','android','web')),
  app_version text not null,
  os_version text,
  user_id uuid references public.profiles(id) on delete set null,
  occurrences integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz,
  unique (fingerprint, app_version)
);
revoke all on private.client_errors from public, anon, authenticated;
create index client_errors_recent_idx on private.client_errors(last_seen desc) where resolved_at is null;

-- 오류 보고는 로그아웃 상태에서도 올 수 있다. 크래시 루프가 DB 를 때리지 않도록
-- 같은 오류는 행 하나로 합치고 횟수만 센다.
create function public.report_client_error(
  p_message text, p_stack text, p_screen text, p_platform text, p_app_version text, p_os_version text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  msg text := left(btrim(coalesce(p_message, '')), 500);
  fp text;
begin
  if msg = '' then return; end if;
  if p_platform is null or p_platform not in ('ios','android','web') then return; end if;
  if p_app_version is null or p_app_version !~ '^[0-9A-Za-z.+_()-]{1,32}$' then return; end if;

  -- 지문은 메시지와 스택 첫 줄로만 만든다. 메시지에 사용자 값이 섞여도 같은 오류로 묶이도록
  -- 숫자와 UUID 는 지운다.
  fp := md5(regexp_replace(
    lower(msg || ' ' || coalesce(split_part(btrim(coalesce(p_stack,'')), E'\n', 1), '')),
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]+', '', 'g'));

  insert into private.client_errors (fingerprint, message, stack, screen, platform, app_version, os_version, user_id)
  values (fp, msg, left(btrim(p_stack), 4000), left(p_screen, 60), p_platform, p_app_version, left(p_os_version, 40), u)
  on conflict (fingerprint, app_version) do update
    set occurrences = private.client_errors.occurrences + 1,
        last_seen = now(),
        -- 고쳤다고 닫아둔 오류가 다시 나면 다시 연다
        resolved_at = null,
        user_id = coalesce(excluded.user_id, private.client_errors.user_id);
end;
$$;
revoke all on function public.report_client_error(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.report_client_error(text, text, text, text, text, text) to anon, authenticated;

-- 어드민 대시보드용. 자주 나는 것부터 본다.
create function public.get_admin_client_errors(p_limit integer default 50, p_include_resolved boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('dashboard', null, null);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'message', e.message, 'stack', e.stack, 'screen', e.screen,
    'platform', e.platform, 'appVersion', e.app_version, 'osVersion', e.os_version,
    'occurrences', e.occurrences, 'firstSeen', e.first_seen, 'lastSeen', e.last_seen,
    'resolvedAt', e.resolved_at) order by e.last_seen desc), '[]'::jsonb)
  into result
  from (
    select * from private.client_errors
    where p_include_resolved or resolved_at is null
    order by last_seen desc limit least(greatest(p_limit, 1), 200)
  ) e;
  return result;
end;
$$;
revoke all on function public.get_admin_client_errors(integer, boolean) from public, anon, authenticated;
grant execute on function public.get_admin_client_errors(integer, boolean) to authenticated;

create function public.resolve_admin_client_error(p_id bigint, p_resolved boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('dashboard', null, null);
  update private.client_errors set resolved_at = case when p_resolved then now() else null end where id = p_id;
  if not found then raise exception 'ERROR_NOT_FOUND'; end if;
end;
$$;
revoke all on function public.resolve_admin_client_error(bigint, boolean) from public, anon, authenticated;
grant execute on function public.resolve_admin_client_error(bigint, boolean) to authenticated;

-- 오래된 기록은 버린다. 안전 점검과 같은 스케줄에 얹는다.
select cron.schedule('gling-client-error-retention', '41 5 * * *',
  $job$ delete from private.client_errors where last_seen < now() - interval '90 days' $job$);
