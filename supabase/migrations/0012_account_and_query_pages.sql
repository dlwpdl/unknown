-- 탈퇴·재가입 잠금과 데이터 양에 비례해 느려지지 않는 커서 조회.

alter table public.profiles
add column deleted_at timestamptz;

create function private.lock_account_content(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts set status = 'removed'
  where author_id = p_user_id and status = 'published';
  update public.comments set deleted_at = coalesce(deleted_at, now())
  where author_id = p_user_id;
  update public.meetup_requests set status = 'cancelled', responded_at = now()
  where status = 'pending' and (host_id = p_user_id or requester_id = p_user_id);
end;
$$;

create function public.delete_my_account(p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_confirmation <> '탈퇴합니다' then raise exception 'CONFIRMATION_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':delete-account', 0));
  perform private.lock_account_content(current_user_id);

  delete from public.post_reactions where user_id = current_user_id;
  delete from public.comment_likes where user_id = current_user_id;
  delete from public.post_views where user_id = current_user_id;
  delete from public.notifications where user_id = current_user_id;

  update public.profiles
  set nickname = '탈퇴회원_' || left(replace(current_user_id::text, '-', ''), 8),
      neighborhood = null,
      bio = null,
      avatar_path = null,
      verification_level = 1,
      account_status = 'deleted',
      account_status_note = '사용자 직접 탈퇴',
      account_status_changed_at = now(),
      deleted_at = now(),
      updated_at = now()
  where id = current_user_id;
end;
$$;

create function public.set_account_status(p_user_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_status not in ('active', 'suspended', 'reactivation_pending') then raise exception 'INVALID_ACCOUNT_STATUS'; end if;
  if char_length(coalesce(p_note, '')) > 1000 then raise exception 'INVALID_NOTE'; end if;
  select account_status into current_status from public.profiles where id = p_user_id for update;
  if current_status is null then raise exception 'USER_NOT_FOUND'; end if;
  if current_status = 'deleted' and p_status = 'active' then raise exception 'REACTIVATION_REQUIRED'; end if;
  if p_status = 'reactivation_pending' and current_status <> 'deleted' then raise exception 'INVALID_ACCOUNT_TRANSITION'; end if;

  update public.profiles
  set account_status = p_status,
      account_status_note = nullif(trim(p_note), ''),
      account_status_changed_at = now(),
      updated_at = now()
  where id = p_user_id;
  if p_status = 'suspended' then perform private.lock_account_content(p_user_id); end if;
end;
$$;

create function public.reactivate_profile(p_nickname text, p_city_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(trim(coalesce(p_nickname, ''))) not between 2 and 20 then raise exception 'INVALID_NICKNAME'; end if;
  if not exists (select 1 from public.cities where id = p_city_id and is_open) then raise exception 'CITY_NOT_OPEN'; end if;
  update public.profiles
  set nickname = trim(p_nickname),
      city_id = p_city_id,
      account_status = 'active',
      account_status_note = null,
      account_status_changed_at = now(),
      deleted_at = null,
      updated_at = now()
  where id = current_user_id and account_status = 'reactivation_pending';
  if not found then raise exception 'REACTIVATION_NOT_ALLOWED'; end if;
end;
$$;

-- 관리자 차단은 기존 콘텐츠를 공개 피드에서 내리고 사용자 알림을 남긴다.
create or replace function public.moderate_report(p_report_id uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  report public.reports;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_action not in ('dismissed', 'warned', 'blocked') then raise exception 'INVALID_ACTION'; end if;
  if char_length(coalesce(p_note, '')) > 1000 then raise exception 'INVALID_NOTE'; end if;
  select * into report from public.reports where id = p_report_id and status = 'open' for update;
  if report is null then raise exception 'OPEN_REPORT_NOT_FOUND'; end if;

  update public.reports
  set status = case when p_action = 'dismissed' then 'dismissed' else 'actioned' end,
      resolved_at = now(), resolved_by = current_user_id
  where id = report.id;
  insert into public.moderation_actions (report_id, actor_id, action, note)
  values (report.id, current_user_id, p_action, nullif(trim(p_note), ''));

  if p_action = 'warned' then
    perform private.create_notification(
      report.reported_user_id, 'moderation_warning', current_user_id, 'user', report.reported_user_id,
      coalesce(nullif(trim(p_note), ''), '커뮤니티 운영 정책에 따라 경고를 받았습니다.'), '/profile/guidelines'
    );
  elsif p_action = 'blocked' then
    update public.profiles
    set account_status = 'suspended', account_status_note = nullif(trim(p_note), ''), account_status_changed_at = now()
    where id = report.reported_user_id;
    perform private.lock_account_content(report.reported_user_id);
    perform private.create_notification(
      report.reported_user_id, 'moderation_blocked', current_user_id, 'user', report.reported_user_id,
      coalesce(nullif(trim(p_note), ''), '커뮤니티 운영 정책에 따라 계정 이용이 제한됐습니다.'), '/profile/settings'
    );
  end if;
end;
$$;

-- 삭제·정지 계정은 과거 대화 상대와 관리자에게만 최소 프로필이 보인다.
drop policy "authenticated users read profiles" on public.profiles;
create policy "authenticated users read profiles"
on public.profiles for select to authenticated
using (
  account_status = 'active'
  or id = (select auth.uid())
  or (select private.is_admin())
  or exists (
    select 1 from public.conversations
    where (user_low_id = (select auth.uid()) and user_high_id = profiles.id)
       or (user_high_id = (select auth.uid()) and user_low_id = profiles.id)
  )
);

drop policy "users update own profile" on public.profiles;
create policy "users update own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id and account_status = 'active')
with check ((select auth.uid()) = id and account_status = 'active');

drop policy "users update own posts" on public.posts;
create policy "users update own posts"
on public.posts for update to authenticated
using (author_id = (select auth.uid()) and private.is_active_account((select auth.uid())))
with check (author_id = (select auth.uid()) and private.is_active_account((select auth.uid())));

drop policy "users update own comments" on public.comments;
create policy "users update own comments"
on public.comments for update to authenticated
using (author_id = (select auth.uid()) and private.is_active_account((select auth.uid())))
with check (author_id = (select auth.uid()) and private.is_active_account((select auth.uid())));

drop policy "users create own post reactions" on public.post_reactions;
create policy "users create own post reactions"
on public.post_reactions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and private.is_active_account((select auth.uid()))
  and exists (select 1 from public.posts where posts.id = post_reactions.post_id and posts.status = 'published')
);
drop policy "users delete own post reactions" on public.post_reactions;
create policy "users delete own post reactions"
on public.post_reactions for delete to authenticated
using (user_id = (select auth.uid()) and private.is_active_account((select auth.uid())));

drop policy "users create own comment likes" on public.comment_likes;
create policy "users create own comment likes"
on public.comment_likes for insert to authenticated
with check (
  user_id = (select auth.uid())
  and private.is_active_account((select auth.uid()))
  and exists (select 1 from public.comments where comments.id = comment_likes.comment_id and comments.deleted_at is null)
);
drop policy "users delete own comment likes" on public.comment_likes;
create policy "users delete own comment likes"
on public.comment_likes for delete to authenticated
using (user_id = (select auth.uid()) and private.is_active_account((select auth.uid())));

drop policy "users create own blocks" on public.blocks;
create policy "users create own blocks"
on public.blocks for insert to authenticated
with check (blocker_id = (select auth.uid()) and private.is_active_account((select auth.uid())));
drop policy "users delete own blocks" on public.blocks;
create policy "users delete own blocks"
on public.blocks for delete to authenticated
using (blocker_id = (select auth.uid()) and private.is_active_account((select auth.uid())));

create extension if not exists pg_trgm with schema extensions;
create index posts_search_trgm_idx
  on public.posts using gin ((title || ' ' || body) extensions.gin_trgm_ops)
  where status = 'published';

create function public.get_public_feed_page(
  p_city_id text,
  p_tag_id smallint default null,
  p_query text default null,
  p_before_created timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid, city_id text, title text, body text, hashtags text[], image_paths text[],
  room_preview jsonb, created_at timestamptz, like_count integer, view_count integer,
  comment_count integer, save_count integer, share_count integer, liked_by_me boolean,
  saved_by_me boolean, author_id uuid, author_nickname text, author_neighborhood text,
  author_verification_level smallint, tag_id smallint, tag_slug text, tag_label text, tag_kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    post.id, post.city_id, post.title, post.body, post.hashtags, post.image_paths,
    post.room_preview, post.created_at, post.like_count, post.view_count,
    post.comment_count, post.save_count, post.share_count,
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'like'),
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'save'),
    profile.id, profile.nickname::text, profile.neighborhood, profile.verification_level,
    tag.id, tag.slug, tag.label, tag.kind
  from public.posts as post
  join public.profiles as profile on profile.id = post.author_id and profile.account_status = 'active'
  join public.tags as tag on tag.id = post.tag_id
  where post.status = 'published'
    and post.city_id = p_city_id
    and (p_tag_id is null or post.tag_id = p_tag_id)
    and (
      nullif(trim(coalesce(p_query, '')), '') is null
      or (post.title || ' ' || post.body) ilike '%' || trim(p_query) || '%'
      or exists (select 1 from unnest(post.hashtags) as hashtag where hashtag ilike '%' || trim(p_query) || '%')
    )
    and (p_before_created is null or (post.created_at, post.id) < (p_before_created, p_before_id))
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id))
  order by post.created_at desc, post.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

create function public.get_public_comments_page(
  p_post_id uuid,
  p_before_created timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid, post_id uuid, author_id uuid, body text, like_count integer,
  liked_by_me boolean, created_at timestamptz, author_nickname text,
  author_verification_level smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    comment.id, comment.post_id, comment.author_id, comment.body, comment.like_count,
    exists (select 1 from public.comment_likes where comment_id = comment.id and user_id = auth.uid()),
    comment.created_at, profile.nickname::text, profile.verification_level
  from public.comments as comment
  join public.posts as post on post.id = comment.post_id
  join public.profiles as profile on profile.id = comment.author_id
  where comment.post_id = p_post_id
    and comment.deleted_at is null
    and post.status = 'published'
    and (p_before_created is null or (comment.created_at, comment.id) < (p_before_created, p_before_id))
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(), comment.author_id))
  order by comment.created_at desc, comment.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

