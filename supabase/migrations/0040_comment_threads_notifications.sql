-- One-level comment threads and account-scoped in-app notification controls.
-- Existing comment writes still enter the all-content safety review queue (ADR-0001).
alter table public.comments
  add column parent_id uuid references public.comments(id) on delete set null,
  add column reply_to_id uuid references public.comments(id) on delete set null,
  add constraint comments_not_own_parent check (parent_id <> id and reply_to_id <> id);
create index comments_thread_page_idx on public.comments (post_id, parent_id, created_at desc, id desc)
  where deleted_at is null;
create index comments_parent_idx on public.comments (parent_id) where parent_id is not null;
create index comments_reply_to_idx on public.comments (reply_to_id) where reply_to_id is not null;

-- Internal explicit-viewer helper is shared by inbox RLS and the push worker.
create function private.comment_visible_to(p_comment_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.comments c
    join public.posts p on p.id = c.post_id and p.status = 'published'
    join public.profiles author on author.id = c.author_id and author.account_status = 'active'
    join public.profiles owner on owner.id = p.author_id and owner.account_status = 'active'
    where c.id = p_comment_id and c.deleted_at is null
      and (p_user_id is null or (
        not private.is_blocked_between(p_user_id, c.author_id)
        and not private.is_blocked_between(p_user_id, p.author_id)))
      and not exists (
        select 1 from public.comments ancestor
        join public.profiles profile on profile.id = ancestor.author_id
        where ancestor.id in (c.parent_id, c.reply_to_id)
          and (ancestor.deleted_at is not null or profile.account_status <> 'active'
            or (p_user_id is not null and private.is_blocked_between(p_user_id, ancestor.author_id)))
      )
  );
$$;

