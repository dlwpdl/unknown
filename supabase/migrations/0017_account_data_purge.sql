-- 탈퇴 시 사용자 데이터는 삭제하고 같은 인증 계정의 재가입 차단 상태만 남긴다.

alter table public.profiles alter column city_id drop not null;

create or replace function public.delete_my_account(p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  owned_post_ids uuid[];
  affected_comment_ids uuid[];
  conversation_ids uuid[];
  conversation_message_ids uuid[];
  meetup_request_ids uuid[];
  affected_report_ids uuid[];
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_confirmation <> '탈퇴합니다' then raise exception 'CONFIRMATION_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':delete-account', 0));

  select coalesce(array_agg(id), '{}'::uuid[]) into owned_post_ids
  from public.posts where author_id = current_user_id;
  select coalesce(array_agg(id), '{}'::uuid[]) into affected_comment_ids
  from public.comments
  where author_id = current_user_id or post_id = any(owned_post_ids);
  select coalesce(array_agg(id), '{}'::uuid[]) into conversation_ids
  from public.conversations
  where current_user_id in (user_low_id, user_high_id);
  select coalesce(array_agg(id), '{}'::uuid[]) into conversation_message_ids
  from public.messages where conversation_id = any(conversation_ids);
  select coalesce(array_agg(id), '{}'::uuid[]) into meetup_request_ids
  from public.meetup_requests
  where host_id = current_user_id
     or requester_id = current_user_id
     or post_id = any(owned_post_ids);
  select coalesce(array_agg(id), '{}'::uuid[]) into affected_report_ids
  from public.reports
  where current_user_id in (reporter_id, reported_user_id)
     or resolved_by = current_user_id
     or (target_type = 'user' and target_id = current_user_id)
     or (target_type = 'post' and target_id = any(owned_post_ids))
     or (target_type = 'comment' and target_id = any(affected_comment_ids))
     or (target_type = 'message' and target_id = any(conversation_message_ids));

  delete from public.notifications
  where current_user_id in (user_id, actor_id)
     or (target_type = 'user' and target_id = current_user_id)
     or (target_type = 'post' and target_id = any(owned_post_ids))
     or (target_type = 'comment' and target_id = any(affected_comment_ids))
     or (target_type = 'message' and target_id = any(conversation_message_ids))
     or (target_type = 'meetup_request' and target_id = any(meetup_request_ids));

  delete from public.safety_review_queue
  where (target_type = 'post' and target_id = any(owned_post_ids))
     or (target_type = 'comment' and target_id = any(affected_comment_ids))
     or (target_type = 'message' and target_id = any(conversation_message_ids));

  delete from public.moderation_actions
  where report_id = any(affected_report_ids) or actor_id = current_user_id;
  delete from public.reports where id = any(affected_report_ids);
  delete from public.admin_access_logs
  where actor_id = current_user_id or subject_user_id = current_user_id;
  delete from public.meetup_requests where id = any(meetup_request_ids);
  delete from public.blocks where current_user_id in (blocker_id, blocked_id);
  delete from private.action_rate_events where user_id = current_user_id;
  delete from private.ai_draft_usage where user_id = current_user_id;

  delete from public.post_reactions
  where user_id = current_user_id or post_id = any(owned_post_ids);
  delete from public.comment_likes
  where user_id = current_user_id or comment_id = any(affected_comment_ids);

  update public.posts as post
  set view_count = greatest(0, post.view_count - 1)
  where post.author_id <> current_user_id
    and exists (
      select 1 from public.post_views as post_view
      where post_view.post_id = post.id and post_view.user_id = current_user_id
    );
  delete from public.post_views
  where user_id = current_user_id or post_id = any(owned_post_ids);

  update public.posts as post
  set share_count = greatest(0, post.share_count - 1)
  where post.author_id <> current_user_id
    and exists (
      select 1 from public.post_shares as post_share
      where post_share.post_id = post.id and post_share.user_id = current_user_id
    );
  delete from public.post_shares
  where user_id = current_user_id or post_id = any(owned_post_ids);

  update public.comments
  set deleted_at = now()
  where author_id = current_user_id
    and deleted_at is null
    and not (post_id = any(owned_post_ids));
  delete from public.comments where id = any(affected_comment_ids);

  delete from public.messages where conversation_id = any(conversation_ids);
  delete from public.conversations where id = any(conversation_ids);
  delete from public.posts where id = any(owned_post_ids);

  update public.profiles
  set nickname = '탈퇴회원_' || left(replace(current_user_id::text, '-', ''), 8),
      city_id = null,
      neighborhood = null,
      bio = null,
      avatar_path = null,
      verification_level = 1,
      daily_post_limit = 1,
      account_status = 'deleted',
      account_status_note = '사용자 직접 탈퇴',
      account_status_changed_at = now(),
      deleted_at = now(),
      updated_at = now()
  where id = current_user_id;
end;
$$;
