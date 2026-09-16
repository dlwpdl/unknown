-- 어드민이 조정할 수 있는 값에 공감수·저장수를 더한다. 조회수와 같은 이유로, 이 값들도
-- "지금 뜨는 글" 점수에 들어가므로 작성자에게는 열지 않고 대시보드에서만 만진다.
create or replace function public.set_admin_post_fields(p_post_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  updated public.posts;
  counter text;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID_POST_PATCH'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) key
             where key not in ('view_count','like_count','save_count','sort_at','hashtags','status'))
  then raise exception 'INVALID_POST_PATCH'; end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('published','removed') then
    raise exception 'INVALID_POST_STATUS';
  end if;
  foreach counter in array array['view_count','like_count','save_count'] loop
    if p_patch ? counter and ((p_patch->>counter)::bigint < 0 or (p_patch->>counter)::bigint > 100000000) then
      raise exception 'INVALID_POST_COUNTER';
    end if;
  end loop;
  if p_patch ? 'hashtags' and (jsonb_typeof(p_patch->'hashtags') <> 'array' or jsonb_array_length(p_patch->'hashtags') > 20) then
    raise exception 'INVALID_POST_HASHTAGS';
  end if;
  perform public.log_admin_access('posts', null, null);

  update public.posts p set
    view_count = coalesce((p_patch->>'view_count')::integer, p.view_count),
    like_count = coalesce((p_patch->>'like_count')::integer, p.like_count),
    save_count = coalesce((p_patch->>'save_count')::integer, p.save_count),
    sort_at = coalesce((p_patch->>'sort_at')::timestamptz, p.sort_at),
    hashtags = coalesce((select array_agg(value) from jsonb_array_elements_text(p_patch->'hashtags')), p.hashtags),
    status = coalesce(p_patch->>'status', p.status),
    deleted_at = case
      when p_patch->>'status' = 'removed' then now()
      when p_patch->>'status' = 'published' then null
      else p.deleted_at end
  where p.id = p_post_id
  returning p.* into updated;
  if not found then raise exception 'POST_NOT_FOUND'; end if;

  -- 점수에 들어가는 값이 바뀌면 이미 보낸 기록을 지워 다시 알림 후보가 되게 한다.
  if p_patch ?| array['view_count','like_count','save_count','sort_at'] then
    delete from private.trending_sent where post_id = p_post_id;
  end if;

  return jsonb_build_object('id', updated.id, 'status', updated.status, 'viewCount', updated.view_count,
    'likeCount', updated.like_count, 'saveCount', updated.save_count,
    'sortAt', updated.sort_at, 'hashtags', to_jsonb(updated.hashtags), 'deletedAt', updated.deleted_at);
end;
$$;
revoke all on function public.set_admin_post_fields(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_admin_post_fields(uuid, jsonb) to authenticated;
