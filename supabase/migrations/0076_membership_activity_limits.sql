-- Only new activity uses the revised caps; existing memberships and conversations remain intact.
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
    'conversationLimit',case e->>'tier' when 'premium' then 7 when 'plus' then 4 else 2 end
  ) from selected;
$$;
revoke all on function private.membership_details(uuid) from public, anon, authenticated;

