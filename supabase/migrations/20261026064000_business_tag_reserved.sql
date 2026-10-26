-- 비즈니스 is for business profiles: people can't file their own posts there (owner 2026-10-26).
-- Business profiles publish through publish_merchant_workspace_draft; the admin account still posts vendor intros as a person.
create or replace function private.assert_personal_post_tag(p_tag_id smallint) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if exists(select 1 from public.tags where id=p_tag_id and slug='business' and kind='post') and not private.is_admin_id(auth.uid())
  then raise exception 'BUSINESS_TAG_RESERVED'; end if;
end $$;
revoke all on function private.assert_personal_post_tag(smallint) from public,anon,authenticated;

-- create_post_with_poll calls create_post, so this one entry point covers both.
create or replace function public.create_post(p_city_id text, p_tag_id smallint, p_title text, p_body text, p_hashtags text[] default '{}'::text[], p_image_paths text[] default '{}'::text[], p_room_preview jsonb default null::jsonb, p_kind text default 'story'::text, p_price numeric default null::numeric)
returns uuid language sql security definer set search_path='' as $$
  select private.assert_personal_post_tag(p_tag_id);
  select private.create_merchant_content_post(p_city_id,p_tag_id,p_title,p_body,p_hashtags,p_image_paths,p_room_preview,p_kind,p_price,'{}');
$$;
