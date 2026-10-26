-- The operator account gets its own "admin" tier in both personal and business memberships: nothing is limited.
-- Admin identity comes from private.admin_ids (0087), which only a verified admin session can populate.
-- Everyone else keeps the existing tier logic, now living in the *_base functions.

alter function private.membership_details(uuid) rename to membership_details_base;
create function private.membership_details(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when exists(select 1 from private.admin_ids where user_id=p_user_id)
    then jsonb_build_object('tier','admin','expiresAt','9999-12-31T00:00:00Z','store','admin','willRenew',true,'productId',null,
      'planVersion',2,'postLimit',1000,'meetupLimit',1000,'conversationLimit',null)
    else private.membership_details_base(p_user_id) end;
$$;
revoke all on function private.membership_details(uuid) from public,anon,authenticated;

alter function private.business_membership_details(uuid) rename to business_membership_details_base;
create function private.business_membership_details(p_merchant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  -- Null caps mean unlimited to consume_business_usage; usage counts are kept for the record.
  select case when exists(select 1 from private.merchants m join private.admin_ids a on a.user_id=m.owner_id where m.id=p_merchant_id)
    then b||jsonb_build_object('tier','admin','expiresAt','9999-12-31T00:00:00Z','canPurchase',false,'postLimit',null,'bumpLimit',null,
      'bumpCooldownHours',0,'managedPostLimit',null,'managedBumpLimit',null,'reportLimit',null,'nextBumpAt',null)
    else b end
  from (select private.business_membership_details_base(p_merchant_id) b) s;
$$;
revoke all on function private.business_membership_details(uuid) from public,anon,authenticated;

create or replace function private.require_meetup_tool_tier(p_user_id uuid,p_minimum text) returns void
language plpgsql security definer set search_path='' as $$
declare tier text:=private.meetup_tool_tier(p_user_id);
begin
  if (case tier when 'admin' then 4 when 'premium' then 3 when 'pro' then 2 when 'plus' then 1 else 0 end)
    <(case p_minimum when 'premium' then 3 when 'pro' then 2 else 1 end) then
    raise exception '%_REQUIRED',upper(p_minimum);
  end if;
end;
$$;

create or replace function private.listing_limit(p_user_id uuid) returns integer
language sql stable security definer set search_path='' as $$
  select case private.membership_details(p_user_id)->>'tier' when 'admin' then 1000 when 'premium' then 20 when 'pro' then 20 when 'plus' then 10 else 5 end;
$$;

create or replace function private.business_operator_limit(p_merchant_id uuid) returns int
language sql stable security definer set search_path='' as $$
  select case private.business_membership_details(p_merchant_id)->>'tier' when 'admin' then 1000 when 'premium' then 5 when 'pro' then 3 when 'plus' then 1
    else case when private.merchant_workspace_plan(p_merchant_id)<>'basic' then 1 else 0 end end;
$$;

-- Meetup seats: the admin account gets the validator's maximum; other tiers are unchanged here.
create or replace function private.meetup_capacity_limit(p_user_id uuid) returns integer
language sql stable security definer set search_path='' as $$
  select case when not private.is_active_account(p_user_id) then 50
    when private.membership_details(p_user_id)->>'tier'='admin' then 5000
    when private.membership_details(p_user_id)->>'tier' in ('plus','pro','premium') then 5000 else 50 end;
$$;