create function public.get_saved_posts(
  p_before_created timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid, city_id text, title text, body text, hashtags text[], image_paths text[],
  room_preview jsonb, created_at timestamptz, like_count integer, view_count integer,
  comment_count integer, save_count integer, share_count integer, liked_by_me boolean,
  saved_by_me boolean, author_id uuid, author_nickname text, author_neighborhood text,
  author_verification_level smallint, tag_id smallint, tag_slug text, tag_label text, tag_kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    post.id, post.city_id, post.title, post.body, post.hashtags, post.image_paths,
    post.room_preview, post.created_at, post.like_count, post.view_count,
    post.comment_count, post.save_count, post.share_count,
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'like'),
    true,
    profile.id, profile.nickname::text, profile.neighborhood, profile.verification_level,
    tag.id, tag.slug, tag.label, tag.kind
  from public.post_reactions as saved
  join public.posts as post on post.id = saved.post_id and post.status = 'published'
  join public.profiles as profile on profile.id = post.author_id and profile.account_status = 'active'
  join public.tags as tag on tag.id = post.tag_id
  where saved.user_id = auth.uid() and saved.kind = 'save'
    and (p_before_created is null or (post.created_at, post.id) < (p_before_created, p_before_id))
    and not private.is_blocked_between(auth.uid(), post.author_id)
  order by post.created_at desc, post.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