-- The callable policy wrapper has no caller-supplied viewer.
create function private.can_view_comment(p_comment_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.comment_visible_to(p_comment_id, auth.uid());
$$;

drop policy "users read visible comments" on public.comments;
create policy "users read visible comments" on public.comments for select to authenticated
  using ((select private.is_admin()) or private.can_view_comment(id));

create function public.create_thread_comment(p_post_id uuid, p_body text, p_reply_to_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  reply public.comments;
  comment_id uuid;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 1000 then raise exception 'INVALID_COMMENT'; end if;
  if not exists (
    select 1 from public.posts p join public.profiles author on author.id = p.author_id
    where p.id = p_post_id and p.status = 'published' and author.account_status = 'active'
      and not private.is_blocked_between(current_user_id, p.author_id)
  ) then raise exception 'POST_NOT_FOUND'; end if;
  if p_reply_to_id is not null then
    select * into reply from public.comments
    where id = p_reply_to_id and post_id = p_post_id and private.can_view_comment(id)
    for share;
    if reply.id is null then raise exception 'COMMENT_NOT_FOUND'; end if;
  end if;
  perform private.enforce_rate_limit('comment', 20, interval '10 minutes', interval '5 seconds');
  insert into public.comments (post_id, author_id, body, parent_id, reply_to_id)
  values (p_post_id, current_user_id, trim(p_body), coalesce(reply.parent_id, reply.id), reply.id)
  returning id into comment_id;
  return comment_id;
end;
$$;

create or replace function public.create_comment(p_post_id uuid, p_body text)
returns uuid language sql security definer set search_path = '' as $$
  select public.create_thread_comment(p_post_id, p_body, null);
$$;

create function public.get_comment_thread_page(
  p_post_id uuid, p_parent_id uuid default null,
  p_before_created timestamptz default null, p_before_id uuid default null, p_limit integer default 30
)
returns table (
  id uuid, post_id uuid, author_id uuid, body text, like_count integer,
  liked_by_me boolean, created_at timestamptz, author_nickname text, author_verification_level smallint,
  parent_id uuid, reply_to_id uuid, reply_to_nickname text, reply_count integer
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.post_id, c.author_id, c.body, c.like_count,
    exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = auth.uid()),
    c.created_at, author.nickname::text, author.verification_level,
    c.parent_id, c.reply_to_id, reply_author.nickname::text,
    (select count(*)::integer from public.comments child where child.parent_id = c.id
      and child.deleted_at is null and private.can_view_comment(child.id))
  from public.comments c
  join public.profiles author on author.id = c.author_id
  left join public.comments reply on reply.id = c.reply_to_id
  left join public.profiles reply_author on reply_author.id = reply.author_id
  where c.post_id = p_post_id and c.parent_id is not distinct from p_parent_id
    and c.deleted_at is null and private.can_view_comment(c.id)
    and (p_before_created is null or (c.created_at, c.id) < (p_before_created, p_before_id))
  order by c.created_at desc, c.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

-- Resolve notification targets independently of their age or pagination position.
create function public.get_comment_thread_context(p_post_id uuid, p_comment_id uuid)
returns table (
  id uuid, post_id uuid, author_id uuid, body text, like_count integer,
  liked_by_me boolean, created_at timestamptz, author_nickname text, author_verification_level smallint,
  parent_id uuid, reply_to_id uuid, reply_to_nickname text, reply_count integer
)
language sql stable security definer set search_path = '' as $$
  with target as (
    select c.id, coalesce(c.parent_id, c.id) root_id from public.comments c
    where c.id = p_comment_id and c.post_id = p_post_id and private.can_view_comment(c.id)
      and (c.parent_id is null or private.can_view_comment(c.parent_id))
  )
  select c.id, c.post_id, c.author_id, c.body, c.like_count,
    exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = auth.uid()),
    c.created_at, author.nickname::text, author.verification_level,
    c.parent_id, c.reply_to_id, reply_author.nickname::text,
    (select count(*)::integer from public.comments child where child.parent_id = c.id
      and child.deleted_at is null and private.can_view_comment(child.id))
  from target join public.comments c on c.id in (target.root_id, target.id)
  join public.profiles author on author.id = c.author_id
  left join public.comments reply on reply.id = c.reply_to_id
  left join public.profiles reply_author on reply_author.id = reply.author_id
  where c.post_id = p_post_id and private.can_view_comment(c.id)
  order by (c.id = target.root_id) desc;
$$;

-- Keep the old flat APIs and return shapes, with the same visibility as the new API.
create or replace function public.get_public_comments_page(
  p_post_id uuid, p_before_created timestamptz default null,
  p_before_id uuid default null, p_limit integer default 30
)
returns table (
  id uuid, post_id uuid, author_id uuid, body text, like_count integer,
  liked_by_me boolean, created_at timestamptz, author_nickname text, author_verification_level smallint
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.post_id, c.author_id, c.body, c.like_count,
    exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = auth.uid()),
    c.created_at, author.nickname::text, author.verification_level
  from public.comments c join public.profiles author on author.id = c.author_id
  where c.post_id = p_post_id and c.deleted_at is null and private.can_view_comment(c.id)
    and (p_before_created is null or (c.created_at, c.id) < (p_before_created, p_before_id))
  order by c.created_at desc, c.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

create or replace function public.get_public_comments(p_post_ids uuid[])
returns table (
  id uuid, post_id uuid, author_id uuid, body text, like_count integer,
  liked_by_me boolean, created_at timestamptz, author_nickname text, author_verification_level smallint
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.post_id, c.author_id, c.body, c.like_count,
    exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = auth.uid()),
    c.created_at, author.nickname::text, author.verification_level
  from public.comments c join public.profiles author on author.id = c.author_id
  where coalesce(cardinality(p_post_ids), 0) between 1 and 100
    and c.post_id = any(p_post_ids) and c.deleted_at is null and private.can_view_comment(c.id)
  order by c.created_at, c.id;
$$;

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  post_likes boolean not null default true,
  comment_likes boolean not null default true,
  replies boolean not null default true,
  direct_requests boolean not null default true,
  messages boolean not null default true,
  meetups boolean not null default true,
  interests boolean not null default false,
  nearby boolean not null default false,
  push_enabled boolean not null default false,
  interest_tag_ids integer[] not null default '{}' check (cardinality(interest_tag_ids) <= 30),
  interest_hashtags text[] not null default '{}' check (cardinality(interest_hashtags) <= 20)
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public, anon, authenticated;
grant select on public.notification_preferences to authenticated;
create policy "users read own notification preferences" on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));

create function public.get_notification_preferences()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return coalesce((select to_jsonb(p) - 'user_id' from public.notification_preferences p where user_id = auth.uid()),
    '{"post_likes":true,"comment_likes":true,"replies":true,"direct_requests":true,"messages":true,"meetups":true,"interests":false,"nearby":false,"push_enabled":false,"interest_tag_ids":[],"interest_hashtags":[]}'::jsonb);
end;
$$;

