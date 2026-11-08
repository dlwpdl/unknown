-- Close the way around a bubble's chat request (owner 2026-11-07 "말풍선 1:1 대화 건너뛰기가 가능하지않게", answer "서버에서 막기";
-- then "중고거래랑 이런거는?" / "제일 좋은방법추천좀"). Someone seen on the map could be found through their posts and messaged at once.
-- While their bubble is up and for 24 hours after it goes down, a first 1:1 from anyone else waits for the bubble's own request, unless
-- it starts from one of their published trade posts. A declined sender waits on every path until the bubble is deleted (7 days after
-- it goes down). A pending request from that person to the caller lets the accept path through. Chats that already exist, admins and
-- the gling pins are untouched. Old apps already explain REQUEST_COOLDOWN, so no app change is needed.
create or replace function private.live_chat_guarded(p_from uuid,p_to uuid,p_post_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select ((exists(select 1 from private.live_bubbles b where b.author_id=p_to and b.kind='member'
             and coalesce(b.ended_at,b.expires_at)>now()-interval '24 hours')
           and not exists(select 1 from public.posts p where p.id=p_post_id and p.kind='listing' and p.author_id=p_to and p.status='published'))
       or exists(select 1 from private.live_bubble_requests r where r.sender_id=p_from and r.recipient_id=p_to and r.status='declined'))
    and not exists(select 1 from private.live_bubble_requests r where r.sender_id=p_to and r.recipient_id=p_from and r.status='pending')
$$;
alter function private.live_chat_guarded(uuid,uuid,uuid) owner to postgres;
revoke all on function private.live_chat_guarded(uuid,uuid,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.start_conversation(other_user_id uuid, p_post_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=auth.uid(); c public.conversations; low_id uuid; high_id uuid; origin uuid;
begin if private.is_official_business_post(p_post_id) then raise exception 'MERCHANT_CONTACT_UNAVAILABLE'; end if;
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if u=other_user_id then raise exception 'INVALID_RECIPIENT'; end if;
  if not private.is_active_account(other_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  if private.is_blocked_between(u,other_user_id) then raise exception 'BLOCKED'; end if;
  select p.id into origin from public.posts p
    where p.id=p_post_id and p.kind='listing' and p.author_id=other_user_id;
  perform private.lock_relationships(); low_id:=least(u,other_user_id); high_id:=greatest(u,other_user_id);
  update public.conversations set status='cancelled',ended_at=created_at where kind='direct' and status='pending'
    and user_low_id=low_id and user_high_id=high_id and created_at<=now()-interval '7 days';
  select * into c from public.conversations where kind='direct' and user_low_id=low_id and user_high_id=high_id and status in ('active','pending') for update;
  if c.id is not null then
    update public.conversations set status='active',accepted_at=coalesce(accepted_at,now()),origin_post_id=coalesce(origin_post_id,origin) where id=c.id;
    
    update public.conversations set context_post_id=p_post_id where id=c.id and exists(
      select 1 from public.posts p where p.id=p_post_id and p.author_id=other_user_id and p.status='published'
        and (p.kind='listing' or p.room_preview is not null));
    return c.id;
  
  end if;
  -- Respect recent legacy refusals; capacity and ended-room slot locks are unrelated.
  if not private.is_admin_id(u) and exists(select 1 from public.conversations where kind='direct' and user_low_id=low_id and user_high_id=high_id
    and status in ('rejected','cancelled') and ended_at>now()-interval '24 hours') then raise exception 'REQUEST_COOLDOWN'; end if;
  if not private.is_admin_id(u) and private.live_chat_guarded(u,other_user_id,p_post_id) then raise exception 'REQUEST_COOLDOWN'; end if;
  perform private.enforce_rate_limit('conversation_request',20,interval '1 hour',interval '30 seconds');
  insert into public.conversations(user_low_id,user_high_id,requester_id,status,accepted_at,origin_post_id)
    values(low_id,high_id,u,'active',now(),origin) returning * into c;
  -- The existing message trigger notifies the recipient when a message is actually sent.
  
    update public.conversations set context_post_id=p_post_id where id=c.id and exists(
      select 1 from public.posts p where p.id=p_post_id and p.author_id=other_user_id and p.status='published'
        and (p.kind='listing' or p.room_preview is not null));
    return c.id;
  
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_business_conversation(p_as_business_id uuid, p_other_business_id uuid, p_other_user_id uuid, p_post_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=auth.uid(); c public.conversations; a uuid:=coalesce(p_as_business_id,u); b uuid:=coalesce(p_other_business_id,p_other_user_id); found_id uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if num_nonnulls(p_other_business_id,p_other_user_id)<>1 or (p_as_business_id is null and p_other_business_id is null)
    or a=b then raise exception 'INVALID_RECIPIENT'; end if;
  perform private.lock_relationships();
  perform 1 from public.profiles where id in(u,p_other_user_id)
    or id in(select owner_id from private.merchants where id in(p_as_business_id,p_other_business_id))
    or id in(select user_id from private.merchant_operators where merchant_id in(p_as_business_id,p_other_business_id)) order by id for share;
  perform 1 from auth.users where id in(u,p_other_user_id)
    or id in(select owner_id from private.merchants where id in(p_as_business_id,p_other_business_id))
    or id in(select user_id from private.merchant_operators where merchant_id in(p_as_business_id,p_other_business_id)) order by id for share;
  perform 1 from private.merchants where id in(p_as_business_id,p_other_business_id) order by id for share;
  perform 1 from private.merchant_operators where merchant_id=p_as_business_id and user_id=u for share;
  if not private.business_chat_can_use(u,p_as_business_id)
    or (p_other_business_id is not null and not private.business_chat_business_ready(p_other_business_id))
    or (p_other_user_id is not null and not private.business_chat_can_use(p_other_user_id,null)) then raise exception 'CONVERSATION_ACCESS_DENIED'; end if;
  c.kind:='business';
  if a<b then
    c.user_low_id:=case when p_as_business_id is null then u end; c.business_low_id:=p_as_business_id;
    c.user_high_id:=p_other_user_id; c.business_high_id:=p_other_business_id;
  else
    c.user_high_id:=case when p_as_business_id is null then u end; c.business_high_id:=p_as_business_id;
    c.user_low_id:=p_other_user_id; c.business_low_id:=p_other_business_id;
  end if;
  if private.business_chat_blocked(c.user_low_id,c.business_low_id,c.user_high_id,c.business_high_id,u) then raise exception 'CONVERSATION_ACCESS_DENIED'; end if;
  if p_post_id is not null then
    perform 1 from public.posts where id=p_post_id for share;
    if p_other_business_id is not null then
      if private.public_post_business_id_for(p_post_id,u) is distinct from p_other_business_id then raise exception 'INVALID_BUSINESS_POST'; end if;
    elsif not exists(select 1 from public.posts p where p.id=p_post_id and p.author_id=p_other_user_id
      and p.business_author_id is null and p.status='published' and private.is_active_account(p.author_id)
      and not private.is_blocked_between(u,p.author_id) and not private.has_reported(u,'user',p.author_id)
      and not private.has_reported(u,'post',p.id)) then raise exception 'INVALID_BUSINESS_POST'; end if;
  end if;
  select id into found_id from public.conversations where kind='business' and status='active'
    and coalesce(user_low_id,business_low_id)=least(a,b) and coalesce(user_high_id,business_high_id)=greatest(a,b) for update;
  if found_id is not null then
    if p_post_id is not null then update public.conversations set context_post_id=p_post_id where id=found_id; end if;
    return found_id;
  end if;
  if p_other_user_id is not null and not private.is_admin_id(u) and private.live_chat_guarded(u,p_other_user_id,p_post_id) then raise exception 'REQUEST_COOLDOWN'; end if;
  perform private.enforce_rate_limit('conversation_request',20,interval '1 hour',interval '30 seconds');
  insert into public.conversations(kind,user_low_id,user_high_id,business_low_id,business_high_id,status,accepted_at,context_post_id)
    values('business',c.user_low_id,c.user_high_id,c.business_low_id,c.business_high_id,'active',now(),p_post_id) returning id into found_id;
  return found_id;
end;
$function$;