create function public.get_conversation_previews(
  p_limit integer default 30,
  p_before_created timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid, other_user_id uuid, other_nickname text, other_verification_level smallint,
  latest_body text, latest_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation.id,
    other_profile.id,
    other_profile.nickname::text,
    other_profile.verification_level,
    latest.body,
    coalesce(latest.created_at, conversation.created_at) as latest_at
  from public.conversations as conversation
  join public.profiles as other_profile on other_profile.id = case
    when conversation.user_low_id = auth.uid() then conversation.user_high_id
    else conversation.user_low_id
  end
  left join lateral (
    select message.body, message.created_at
    from public.messages as message
    where message.conversation_id = conversation.id
    order by message.created_at desc, message.id desc
    limit 1
  ) latest on true
  where auth.uid() in (conversation.user_low_id, conversation.user_high_id)
    and (
      p_before_created is null
      or (coalesce(latest.created_at, conversation.created_at), conversation.id) < (p_before_created, p_before_id)
    )
  order by latest_at desc, conversation.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

revoke execute on function private.lock_account_content(uuid) from public, anon, authenticated;
revoke execute on function public.delete_my_account(text) from public, anon, authenticated;
revoke execute on function public.set_account_status(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.reactivate_profile(text, text) from public, anon, authenticated;
revoke execute on function public.get_public_feed_page(text, smallint, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke execute on function public.get_public_comments_page(uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke execute on function public.get_saved_posts(timestamptz, uuid, integer) from public, anon, authenticated;
revoke execute on function public.get_conversation_previews(integer, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.delete_my_account(text) to authenticated;
grant execute on function public.set_account_status(uuid, text, text) to authenticated;
grant execute on function public.reactivate_profile(text, text) to authenticated;
grant execute on function public.get_public_feed_page(text, smallint, text, timestamptz, uuid, integer) to anon, authenticated;
grant execute on function public.get_public_comments_page(uuid, timestamptz, uuid, integer) to anon, authenticated;
grant execute on function public.get_saved_posts(timestamptz, uuid, integer) to authenticated;
grant execute on function public.get_conversation_previews(integer, timestamptz, uuid) to authenticated;
