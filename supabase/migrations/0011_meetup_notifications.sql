-- 승인형 모임 신청, 인앱 알림, 관리자 경고·차단 조치.

alter table public.profiles
add column account_status_note text check (char_length(account_status_note) <= 1000),
add column account_status_changed_at timestamptz not null default now();

create table public.meetup_requests (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  host_id uuid not null references public.profiles(id),
  requester_id uuid not null references public.profiles(id),
  message text not null default '' check (char_length(message) <= 300),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (post_id, requester_id),
  check (host_id <> requester_id)
);

create index meetup_requests_host_pending_idx
  on public.meetup_requests (host_id, created_at desc)
  where status = 'pending';
create index meetup_requests_requester_idx
  on public.meetup_requests (requester_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  kind text not null check (kind in (
    'comment', 'post_like', 'message', 'meetup_request',
    'meetup_approved', 'meetup_rejected',
    'moderation_warning', 'moderation_blocked'
  )),
  actor_id uuid references public.profiles(id),
  target_type text not null check (target_type in ('post', 'comment', 'message', 'meetup_request', 'user')),
  target_id uuid not null,
  body text not null check (char_length(body) between 1 and 300),
  route text check (char_length(route) <= 500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;
create index notifications_user_history_idx
  on public.notifications (user_id, created_at desc, id desc);

alter table public.meetup_requests enable row level security;
alter table public.notifications enable row level security;
revoke all on public.meetup_requests, public.notifications from anon, authenticated;
grant select on public.meetup_requests, public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "participants and admins read meetup requests"
on public.meetup_requests for select to authenticated
using (
  requester_id = (select auth.uid())
  or host_id = (select auth.uid())
  or (select private.is_admin())
);

create policy "users read own notifications"
on public.notifications for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy "users mark own notifications read"
on public.notifications for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create function private.create_notification(
  p_user_id uuid,
  p_kind text,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_body text,
  p_route text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_id uuid;
begin
  if p_user_id is null or p_user_id = p_actor_id then return null; end if;
  insert into public.notifications (user_id, kind, actor_id, target_type, target_id, body, route)
  values (p_user_id, p_kind, p_actor_id, p_target_type, p_target_id, left(trim(p_body), 300), p_route)
  returning id into notification_id;
  return notification_id;
end;
$$;

create function private.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient uuid;
  nickname text;
begin
  select post.author_id into recipient from public.posts as post where post.id = new.post_id;
  select profile.nickname::text into nickname from public.profiles as profile where profile.id = new.author_id;
  perform private.create_notification(
    recipient, 'comment', new.author_id, 'comment', new.id,
    nickname || '님이 내 글에 댓글을 남겼어요.', '/post/' || new.post_id::text
  );
  return new;
end;
$$;

create function private.notify_post_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient uuid;
  nickname text;
begin
  if new.kind <> 'like' then return new; end if;
  select post.author_id into recipient from public.posts as post where post.id = new.post_id;
  select profile.nickname::text into nickname from public.profiles as profile where profile.id = new.user_id;
  perform private.create_notification(
    recipient, 'post_like', new.user_id, 'post', new.post_id,
    nickname || '님이 내 글에 공감했어요.', '/post/' || new.post_id::text
  );
  return new;
end;
$$;

create function private.notify_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation public.conversations;
  recipient uuid;
  nickname text;
begin
  select * into conversation from public.conversations where id = new.conversation_id;
  recipient := case when conversation.user_low_id = new.sender_id then conversation.user_high_id else conversation.user_low_id end;
  select profile.nickname::text into nickname from public.profiles as profile where profile.id = new.sender_id;
  perform private.create_notification(
    recipient, 'message', new.sender_id, 'message', new.id,
    nickname || '님이 메시지를 보냈어요.', '/chat?conversationId=' || new.conversation_id::text
  );
  return new;
end;
$$;

create trigger comments_notification
after insert on public.comments
for each row execute function private.notify_comment();
create trigger post_likes_notification
after insert on public.post_reactions
for each row execute function private.notify_post_like();
create trigger messages_notification
after insert on public.messages
for each row execute function private.notify_message();

create function public.request_meetup_join(p_post_id uuid, p_message text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  meetup public.posts;
  request public.meetup_requests;
  requester_level smallint;
  capacity integer;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  if char_length(trim(coalesce(p_message, ''))) > 300 then raise exception 'INVALID_REQUEST_MESSAGE'; end if;

  select * into meetup from public.posts
  where id = p_post_id and status = 'published' and room_preview is not null
  for update;
  if meetup is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if meetup.author_id = current_user_id then raise exception 'OWN_MEETUP'; end if;
  if private.is_blocked_between(current_user_id, meetup.author_id) then raise exception 'BLOCKED'; end if;
  select verification_level into requester_level from public.profiles where id = current_user_id;
  if coalesce((meetup.room_preview ->> 'verifiedOnly')::boolean, false) and requester_level < 2 then
    raise exception 'VERIFICATION_REQUIRED';
  end if;

  select * into request from public.meetup_requests
  where post_id = p_post_id and requester_id = current_user_id;
  if request.id is not null then
    if request.status in ('pending', 'approved') then return request.id; end if;
    if request.created_at > now() - interval '24 hours' then raise exception 'REQUEST_COOLDOWN'; end if;
  end if;

  capacity := coalesce((meetup.room_preview ->> 'capacity')::integer, 8);
  if 1 + (select count(*) from public.meetup_requests where post_id = p_post_id and status = 'approved') >= capacity then
    raise exception 'MEETUP_FULL';
  end if;
  perform private.enforce_rate_limit('meetup_request', 5, interval '1 day', interval '60 seconds');

  insert into public.meetup_requests (post_id, host_id, requester_id, message)
  values (p_post_id, meetup.author_id, current_user_id, trim(coalesce(p_message, '')))
  on conflict (post_id, requester_id) do update
  set status = 'pending', message = excluded.message, created_at = now(), responded_at = null
  returning * into request;

  perform private.create_notification(
    meetup.author_id, 'meetup_request', current_user_id, 'meetup_request', request.id,
    (select nickname::text from public.profiles where id = current_user_id) || '님이 모임 참여를 요청했어요.',
    '/chat?requestId=' || request.id::text
  );
  return request.id;
end;
$$;

create function public.respond_meetup_request(p_request_id uuid, p_response text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  request public.meetup_requests;
  meetup public.posts;
  conversation_id uuid;
  low_user_id uuid;
  high_user_id uuid;
  capacity integer;
  approved_count integer;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  if p_response not in ('approved', 'rejected') then raise exception 'INVALID_RESPONSE'; end if;

  select * into request from public.meetup_requests where id = p_request_id for update;
  if request is null or request.host_id <> current_user_id then raise exception 'REQUEST_NOT_FOUND'; end if;
  if request.status <> 'pending' then raise exception 'REQUEST_ALREADY_RESOLVED'; end if;
  select * into meetup from public.posts where id = request.post_id and status = 'published' for update;
  if meetup is null then raise exception 'MEETUP_NOT_FOUND'; end if;

  if p_response = 'approved' then
    capacity := coalesce((meetup.room_preview ->> 'capacity')::integer, 8);
    select count(*) into approved_count from public.meetup_requests where post_id = meetup.id and status = 'approved';
    if approved_count + 1 >= capacity then raise exception 'MEETUP_FULL'; end if;
    update public.meetup_requests set status = 'approved', responded_at = now() where id = request.id;

    low_user_id := least(request.host_id, request.requester_id);
    high_user_id := greatest(request.host_id, request.requester_id);
    insert into public.conversations (user_low_id, user_high_id)
    values (low_user_id, high_user_id)
    on conflict (user_low_id, user_high_id) do nothing;
    select id into conversation_id from public.conversations
    where user_low_id = low_user_id and user_high_id = high_user_id;

    update public.posts
    set room_preview = jsonb_set(room_preview, '{memberCount}', to_jsonb(approved_count + 2), true)
    where id = meetup.id;
    perform private.create_notification(
      request.requester_id, 'meetup_approved', request.host_id, 'meetup_request', request.id,
      '모임 참여 요청이 승인됐어요. 이제 대화를 시작할 수 있어요.',
      '/chat?conversationId=' || conversation_id::text
    );
  else
    update public.meetup_requests set status = 'rejected', responded_at = now() where id = request.id;
    perform private.create_notification(
      request.requester_id, 'meetup_rejected', request.host_id, 'meetup_request', request.id,
      '이번 모임 참여 요청은 승인되지 않았어요.', '/post/' || request.post_id::text
    );
  end if;
  return conversation_id;
end;
$$;

create function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  changed integer;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.notifications
  set read_at = now()
  where user_id = current_user_id
    and read_at is null
    and (p_ids is null or id = any(p_ids));
  get diagnostics changed = row_count;
  return changed;
end;
$$;

alter table public.moderation_actions drop constraint moderation_actions_action_check;
alter table public.moderation_actions
add constraint moderation_actions_action_check check (action in ('dismissed', 'warned', 'blocked'));

create function public.moderate_report(p_report_id uuid, p_action text, p_note text default null)
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
    perform private.create_notification(
      report.reported_user_id, 'moderation_blocked', current_user_id, 'user', report.reported_user_id,
      coalesce(nullif(trim(p_note), ''), '커뮤니티 운영 정책에 따라 계정 이용이 제한됐습니다.'), '/profile/settings'
    );
  end if;
end;
$$;

create or replace function public.resolve_report(report_id uuid, resolution text, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if resolution = 'actioned' then
    perform public.moderate_report(report_id, 'warned', note);
  elsif resolution = 'dismissed' then
    perform public.moderate_report(report_id, 'dismissed', note);
  else
    raise exception 'INVALID_RESOLUTION';
  end if;
end;
$$;

alter publication supabase_realtime add table public.notifications;

revoke execute on function private.create_notification(uuid, text, uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.request_meetup_join(uuid, text) from public, anon, authenticated;
revoke execute on function public.respond_meetup_request(uuid, text) from public, anon, authenticated;
revoke execute on function public.mark_notifications_read(uuid[]) from public, anon, authenticated;
revoke execute on function public.moderate_report(uuid, text, text) from public, anon, authenticated;
grant execute on function public.request_meetup_join(uuid, text) to authenticated;
grant execute on function public.respond_meetup_request(uuid, text) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.moderate_report(uuid, text, text) to authenticated;
