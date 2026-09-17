-- 비로그인에서도 보고가 된다 (로그인 전에 죽는 경우가 가장 흔하다)
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select public.report_client_error('Cannot read property x of undefined','at Feed (feed.tsx:12)\nat render','feed','ios','1.0.1(23)','iOS 26.5');
select public.report_client_error('Cannot read property x of undefined','at Feed (feed.tsx:12)\nat render','feed','ios','1.0.1(23)','iOS 26.5');
reset role;
do $$ begin
  assert (select count(*) from private.client_errors)=1,'the same error collapses into one row';
  assert (select occurrences from private.client_errors)=2,'and counts occurrences';
end $$;

-- 메시지 속 값이 달라도 같은 오류로 묶인다
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select public.report_client_error('Row 481 missing','at Feed (feed.tsx:12)','feed','ios','1.0.1(23)');
select public.report_client_error('Row 992 missing','at Feed (feed.tsx:12)','feed','ios','1.0.1(23)');
reset role;
do $$ begin
  assert (select occurrences from private.client_errors where message like 'Row%')=2,
    'numbers in the message do not split one error into many';
end $$;

-- 버전이 다르면 따로 센다 (고쳤는지 보려면 버전별로 봐야 한다)
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select public.report_client_error('Cannot read property x of undefined','at Feed (feed.tsx:12)\nat render','feed','ios','1.0.1(24)','iOS 26.5');
reset role;
do $$ begin
  assert (select count(*) from private.client_errors)=3,'a new build tracks separately';
end $$;

-- 쓰레기 입력은 조용히 버린다
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select public.report_client_error('','x','feed','ios','1.0.1(23)');
select public.report_client_error('실제오류','x','feed','windows','1.0.1(23)');
select public.report_client_error('실제오류','x','feed','ios','"; drop table--');
reset role;
do $$ begin
  assert (select count(*) from private.client_errors)=3,'blank, unknown platform and bad version are dropped';
end $$;

-- 클라이언트가 표를 직접 못 읽는다 (스택에 사용자 내용이 섞일 수 있다)
select set_config('request.jwt.claims','{"sub":"cb270ce5-ef84-47a0-b3b3-93380afc4d1d","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin perform 1 from private.client_errors;
    raise exception 'direct reads must be refused';
  exception when insufficient_privilege then null; end;
end $$;
-- 어드민이 아니면 조회 RPC 도 막힌다
select set_config('request.jwt.claims','{"sub":"cb270ce5-ef84-47a0-b3b3-93380afc4d1d","role":"authenticated"}',true);
do $$ begin
  begin perform public.get_admin_client_errors();
    raise exception 'non-admin must be refused';
  exception when sqlstate 'P0001' then if sqlerrm <> 'ADMIN_REQUIRED' then raise; end if; end;
end $$;
reset role;

-- 어드민은 보고 닫을 수 있고, 다시 나면 열린다
select set_config('request.jwt.claims','{"sub":"cb270ce5-ef84-47a0-b3b3-93380afc4d1d","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
do $$
declare rows jsonb; target bigint;
begin
  rows := public.get_admin_client_errors(50, false);
  assert jsonb_array_length(rows) = 3, 'the admin sees every open error';
  target := ((rows->0)->>'id')::bigint;
  perform public.resolve_admin_client_error(target, true);
  assert jsonb_array_length(public.get_admin_client_errors(50, false)) = 2, 'a resolved error leaves the list';
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select public.report_client_error('Cannot read property x of undefined','at Feed (feed.tsx:12)\nat render','feed','ios','1.0.1(24)','iOS 26.5');
reset role;
do $$ begin
  assert (select resolved_at is null from private.client_errors where app_version='1.0.1(24)'),
    'an error that comes back reopens itself';
end $$;

select 'CLIENT ERROR CHECKS PASSED' as result;
