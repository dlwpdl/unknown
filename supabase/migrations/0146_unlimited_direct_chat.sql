-- Owner direction 2026-10-09: direct messages are free, unlimited, and need no acceptance.
-- Keep existing rooms, message history, moderation, blocks, and meetup capacity.
create or replace function private.membership_details(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with active as (
    select e from private.membership_accounts m, jsonb_array_elements(m.entitlements) e
    where m.user_id = p_user_id and (e->>'expires_at')::timestamptz > now()
    order by case e->>'tier' when 'premium' then 2 else 1 end desc limit 1
  ), selected as (select (select e from active) e)
  select jsonb_build_object(
    'tier', coalesce(e->>'tier','free'), 'expiresAt',e->>'expires_at',
    'store',e->>'store','productId',e->>'product_id','willRenew',e->'will_renew',
    'postLimit',case e->>'tier' when 'premium' then 3 when 'plus' then 2 else 1 end,
    'meetupLimit',case e->>'tier' when 'premium' then 7 when 'plus' then 4 else 2 end,
    'conversationLimit',null
  ) from selected;
$$;
revoke all on function private.membership_details(uuid) from public, anon, authenticated;

create or replace function public.get_membership() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); day date; details jsonb; groups integer; gl integer;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select (now() at time zone c.timezone)::date into day from public.profiles p join public.cities c on c.id=p.city_id where p.id=u;
  details:=private.membership_details(u); groups:=private.membership_meetup_count(u);
  gl:=private.relationship_locked_count(u,'group');
  return details||jsonb_build_object('postsUsed',(select count(*) from public.posts where author_id=u and posted_on=day and kind='story'),
    'meetupsUsed',groups,'conversationsUsed',private.direct_slot_count(u),'conversationPeriod','active',
    'meetupSlotsLocked',gl,'meetupSlotsAvailable',greatest(0,(details->>'meetupLimit')::integer-groups-gl),
    'conversationSlotsLocked',0,'conversationSlotsAvailable',null,
    'meetupUnlocksAt',coalesce((select jsonb_agg(unlocks_at order by unlocks_at) from private.relationship_cooldowns where user_id=u and pool='group' and unlocks_at>now()),'[]'::jsonb),
    'conversationUnlocksAt','[]'::jsonb,
    'listingsUsed',private.active_listing_count(u),'listingLimit',private.listing_limit(u));
end;
$$;

-- Resolve unexpired legacy requests without erasing historical refusals, blocks, or messages.
update public.conversations set status='cancelled',ended_at=created_at
where kind='direct' and status='pending' and created_at<=now()-interval '7 days';
update public.conversations set status='active',accepted_at=now()
where kind='direct' and status='pending'
  and private.is_active_account(user_low_id) and private.is_active_account(user_high_id)
  and not private.is_blocked_between(user_low_id,user_high_id);

create or replace function public.start_conversation(other_user_id uuid, p_post_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); c public.conversations; low_id uuid; high_id uuid; origin uuid;
begin
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
    return c.id;
  end if;
  -- Respect recent legacy refusals; capacity and ended-room slot locks are unrelated.
  if not private.is_admin_id(u) and exists(select 1 from public.conversations where kind='direct' and user_low_id=low_id and user_high_id=high_id
    and status in ('rejected','cancelled') and ended_at>now()-interval '24 hours') then raise exception 'REQUEST_COOLDOWN'; end if;
  perform private.enforce_rate_limit('conversation_request',20,interval '1 hour',interval '30 seconds');
  insert into public.conversations(user_low_id,user_high_id,requester_id,status,accepted_at,origin_post_id)
    values(low_id,high_id,u,'active',now(),origin) returning * into c;
  -- The existing message trigger notifies the recipient when a message is actually sent.
  return c.id;
end;
$$;

-- Old clients may still submit an acceptance; retain authorization and remove paid capacity checks.
create or replace function public.respond_direct_conversation(p_conversation_id uuid,p_response text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); c public.conversations;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u); perform private.lock_relationships();
  if p_response is null or p_response not in ('accepted','rejected','cancelled') then raise exception 'INVALID_RESPONSE'; end if;
  select * into c from public.conversations where id=p_conversation_id and kind='direct' and u in(user_low_id,user_high_id) for update;
  if c.id is null then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if (p_response='cancelled' and u<>c.requester_id) or (p_response<>'cancelled' and u=c.requester_id) then raise exception 'RECIPIENT_REQUIRED'; end if;
  if c.status='active' and p_response='accepted' then return c.id; end if;
  if c.status<>'pending' then raise exception 'REQUEST_ALREADY_RESOLVED'; end if;
  if p_response='accepted' then
    if c.created_at<=now()-interval '7 days' then raise exception 'REQUEST_EXPIRED'; end if;
    if private.is_blocked_between(c.user_low_id,c.user_high_id) then raise exception 'BLOCKED'; end if;
    perform private.assert_active_account(c.user_low_id); perform private.assert_active_account(c.user_high_id);
    update public.conversations set status='active',accepted_at=now() where id=c.id;
    return c.id;
  end if;
  update public.conversations set status=p_response,ended_at=now() where id=c.id;
  return null;
end;
$$;

create or replace function private.finish_direct_conversation(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.conversations;
begin
  perform private.lock_relationships();
  select * into c from public.conversations where id=p_conversation_id and kind='direct' for update;
  if c.status='active' then
    update public.conversations set status='ended',ended_at=now() where id=c.id;
  elsif c.status='pending' then
    update public.conversations set status='cancelled',ended_at=now() where id=c.id;
  end if;
end;
$$;
revoke all on function private.finish_direct_conversation(uuid) from public, anon, authenticated;
revoke all on function public.get_membership(),public.start_conversation(uuid,uuid),public.respond_direct_conversation(uuid,text) from public, anon;
grant execute on function public.get_membership(),public.start_conversation(uuid,uuid),public.respond_direct_conversation(uuid,text) to authenticated;
