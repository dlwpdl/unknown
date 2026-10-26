-- Owner 2026-10-25: a business can comment as the business. Mirrors business posts: the real actor stays in author_id
-- (edit/delete RLS keeps working) while public reads show the business name and id instead of the operator.
alter table public.comments add column business_author_id uuid references private.merchants(id) on delete set null;
create index comments_business_author_idx on public.comments(business_author_id) where business_author_id is not null;

-- Same visibility rules as private.public_post_business_id_for.
create function private.public_comment_business_id_for(p_business_id uuid, p_viewer uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select m.id from private.merchants m
  where m.id=p_business_id and m.record_kind='business' and m.deleted_at is null and m.consent='granted' and m.status<>'paused'
    and not exists(select 1 from public.profiles where id=m.id)
    and not exists(select 1 from private.business_blocks where user_id=p_viewer and business_id=m.id);
$$;
revoke all on function private.public_comment_business_id_for(uuid,uuid) from public,anon,authenticated,service_role;

drop function public.create_thread_comment(uuid,text,uuid);
create function public.create_thread_comment(p_post_id uuid, p_body text, p_reply_to_id uuid default null, p_business_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $function$
declare
  current_user_id uuid := auth.uid();
  reply public.comments;
  comment_id uuid;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 1000 then raise exception 'INVALID_COMMENT'; end if;
  if p_business_id is not null and not private.business_chat_can_use(current_user_id, p_business_id) then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
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
  insert into public.comments (post_id, author_id, body, parent_id, reply_to_id, business_author_id)
  values (p_post_id, current_user_id, trim(p_body), coalesce(reply.parent_id, reply.id), reply.id, p_business_id)
  returning id into comment_id;
  return comment_id;
end;
$function$;
revoke all on function public.create_thread_comment(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_thread_comment(uuid,text,uuid,uuid) to authenticated,service_role;

-- Business comments whose business is no longer visible are hidden, like official business posts.
drop function public.get_public_comments_page(uuid,timestamptz,uuid,integer);
create function public.get_public_comments_page(p_post_id uuid, p_before_created timestamptz default null, p_before_id uuid default null, p_limit integer default 30)
returns table(id uuid, post_id uuid, author_id uuid, body text, like_count integer, liked_by_me boolean, created_at timestamptz, author_nickname text, author_verification_level smallint,
  business_id uuid, business_avatar_path text)
language sql stable security definer set search_path='' as $function$
  select c.id, c.post_id, coalesce(b.id, c.author_id), c.body, c.like_count,
    exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = auth.uid()),
    c.created_at, coalesce(b.name, author.nickname)::text, case when b.id is null then author.verification_level else 0::smallint end,
    b.id, case when b.avatar_path is not null then 'business-profile/'||b.id::text||'/avatar/'||md5(b.avatar_path) end
  from public.comments c join public.profiles author on author.id = c.author_id
  left join private.merchants b on b.id = private.public_comment_business_id_for(c.business_author_id, auth.uid())
  where c.post_id = p_post_id and c.deleted_at is null and private.can_view_comment(c.id)
    and (c.business_author_id is null or b.id is not null)
    and (p_before_created is null or (c.created_at, c.id) < (p_before_created, p_before_id))
  order by c.created_at desc, c.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$function$;
revoke all on function public.get_public_comments_page(uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_public_comments_page(uuid,timestamptz,uuid,integer) to authenticated,service_role;

drop function public.get_comment_thread_page(uuid,uuid,timestamptz,uuid,integer);
create function public.get_comment_thread_page(p_post_id uuid, p_parent_id uuid default null, p_before_created timestamptz default null, p_before_id uuid default null, p_limit integer default 30)
returns table(id uuid, post_id uuid, author_id uuid, body text, like_count integer, liked_by_me boolean, created_at timestamptz, author_nickname text, author_verification_level smallint,
  parent_id uuid, reply_to_id uuid, reply_to_nickname text, reply_count integer, business_id uuid, business_avatar_path text)
language sql stable security definer set search_path='' as $function$
  select c.id, c.post_id, coalesce(b.id, c.author_id), c.body, c.like_count,
    exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = auth.uid()),
    c.created_at, coalesce(b.name, author.nickname)::text, case when b.id is null then author.verification_level else 0::smallint end,
    c.parent_id, c.reply_to_id, coalesce(reply_business.name, reply_author.nickname)::text,
    (select count(*)::integer from public.comments child where child.parent_id = c.id
      and child.deleted_at is null and private.can_view_comment(child.id)),
    b.id, case when b.avatar_path is not null then 'business-profile/'||b.id::text||'/avatar/'||md5(b.avatar_path) end
  from public.comments c
  join public.profiles author on author.id = c.author_id
  left join private.merchants b on b.id = private.public_comment_business_id_for(c.business_author_id, auth.uid())
  left join public.comments reply on reply.id = c.reply_to_id
  left join public.profiles reply_author on reply_author.id = reply.author_id
  left join private.merchants reply_business on reply_business.id = reply.business_author_id
  where c.post_id = p_post_id and c.parent_id is not distinct from p_parent_id
    and c.deleted_at is null and private.can_view_comment(c.id)
    and (c.business_author_id is null or b.id is not null)
    and (p_before_created is null or (c.created_at, c.id) < (p_before_created, p_before_id))
  order by c.created_at desc, c.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$function$;
revoke all on function public.get_comment_thread_page(uuid,uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_comment_thread_page(uuid,uuid,timestamptz,uuid,integer) to authenticated,service_role;

drop function public.get_comment_thread_context(uuid,uuid);
create function public.get_comment_thread_context(p_post_id uuid, p_comment_id uuid)
returns table(id uuid, post_id uuid, author_id uuid, body text, like_count integer, liked_by_me boolean, created_at timestamptz, author_nickname text, author_verification_level smallint,
  parent_id uuid, reply_to_id uuid, reply_to_nickname text, reply_count integer, business_id uuid, business_avatar_path text)
language sql stable security definer set search_path='' as $function$
  with target as (
    select c.id, coalesce(c.parent_id, c.id) root_id from public.comments c
    where c.id = p_comment_id and c.post_id = p_post_id and private.can_view_comment(c.id)
      and (c.parent_id is null or private.can_view_comment(c.parent_id))
  )
  select c.id, c.post_id, coalesce(b.id, c.author_id), c.body, c.like_count,
    exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = auth.uid()),
    c.created_at, coalesce(b.name, author.nickname)::text, case when b.id is null then author.verification_level else 0::smallint end,
    c.parent_id, c.reply_to_id, coalesce(reply_business.name, reply_author.nickname)::text,
    (select count(*)::integer from public.comments child where child.parent_id = c.id
      and child.deleted_at is null and private.can_view_comment(child.id)),
    b.id, case when b.avatar_path is not null then 'business-profile/'||b.id::text||'/avatar/'||md5(b.avatar_path) end
  from target join public.comments c on c.id in (target.root_id, target.id)
  join public.profiles author on author.id = c.author_id
  left join private.merchants b on b.id = private.public_comment_business_id_for(c.business_author_id, auth.uid())
  left join public.comments reply on reply.id = c.reply_to_id
  left join public.profiles reply_author on reply_author.id = reply.author_id
  left join private.merchants reply_business on reply_business.id = reply.business_author_id
  where c.post_id = p_post_id and private.can_view_comment(c.id)
    and (c.business_author_id is null or b.id is not null)
  order by (c.id = target.root_id) desc;
$function$;
revoke all on function public.get_comment_thread_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_comment_thread_context(uuid,uuid) to authenticated,service_role;

-- Owner inbox (replies to my posts) reads comments directly; this resolves business names without exposing operators.
create function public.get_public_comment_businesses(p_comment_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $function$
declare result jsonb;
begin
  if p_comment_ids is null or cardinality(p_comment_ids)>50 or array_position(p_comment_ids,null) is not null then raise exception 'INVALID_BUSINESS_COMMENT_PAGE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('comment_id',c.id,'business_id',m.id,'business_name',m.name) order by c.id),'[]') into result
  from public.comments c join private.merchants m on m.id=private.public_comment_business_id_for(c.business_author_id,auth.uid())
  where c.id=any(p_comment_ids) and private.can_view_comment(c.id);
  return result;
end $function$;
revoke all on function public.get_public_comment_businesses(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_public_comment_businesses(uuid[]) to authenticated,service_role;

create or replace function private.notify_comment() returns trigger
language plpgsql security definer set search_path='' as $function$
declare
  recipient uuid;
  nickname text;
begin
  if new.deleted_at is not null then return new; end if;
  select p.author_id into recipient from public.posts p where p.id = new.post_id and p.status = 'published';
  select coalesce(m.name, p.nickname)::text into nickname from public.profiles p
    left join private.merchants m on m.id = new.business_author_id where p.id = new.author_id;
  perform private.create_notification(recipient, 'comment', new.author_id, 'comment', new.id,
    nickname || '님이 내 글에 댓글을 남겼어요.', '/post/' || new.post_id::text || '?commentId=' || new.id::text);
  if new.reply_to_id is not null then
    perform private.create_notification(c.author_id, 'reply', new.author_id, 'comment', new.id,
      nickname || '님이 내 댓글에 답글을 남겼어요.', '/post/' || new.post_id::text || '?commentId=' || new.id::text)
    from public.comments c where c.id = new.reply_to_id and c.author_id is distinct from recipient and c.deleted_at is null;
  end if;
  return new;
end;
$function$;
