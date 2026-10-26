-- Business co-manager seats are plus 1 / pro 2 / premium 5 (owner 2026-10-26 "1, 2, 5로").
create or replace function private.business_operator_limit(p_merchant_id uuid) returns int
language sql stable security definer set search_path='' as $$
  select case private.business_membership_details(p_merchant_id)->>'tier' when 'admin' then 1000 when 'premium' then 5 when 'pro' then 2 when 'plus' then 1
    else case when private.merchant_workspace_plan(p_merchant_id)<>'basic' then 1 else 0 end end;
$$;
