-- Storage 정리 재시도를 위해 탈퇴 RPC를 멱등하게 만들고 탈퇴 계정의 새 업로드를 막는다.

alter function public.delete_my_account(text) set schema private;
alter function private.delete_my_account(text) rename to purge_account_data;

revoke all on function private.purge_account_data(text) from public, anon, authenticated;

create function public.delete_my_account(p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_status text;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_confirmation <> '탈퇴합니다' then raise exception 'CONFIRMATION_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':delete-account', 0));
  select account_status into current_status
  from public.profiles where id = current_user_id for update;
  if current_status = 'deleted' then return; end if;
  if current_status is distinct from 'active' then raise exception 'ACCOUNT_LOCKED'; end if;
  perform private.purge_account_data(p_confirmation);
end;
$$;

revoke all on function public.delete_my_account(text) from public, anon, authenticated;
grant execute on function public.delete_my_account(text) to authenticated;

drop policy "users upload to own image folder" on storage.objects;
create policy "users upload to own image folder"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('avatars', 'post-images')
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.is_active_account((select auth.uid()))
);

drop policy "users update own image objects" on storage.objects;
create policy "users update own image objects"
on storage.objects for update to authenticated
using (
  bucket_id in ('avatars', 'post-images')
  and owner_id = (select auth.uid())::text
  and private.is_active_account((select auth.uid()))
)
with check (
  bucket_id in ('avatars', 'post-images')
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.is_active_account((select auth.uid()))
);
