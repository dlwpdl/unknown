-- Onboarding uploads the optional avatar before creating the consented profile.
create function private.can_upload_onboarding_avatar(user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select user_id = (select auth.uid())
    and exists(select 1 from auth.users u where u.id = user_id)
    and not exists(select 1 from public.profiles p where p.id = user_id);
$$;
alter function private.can_upload_onboarding_avatar(uuid) owner to postgres;
revoke all on function private.can_upload_onboarding_avatar(uuid) from public, anon, authenticated, service_role;
grant execute on function private.can_upload_onboarding_avatar(uuid) to authenticated;

alter policy "users upload to own image folder" on storage.objects
with check (
  bucket_id in ('avatars', 'post-images')
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (private.is_active_account((select auth.uid()))
    or (bucket_id = 'avatars' and private.can_upload_onboarding_avatar((select auth.uid()))))
  and (bucket_id <> 'post-images' or not public.is_merchant_post_image_bound(name))
);

alter policy "users update own image objects" on storage.objects
using (
  bucket_id in ('avatars', 'post-images')
  and owner_id = (select auth.uid())::text
  and (private.is_active_account((select auth.uid()))
    or (bucket_id = 'avatars' and private.can_upload_onboarding_avatar((select auth.uid()))))
  and (bucket_id <> 'post-images' or not public.is_merchant_post_image_bound(name))
)
with check (
  bucket_id in ('avatars', 'post-images')
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (private.is_active_account((select auth.uid()))
    or (bucket_id = 'avatars' and private.can_upload_onboarding_avatar((select auth.uid()))))
  and (bucket_id <> 'post-images' or not public.is_merchant_post_image_bound(name))
);
