-- 관리자 웹 열람 감사 로그. 콘텐츠 조회 범위는 ADR-0001에 따라 전체를 유지한다.

create table public.admin_access_logs (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  scope text not null check (
    scope in ('dashboard', 'reports', 'users', 'posts', 'comments', 'conversations', 'messages', 'user_detail')
  ),
  subject_user_id uuid,
  resource_id uuid,
  created_at timestamptz not null default now()
);

create index admin_access_logs_actor_idx
  on public.admin_access_logs (actor_id, created_at desc);
create index admin_access_logs_subject_idx
  on public.admin_access_logs (subject_user_id, created_at desc)
  where subject_user_id is not null;

alter table public.admin_access_logs enable row level security;
revoke all on public.admin_access_logs from anon, authenticated;
revoke all on sequence public.admin_access_logs_id_seq from anon, authenticated;
grant select on public.admin_access_logs to authenticated;

create policy "admins read admin access logs"
on public.admin_access_logs for select to authenticated
using ((select private.is_admin()));

create function public.log_admin_access(
  scope text,
  subject_user_id uuid default null,
  resource_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  insert into public.admin_access_logs (actor_id, scope, subject_user_id, resource_id)
  values (auth.uid(), scope, subject_user_id, resource_id);
end;
$$;

revoke execute on function public.log_admin_access(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.log_admin_access(text, uuid, uuid) to authenticated;
