-- Re-liking the same post must not spam the author with duplicate alerts.
create or replace function private.notify_post_like()
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

  select post.author_id into recipient
  from public.posts as post
  where post.id = new.post_id;

  if exists (
    select 1
    from public.notifications as notification
    where notification.user_id = recipient
      and notification.kind = 'post_like'
      and notification.actor_id = new.user_id
      and notification.target_type = 'post'
      and notification.target_id = new.post_id
  ) then
    return new;
  end if;

  select profile.nickname::text into nickname
  from public.profiles as profile
  where profile.id = new.user_id;

  perform private.create_notification(
    recipient, 'post_like', new.user_id, 'post', new.post_id,
    nickname || '님이 내 글에 공감했어요.', '/post/' || new.post_id::text
  );
  return new;
end;
$$;
