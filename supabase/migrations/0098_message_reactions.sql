-- 메시지 하트 리액션. 대화 참여자만 누를 수 있고, 하트를 받은 사람에게 알림이 간다.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'comment','reply','post_like','comment_like','message',
  'meetup_request','meetup_approved','meetup_rejected',
  'interest_post','nearby_meetup','moderation_warning','moderation_blocked',
  'safety_alert','trending_post','weekly_ranking','trending_hashtag','trending_meetup',
  'message_reaction','admin_security','admin_multiacct','admin_error_spike'
));

create or replace function private.notification_category(p_kind text, p_target_type text)
returns text language sql immutable set search_path='' as $$
  select case p_kind
    when 'post_like' then 'post_likes' when 'comment_like' then 'comment_likes'
    when 'comment' then 'replies' when 'reply' then 'replies'
    when 'message' then case when p_target_type = 'user' then 'direct_requests' else 'messages' end
    when 'message_reaction' then 'messages'
    when 'meetup_request' then 'meetups' when 'meetup_approved' then 'meetups' when 'meetup_rejected' then 'meetups'
    when 'interest_post' then 'interests' when 'nearby_meetup' then 'nearby'
    when 'trending_post' then 'trending' when 'weekly_ranking' then 'weekly_ranking'
    when 'trending_hashtag' then 'trending' when 'trending_meetup' then 'meetups'
    else 'system' end;
$$;

create table if not exists private.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_reactions_user_idx on private.message_reactions(user_id);
alter table private.message_reactions enable row level security;
revoke all on private.message_reactions from public,anon,authenticated,service_role;

create or replace function public.set_message_reaction(p_message_id uuid, p_reacted boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare
  viewer uuid := auth.uid();
  target public.messages;
  hearts integer;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(viewer);
  select * into target from public.messages where id = p_message_id;
  if target.id is null then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if not private.can_read_conversation(target.conversation_id, viewer) then raise exception 'NOT_CONVERSATION_MEMBER'; end if;

  if p_reacted then
    insert into private.message_reactions(message_id, user_id) values (p_message_id, viewer) on conflict do nothing;
    if target.sender_id <> viewer then
      insert into public.notifications(user_id, kind, actor_id, target_type, target_id, body, route)
      values (target.sender_id, 'message_reaction', viewer, 'message', target.id,
        '보낸 메시지에 하트를 눌렀어요', '/chat?conversationId=' || target.conversation_id::text);
    end if;
  else
    delete from private.message_reactions where message_id = p_message_id and user_id = viewer;
  end if;

  select count(*) into hearts from private.message_reactions where message_id = p_message_id;
  return hearts;
end;
$$;
revoke all on function public.set_message_reaction(uuid,boolean) from public,anon;
grant execute on function public.set_message_reaction(uuid,boolean) to authenticated;

create or replace function public.get_message_reactions(p_message_ids uuid[])
returns table(message_id uuid, hearts integer, mine boolean)
language sql security definer set search_path='' as $$
  select r.message_id, count(*)::int as hearts, bool_or(r.user_id = auth.uid()) as mine
  from private.message_reactions r
  join public.messages m on m.id = r.message_id
  where r.message_id = any(p_message_ids) and private.can_read_conversation(m.conversation_id, auth.uid())
  group by r.message_id;
$$;
revoke all on function public.get_message_reactions(uuid[]) from public,anon;
grant execute on function public.get_message_reactions(uuid[]) to authenticated;

notify pgrst, 'reload schema';
