-- AI 안전 큐 열람도 기존 관리자 감사 로그에 같은 방식으로 남긴다.
alter table public.admin_access_logs drop constraint admin_access_logs_scope_check;
alter table public.admin_access_logs
  add constraint admin_access_logs_scope_check
  check (scope in ('dashboard', 'safety', 'reports', 'users', 'posts', 'comments', 'conversations', 'messages', 'user_detail'));
