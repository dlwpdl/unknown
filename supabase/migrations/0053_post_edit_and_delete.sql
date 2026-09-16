-- 글 수정·삭제는 작성자가 앱에서, 노출에 영향을 주는 값은 어드민만.
--
-- 작성자가 직접 쓸 수 있는 컬럼은 이미 title, body, image_paths, status 로 제한돼 있어
-- 조회수·정렬 시각·해시태그는 클라이언트에서 손댈 수 없다. 그래서 이 파일이 하는 일은 셋이다.
--   1. 운영이 내린 글을 작성자가 다시 올리지 못하게 한다
--   2. 수정으로 들어온 감시어가 검사를 빠져나가지 못하게 한다 (검사가 새 글에만 걸려 있었다)
--   3. 조회수·노출 순서·해시태그를 어드민이 대시보드에서 조정할 통로를 연다

-- 작성자가 지운 글과 운영이 내린 글을 구분한다. 둘 다 status='removed' 로 피드에서 빠진다.
-- 작성자에게 쓰기 권한을 주지 않고 트리거가 대신 찍는다.
alter table public.posts add column deleted_at timestamptz;

-- SECURITY INVOKER 여야 한다. DEFINER 로 두면 current_user 가 항상 함수 소유자라
-- "PostgREST 로 들어온 작성자인지" 구분이 되지 않는다.
create function private.guard_post_status_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- 끌어올리기·거래상태·계정 정리 같은 서버 RPC 는 SECURITY DEFINER 라 소유자 권한으로 돌고,
  -- 그때 current_user 는 'authenticated' 가 아니다. 앱에서 직접 들어온 수정만 제한한다.
  if current_user <> 'authenticated' or private.is_admin() then return new; end if;
  if new.status is distinct from old.status then
    -- 되돌리기는 어드민만 한다. 아니면 운영이 내린 글을 작성자가 되살릴 수 있다.
    if not (old.status = 'published' and new.status = 'removed') then
      raise exception 'POST_RESTORE_NOT_ALLOWED';
    end if;
    new.deleted_at := now();
  end if;
  return new;
end;
$$;

create trigger posts_guard_status_change before update of status on public.posts
  for each row execute function private.guard_post_status_change();

-- 수정된 본문도 감시어 검사를 받는다. 본문 수정은 예전부터 가능했지만 검사는 INSERT 에만 걸려 있어서,
-- 깨끗한 글을 올린 뒤 고치면 그대로 지나갔다. 안전 검토(posts_safety_review)는 이미 수정에도 돈다.
drop trigger if exists posts_watch_terms on public.posts;
create trigger posts_watch_terms after insert or update of title, body on public.posts
  for each row execute function private.scan_watch_terms();
drop trigger if exists comments_watch_terms on public.comments;
create trigger comments_watch_terms after insert or update of body on public.comments
  for each row execute function private.scan_watch_terms();

-- 이미 경보가 있는 대상을 고쳐 새 표현이 들어오면 경보를 되살린다.
-- 예전에는 on conflict do nothing 이라 수정으로 들어온 표현을 놓쳤다.
create or replace function private.scan_watch_terms() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_json jsonb := to_jsonb(new);
  content text := concat_ws(' ', row_json->>'title', new.body);
  compact text := regexp_replace(lower(normalize(coalesce(content,''), NFKC)), '[[:space:][:punct:]]+', '', 'g');
  hits text[]; top_severity text; top_category text; author uuid; conv uuid;
  target text := case tg_table_name when 'posts' then 'post' when 'comments' then 'comment' else 'message' end;
  raised boolean;
begin
  select array_agg(term order by case severity when 'critical' then 0 when 'high' then 1 else 2 end, term),
         (array_agg(severity order by case severity when 'critical' then 0 when 'high' then 1 else 2 end))[1],
         (array_agg(category order by case severity when 'critical' then 0 when 'high' then 1 else 2 end))[1]
  into hits, top_severity, top_category
  from private.watch_terms w where w.active and position(regexp_replace(lower(w.term), '[[:space:][:punct:]]+', '', 'g') in compact) > 0;
  if hits is null then return new; end if;
  author := coalesce((row_json->>'sender_id')::uuid, (row_json->>'author_id')::uuid);
  conv := (row_json->>'conversation_id')::uuid;

  insert into public.safety_alerts (target_type, target_id, author_id, conversation_id, category, severity, matched_terms, excerpt)
  values (target, new.id, author, conv, top_category, top_severity, hits, left(content, 600))
  on conflict (target_type, target_id) do update
    set category = excluded.category, severity = excluded.severity,
        matched_terms = excluded.matched_terms, excerpt = excluded.excerpt,
        status = case when public.safety_alerts.matched_terms is distinct from excluded.matched_terms
                 then 'open' else public.safety_alerts.status end
  returning (status = 'open') into raised;
  if not raised then return new; end if;

  insert into public.notifications (user_id, kind, target_type, target_id, body, route)
  select profile.id, 'safety_alert', target, new.id,
    case top_severity when 'critical' then '감시어(긴급)가 포함된 콘텐츠가 올라왔어요. 즉시 확인이 필요합니다.' else '감시어가 포함된 콘텐츠가 올라왔어요. 확인해 주세요.' end,
    '/admin?alert=1'
  from public.profiles profile join auth.users u on u.id = profile.id
  where u.raw_app_meta_data->>'role' = 'admin' and profile.account_status = 'active';
  return new;
end;
$$;

-- 노출을 좌우하는 값은 어드민만 조정한다.
--   view_count  조회수 보정
--   sort_at     피드 순서 (미래 시각이면 위로 고정, 과거로 미루면 아래로)
--   hashtags    해시태그 정리
--   status      내리기·되돌리기 (작성자는 내리기만 된다)
-- 어드민은 RLS 상 남의 글을 직접 고칠 수 없어 이 통로로만 들어오고, 호출은 감사 기록에 남는다.
create function public.set_admin_post_fields(p_post_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  updated public.posts;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID_POST_PATCH'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) key
             where key not in ('view_count','sort_at','hashtags','status'))
  then raise exception 'INVALID_POST_PATCH'; end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('published','removed') then
    raise exception 'INVALID_POST_STATUS';
  end if;
  if p_patch ? 'view_count' and ((p_patch->>'view_count')::bigint < 0 or (p_patch->>'view_count')::bigint > 100000000) then
    raise exception 'INVALID_POST_VIEW_COUNT';
  end if;
  if p_patch ? 'hashtags' and (jsonb_typeof(p_patch->'hashtags') <> 'array' or jsonb_array_length(p_patch->'hashtags') > 20) then
    raise exception 'INVALID_POST_HASHTAGS';
  end if;
  perform public.log_admin_access('posts', null, null);

  update public.posts p set
    view_count = coalesce((p_patch->>'view_count')::integer, p.view_count),
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

  return jsonb_build_object('id', updated.id, 'status', updated.status, 'viewCount', updated.view_count,
    'sortAt', updated.sort_at, 'hashtags', to_jsonb(updated.hashtags), 'deletedAt', updated.deleted_at);
end;
$$;
revoke all on function public.set_admin_post_fields(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_admin_post_fields(uuid, jsonb) to authenticated;
