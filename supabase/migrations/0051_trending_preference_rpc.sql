-- "지금 뜨는 글"을 알림 설정 RPC 에 노출한다. 기본값은 켜짐이고 사용자가 끌 수 있다.
create or replace function public.get_notification_preferences()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return coalesce((select to_jsonb(p) - 'user_id' from public.notification_preferences p where user_id = auth.uid()),
    '{"post_likes":true,"comment_likes":true,"replies":true,"direct_requests":true,"messages":true,"meetups":true,"interests":false,"nearby":false,"trending":true,"push_enabled":false,"interest_tag_ids":[],"interest_hashtags":[]}'::jsonb);
end;
$$;

create or replace function public.update_notification_preferences(p_preferences jsonb)
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
    if entry.key in ('post_likes','comment_likes','replies','direct_requests','messages','meetups','interests','nearby','trending','push_enabled') then
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
    trending = coalesce((p_preferences->>'trending')::boolean, p.trending),
    push_enabled = coalesce((p_preferences->>'push_enabled')::boolean, p.push_enabled),
    interest_tag_ids = coalesce(tags, p.interest_tag_ids), interest_hashtags = coalesce(hashtags, p.interest_hashtags)
  where user_id = auth.uid();
  return public.get_notification_preferences();
end;
$$;
