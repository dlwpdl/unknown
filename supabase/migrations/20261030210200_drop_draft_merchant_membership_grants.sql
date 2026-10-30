-- Security audit 2026-10-30: two admin membership grant systems could both be live. The admin dashboard
-- (gling-admin-current-20261017, admin-user-membership.tsx) and this app only call the 2026-10-30 RPCs
-- get/set/clear_admin_membership on private.admin_membership_grants. The 2026-10-27 draft
-- (private.merchant_membership_grants, public.get/set/clear_admin_merchant_membership) was never committed, has no
-- caller, but may have been applied by hand; a grant cleared in one system could then live on in the other.
-- This drops the draft and puts back the committed business membership bodies the draft replaced.
-- It refuses to run while the draft table holds any grant, or if either body is neither the committed nor the draft one.
do $$
declare
  base text:=md5((select prosrc from pg_proc where oid='private.business_membership_details_base(uuid)'::regprocedure));
  wrap text:=md5((select prosrc from pg_proc where oid='private.business_membership_details(uuid)'::regprocedure));
  draft_rows boolean:=false;
begin
  -- Dynamic so this also runs where the draft table never existed.
  if to_regclass('private.merchant_membership_grants') is not null then
    execute 'select exists(select 1 from private.merchant_membership_grants)' into draft_rows;
  end if;
  if draft_rows then raise exception 'DRAFT_MEMBERSHIP_GRANTS_PRESENT'; end if;
  -- committed 20261026065000 / draft 20261027120000
  if base not in('7c022c71262a241cfb71229f53657691','dba06b0684ceaae36533345a075a53e4') then raise exception 'BUSINESS_MEMBERSHIP_BASE_CHANGED'; end if;
  -- committed 20261026000000 / draft 20261027120000
  if wrap not in('49904a82fe1b19d37c4aecda5190526d','e60545c0a688379936d81829fbc7465a') then raise exception 'BUSINESS_MEMBERSHIP_WRAPPER_CHANGED'; end if;
end;
$$;

drop function if exists public.clear_admin_merchant_membership(uuid);
drop function if exists public.set_admin_merchant_membership(uuid,text,date);
drop function if exists public.get_admin_merchant_membership(uuid);

-- Committed bodies, verbatim from 20261026065000 and 20261026000000 (create or replace keeps owner and grants).
create or replace function private.business_membership_details_base(p_merchant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with selected as(
    select m,(now() at time zone c.timezone)::date local_today,case when m.owner_verified_at is not null and b.user_id=m.owner_id and private.is_active_account(b.user_id)
      then private.membership_entitlement(b.user_id,'business') end e
    from private.merchants m join public.cities c on c.id=m.city_id left join private.business_membership_bindings b on b.merchant_id=m.id where m.id=p_merchant_id
  ), usage as(
    select count(*) filter(where action='post')posts,count(*) filter(where action='bump')bumps,
      count(*) filter(where action='post' and managed)managed_posts,count(*) filter(where action='bump' and managed)managed_bumps,
      count(*) filter(where action='report')reports
    from private.merchant_membership_usage where merchant_id=p_merchant_id and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'
  ) select jsonb_build_object('merchantId',p_merchant_id,'tier',coalesce(e->>'tier','free'),
    'expiresAt',e->>'expires_at','productId',e->>'product_id','store',e->>'store','willRenew',e->'will_renew',
    'canPurchase',auth.uid()=(m).owner_id and (m).owner_verified_at is not null,
    'postLimit',case when e is null and (((m).status='paid' and (m).workspace_until>=local_today) or ((m).status='trial' and (m).trial_ends_at>=local_today)) then null
      else case e->>'tier' when 'premium' then 10 when 'pro' then 5 when 'plus' then 2 else 1 end end,
    'bumpLimit',case when e->>'tier' in('plus','pro','premium') then null else 2 end,
    'bumpCooldownHours',case e->>'tier' when 'premium' then 12 when 'pro' then 24 when 'plus' then 48 else 120 end,
    'managedPostLimit',0,
    'managedBumpLimit',0,
    'reportLimit',0,
    -- postsUsed/bumpsUsed are the business's own; the admin's share is reported separately.
    'postsUsed',posts-managed_posts,'bumpsUsed',bumps-managed_bumps,'managedPostsUsed',managed_posts,'managedBumpsUsed',managed_bumps,'reportsUsed',reports,
    'resetsAt',(date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')+interval '1 month',
    'nextBumpAt',(select max(created_at)+make_interval(hours=>case e->>'tier' when 'premium' then 12 when 'pro' then 24 when 'plus' then 48 else 120 end) from private.merchant_membership_usage where merchant_id=p_merchant_id and action='bump'))
    from selected cross join usage;
$$;

create or replace function private.business_membership_details(p_merchant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  -- Null caps mean unlimited to consume_business_usage; usage counts are kept for the record.
  select case when exists(select 1 from private.merchants m join private.admin_ids a on a.user_id=m.owner_id where m.id=p_merchant_id)
    then b||jsonb_build_object('tier','admin','expiresAt','9999-12-31T00:00:00Z','canPurchase',false,'postLimit',null,'bumpLimit',null,
      'bumpCooldownHours',0,'managedPostLimit',null,'managedBumpLimit',null,'reportLimit',null,'nextBumpAt',null)
    else b end
  from (select private.business_membership_details_base(p_merchant_id) b) s;
$$;

drop table if exists private.merchant_membership_grants;
notify pgrst,'reload schema';
