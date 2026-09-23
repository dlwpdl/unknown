-- 신뢰 단계 변경(set_admin_verification_level)도 감사 로그에 남길 수 있도록 scope를 추가한다.
alter table public.admin_access_logs drop constraint admin_access_logs_scope_check;
alter table public.admin_access_logs add constraint admin_access_logs_scope_check check (scope in (
  'analytics','dashboard','safety','reports','users','posts','comments','conversations','messages','user_detail','alerts','evidence','trust_level'));
