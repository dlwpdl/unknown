CREATE OR REPLACE FUNCTION private.request_meetup_join(p_post_id uuid, p_message text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_user_id uuid := auth.uid();
  meetup public.posts;
  request public.meetup_requests;
  requester_level smallint;
  capacity integer;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  perform private.lock_relationships();
  if char_length(trim(coalesce(p_message, ''))) > 300 then raise exception 'INVALID_REQUEST_MESSAGE'; end if;

  select * into meetup from public.posts
  where id = p_post_id and status = 'published' and room_preview is not null
  for update;
  if meetup is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if coalesce(meetup.room_preview->>'closed','false')='true' then raise exception 'MEETUP_CLOSED'; end if;
  perform private.assert_chilling_open(meetup.room_preview);
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
    if coalesce(request.responded_at,request.created_at) > now() - interval '24 hours' then raise exception 'REQUEST_COOLDOWN'; end if;
  end if;

  capacity := coalesce((meetup.room_preview ->> 'capacity')::integer, 8);
  if 1 + (select count(*) from public.meetup_requests where post_id = p_post_id and status = 'approved') >= capacity then
    raise exception 'MEETUP_FULL';
  end if;
  if not private.is_admin() then perform private.enforce_rate_limit('meetup_request', 5, interval '1 day', interval '60 seconds'); end if;

  insert into public.meetup_requests (post_id, host_id, requester_id, message)
  values (p_post_id, meetup.author_id, current_user_id, trim(coalesce(p_message, '')))
  on conflict (post_id, requester_id) do update
  set status = 'pending', message = excluded.message, created_at = now(), responded_at = null
  returning * into request;

  perform private.create_notification(
    meetup.author_id, 'meetup_request', current_user_id, 'meetup_request', request.id,
    (select nickname::text from public.profiles where id = current_user_id) || '님이 모임 참여를 신청했어요. 한번 확인해 주세요.',
    '/chat?requestId=' || request.id::text
  );
  return request.id;
end;
$function$