create function public.update_notification_preferences(p_preferences jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry record;
  tags integer[];
  hashtags text[];
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then raise exception 'INVALID_PREFERENCES'; end if;
  for entry in select * from jsonb_each(p_preferences) loop
    if entry.key in ('post_likes','comment_likes','replies','direct_requests','messages','meetups','interests','nearby','push_enabled') then
      if jsonb_typeof(entry.value) <> 'boolean' then raise exception 'INVALID_PREFERENCES'; end if;
    elsif entry.key in ('interest_tag_ids','interest_hashtags') then
      if jsonb_typeof(entry.value) <> 'array' then raise exception 'INVALID_PREFERENCES'; end if;
      if jsonb_array_length(entry.value) > 30 then raise exception 'INVALID_PREFERENCES'; end if;
      if entry.key = 'interest_hashtags' and jsonb_array_length(entry.value) > 20 then raise exception 'INVALID_PREFERENCES'; end if;
    else raise exception 'INVALID_PREFERENCES';
    end if;
  end loop;
  if p_preferences ? 'interest_tag_ids' then
    if exists (select 1 from jsonb_array_elements(p_preferences->'interest_tag_ids') v
      where jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]{1,5}$') then raise exception 'INVALID_INTEREST_TAGS'; end if;
    select coalesce(array_agg(distinct value::integer order by value::integer), '{}') into tags
      from jsonb_array_elements_text(p_preferences->'interest_tag_ids');
    if exists (select 1 from unnest(tags) requested(tag_id) where not exists (select 1 from public.tags t where t.id = requested.tag_id)) then
      raise exception 'INVALID_INTEREST_TAGS';
    end if;
  end if;
  if p_preferences ? 'interest_hashtags' then
    if exists (select 1 from jsonb_array_elements(p_preferences->'interest_hashtags') v
      where jsonb_typeof(v) <> 'string') then raise exception 'INVALID_INTEREST_HASHTAGS'; end if;
    if exists (select 1 from jsonb_array_elements_text(p_preferences->'interest_hashtags')
      where char_length(coalesce(private.canonicalize_hashtag(value), '')) not between 1 and 50) then
      raise exception 'INVALID_INTEREST_HASHTAGS';
    end if;
    select coalesce(array_agg(distinct lower(private.canonicalize_hashtag(value)) order by lower(private.canonicalize_hashtag(value))), '{}')
      into hashtags from jsonb_array_elements_text(p_preferences->'interest_hashtags');
  end if;
  insert into public.notification_preferences (user_id) values (auth.uid()) on conflict do nothing;
  update public.notification_preferences p set
    post_likes = coalesce((p_preferences->>'post_likes')::boolean, p.post_likes),
    comment_likes = coalesce((p_preferences->>'comment_likes')::boolean, p.comment_likes),
    replies = coalesce((p_preferences->>'replies')::boolean, p.replies),
    direct_requests = coalesce((p_preferences->>'direct_requests')::boolean, p.direct_requests),
    messages = coalesce((p_preferences->>'messages')::boolean, p.messages),
    meetups = coalesce((p_preferences->>'meetups')::boolean, p.meetups),
    interests = coalesce((p_preferences->>'interests')::boolean, p.interests),
    nearby = coalesce((p_preferences->>'nearby')::boolean, p.nearby),
    push_enabled = coalesce((p_preferences->>'push_enabled')::boolean, p.push_enabled),
    interest_tag_ids = coalesce(tags, p.interest_tag_ids), interest_hashtags = coalesce(hashtags, p.interest_hashtags)
  where user_id = auth.uid();
  return public.get_notification_preferences();
end;
$$;

create function private.delete_notification_preferences()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notification_preferences where user_id = new.id;
  return new;
end;
$$;
create trigger profiles_delete_notification_preferences after update of account_status on public.profiles
  for each row when (new.account_status = 'deleted') execute function private.delete_notification_preferences();

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'comment','reply','post_like','comment_like','message','meetup_request','meetup_approved','meetup_rejected',
  'interest_post','nearby_meetup','moderation_warning','moderation_blocked','safety_alert'
));
create function private.notification_category(p_kind text, p_target_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_kind
    when 'post_like' then 'post_likes' when 'comment_like' then 'comment_likes'
    when 'comment' then 'replies' when 'reply' then 'replies'
    when 'message' then case when p_target_type = 'user' then 'direct_requests' else 'messages' end
    when 'meetup_request' then 'meetups' when 'meetup_approved' then 'meetups' when 'meetup_rejected' then 'meetups'
    when 'interest_post' then 'interests' when 'nearby_meetup' then 'nearby' else 'system' end;
$$;
alter table public.notifications add column category text not null default 'system'
  check (category in ('post_likes','comment_likes','replies','direct_requests','messages','meetups','interests','nearby','system'));
update public.notifications set category = private.notification_category(kind, target_type);

-- Backfill only the classification. Opt-in discovery never replays existing posts.
-- Preserve the first like notification if older concurrent writes produced duplicates.
delete from public.notifications n using (
  select id, row_number() over (partition by user_id, kind, actor_id, target_type, target_id order by created_at, id) position
  from public.notifications where kind in ('post_like','comment_like')
) duplicate where n.id = duplicate.id and duplicate.position > 1;
create unique index notifications_like_once_idx on public.notifications (user_id, kind, actor_id, target_type, target_id)
  where kind in ('post_like','comment_like');

create function private.can_receive_notification(p_user_id uuid, p_category text, p_actor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and (
    p_category = 'system' or (
      p_category in ('post_likes','comment_likes','replies','direct_requests','messages','meetups','interests','nearby')
      and private.is_active_account(p_user_id)
      and (p_actor_id is null or (p_actor_id <> p_user_id and private.is_active_account(p_actor_id)
        and not private.is_blocked_between(p_user_id, p_actor_id)))
      and coalesce((select (to_jsonb(p)->>p_category)::boolean from public.notification_preferences p where user_id = p_user_id),
        p_category not in ('interests','nearby'))
    )
  );
$$;

create function private.filter_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.category := private.notification_category(new.kind, new.target_type);
  if not private.can_receive_notification(new.user_id, new.category, new.actor_id) then return null; end if;
  if new.category <> 'system' and not private.notification_target_visible(new.user_id, new.target_type, new.target_id) then return null; end if;
  return new;
end;
$$;
create trigger notifications_preferences before insert on public.notifications
  for each row execute function private.filter_notification();

create or replace function private.create_notification(
  p_user_id uuid, p_kind text, p_actor_id uuid, p_target_type text,
  p_target_id uuid, p_body text, p_route text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare notification_id uuid;
begin
  if p_user_id is null or p_user_id = p_actor_id then return null; end if;
  insert into public.notifications (user_id, kind, actor_id, target_type, target_id, body, route)
  values (p_user_id, p_kind, p_actor_id, p_target_type, p_target_id, left(trim(p_body), 300), p_route)
  on conflict do nothing returning id into notification_id;
  return notification_id;
end;
$$;

create function private.notification_target_visible(p_user_id uuid, p_target_type text, p_target_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_target_type
    when 'comment' then private.comment_visible_to(p_target_id, p_user_id)
    when 'post' then exists (
      select 1 from public.posts p where p.id = p_target_id and p.status = 'published'
        and private.is_active_account(p.author_id) and not private.is_blocked_between(p_user_id, p.author_id))
    when 'message' then exists (
      select 1 from public.messages m where m.id = p_target_id
        and private.is_active_account(m.sender_id) and not private.is_blocked_between(p_user_id, m.sender_id)
        and private.can_read_message(m.conversation_id, p_user_id, m.sender_id, m.created_at))
    when 'meetup_request' then exists (
      select 1 from public.meetup_requests r join public.posts p on p.id = r.post_id
      where r.id = p_target_id and p_user_id in (r.host_id, r.requester_id) and p.status = 'published'
        and private.is_active_account(r.host_id) and private.is_active_account(r.requester_id)
        and not private.is_blocked_between(r.host_id, r.requester_id))
    when 'user' then private.is_active_account(p_target_id) and not private.is_blocked_between(p_user_id, p_target_id)
    else false end;
$$;

create function private.can_read_notification(p_user_id uuid, p_category text, p_actor_id uuid, p_target_type text, p_target_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id = auth.uid()
    and private.can_receive_notification(p_user_id, p_category, p_actor_id)
    and (p_category = 'system' or private.notification_target_visible(p_user_id, p_target_type, p_target_id));
$$;
drop policy "users read own notifications" on public.notifications;
create policy "users read own notifications" on public.notifications for select to authenticated
  using ((select private.is_admin()) or private.can_read_notification(user_id, category, actor_id, target_type, target_id));

-- Personal app reads follow preferences even when the member also has an admin role.
-- Raw notifications retain the existing admin review policy.
create view public.user_notifications with (security_invoker = true) as
  select * from public.notifications
  where private.can_read_notification(user_id, category, actor_id, target_type, target_id);
revoke all on public.user_notifications from public, anon, authenticated;
grant select on public.user_notifications to authenticated;

create or replace function private.notify_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  recipient uuid;
  nickname text;
begin
  if new.deleted_at is not null then return new; end if;
  select p.author_id into recipient from public.posts p where p.id = new.post_id and p.status = 'published';
  select p.nickname::text into nickname from public.profiles p where p.id = new.author_id;
  perform private.create_notification(recipient, 'comment', new.author_id, 'comment', new.id,
    nickname || '님이 내 글에 댓글을 남겼어요.', '/post/' || new.post_id::text || '?commentId=' || new.id::text);
  if new.reply_to_id is not null then
    perform private.create_notification(c.author_id, 'reply', new.author_id, 'comment', new.id,
      nickname || '님이 내 댓글에 답글을 남겼어요.', '/post/' || new.post_id::text || '?commentId=' || new.id::text)
    from public.comments c where c.id = new.reply_to_id and c.author_id is distinct from recipient and c.deleted_at is null;
  end if;
  return new;
end;
$$;

create function private.notify_comment_like()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.create_notification(c.author_id, 'comment_like', new.user_id, 'comment', c.id,
    actor.nickname::text || '님이 내 댓글에 공감했어요.', '/post/' || c.post_id::text || '?commentId=' || c.id::text)
  from public.comments c join public.posts p on p.id = c.post_id and p.status = 'published'
  join public.profiles actor on actor.id = new.user_id
  where c.id = new.comment_id and c.deleted_at is null;
  return new;
end;
$$;
create trigger comment_likes_notification after insert on public.comment_likes
  for each row execute function private.notify_comment_like();

-- Discovery is opt-in, uses the saved city, and never sends example/review account posts.
-- No promotion subsystem exists yet. Future production campaign activation must use the
-- same nearby preference and notification guard; there is intentionally no manual fanout RPC.
create function private.notify_discovery_post()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'published' or not private.is_active_account(new.author_id) then return new; end if;
  if exists (select 1 from auth.users u where u.id = new.author_id
    and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb)) then return new; end if;
  insert into public.notifications (user_id, kind, actor_id, target_type, target_id, body, route)
  select prefs.user_id,
    case when match.interested then 'interest_post' else 'nearby_meetup' end,
    new.author_id, 'post', new.id,
    case when match.interested then '관심 있는 주제의 새 글이 올라왔어요.' else '내 지역에 새로운 모임이 올라왔어요.' end,
    '/post/' || new.id::text
  from public.notification_preferences prefs
  join public.profiles recipient on recipient.id = prefs.user_id and recipient.city_id = new.city_id and recipient.account_status = 'active'
  cross join lateral (select prefs.interests and (
    new.tag_id = any(prefs.interest_tag_ids) or exists (
      select 1 from unnest(new.hashtags) hashtag where lower(private.canonicalize_hashtag(hashtag)) = any(prefs.interest_hashtags)
    )) interested) match
  -- ponytail: synchronous opt-in fanout; move to a job if measured publish latency grows.
  where match.interested or (prefs.nearby and new.room_preview is not null and coalesce(new.room_preview->>'closed','false') <> 'true');
  return new;
end;
$$;
create trigger posts_discovery_notification after insert on public.posts
  for each row execute function private.notify_discovery_post();

revoke all on function private.comment_visible_to(uuid,uuid), private.can_view_comment(uuid), private.delete_notification_preferences(),
  private.notification_target_visible(uuid,text,uuid),
  private.notification_category(text,text), private.can_receive_notification(uuid,text,uuid),
  private.filter_notification(), private.can_read_notification(uuid,text,uuid,text,uuid),
  private.notify_comment_like(), private.notify_discovery_post() from public, anon, authenticated;
grant execute on function private.can_view_comment(uuid), private.can_read_notification(uuid,text,uuid,text,uuid) to authenticated;
revoke all on function public.create_thread_comment(uuid,text,uuid),
  public.get_comment_thread_page(uuid,uuid,timestamptz,uuid,integer),
  public.get_comment_thread_context(uuid,uuid),
  public.get_notification_preferences(), public.update_notification_preferences(jsonb) from public, anon, authenticated;
grant execute on function public.create_thread_comment(uuid,text,uuid),
  public.get_notification_preferences(), public.update_notification_preferences(jsonb) to authenticated;
grant execute on function public.get_comment_thread_page(uuid,uuid,timestamptz,uuid,integer),
  public.get_comment_thread_context(uuid,uuid) to anon, authenticated;
