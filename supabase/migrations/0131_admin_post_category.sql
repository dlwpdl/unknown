-- Category changes use the existing live AAL2 admin boundary; ordinary writers keep their column grants.
create function public.set_admin_post_category(p_post_id uuid, p_tag_id integer, p_expected_tag_id integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare post public.posts; category public.tags;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into category from public.tags where id = p_tag_id and kind = 'post';
  if not found then raise exception 'INVALID_POST_CATEGORY'; end if;
  select * into post from public.posts where id = p_post_id and status = 'published' and kind = 'story' for update;
  if not found then raise exception 'POST_NOT_FOUND'; end if;
  if post.tag_id is distinct from p_tag_id then
    if p_expected_tag_id is null or post.tag_id is distinct from p_expected_tag_id then
      raise exception 'POST_CATEGORY_CHANGED';
    end if;
    update public.posts set tag_id = p_tag_id where id = p_post_id;
  end if;
  perform public.log_admin_access('posts', null, null);
  return jsonb_build_object('id', p_post_id, 'tag_id', p_tag_id, 'category', category.label);
end;
$$;
revoke all on function public.set_admin_post_category(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.set_admin_post_category(uuid,integer,integer) to authenticated;
notify pgrst, 'reload schema';
