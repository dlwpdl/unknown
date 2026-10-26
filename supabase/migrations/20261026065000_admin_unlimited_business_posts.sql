-- Owner 2026-10-26: the admin writes posts for any business without a cap, and gets an alert with that business's
-- monthly count against its membership. Posts the admin writes don't use up the business's own monthly posts.
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

create or replace function private.consume_business_usage(p_merchant_id uuid, p_action text, p_post_id uuid, p_fingerprint text default null::text) returns void
language plpgsql security definer set search_path='' as $$
declare m private.merchants; d jsonb; managed boolean; used int; managed_used int; cap int;
begin
  select * into m from private.merchants where id=p_merchant_id for update;
  if m.id is null or p_action not in('post','bump','report') then raise exception 'INVALID_BUSINESS_USAGE'; end if;
  if m.status='paused' then raise exception 'MERCHANT_OPERATIONS_PAUSED'; end if;
  if m.consent='revoked' then raise exception 'MERCHANT_CONSENT_REQUIRED'; end if;
  if p_action in('post','report') and exists(select 1 from private.merchant_membership_usage where action=p_action and post_id=p_post_id) then
    if exists(select 1 from private.merchant_membership_usage where action=p_action and post_id=p_post_id and merchant_id<>m.id) then raise exception 'MERCHANT_POST_BUSINESS_CHANGED'; end if;
    return;
  end if;
  d:=private.business_membership_details(m.id);
  -- The admin acting for a business it doesn't own has no cap.
  managed:=auth.uid() is distinct from m.owner_id and coalesce(private.is_admin_id(auth.uid()),false);
  if p_action='post' then
    if exists(select 1 from private.merchant_membership_usage where merchant_id=m.id and fingerprint=p_fingerprint and post_id<>p_post_id)
      then raise exception 'DUPLICATE_PROMOTION'; end if;
    used:=(d->>'postsUsed')::int;managed_used:=(d->>'managedPostsUsed')::int;cap:=(d->>'postLimit')::int;
  elsif p_action='bump' then
    if (d->>'nextBumpAt')::timestamptz>now() then raise exception 'BUSINESS_BUMP_COOLDOWN'; end if;
    used:=(d->>'bumpsUsed')::int;cap:=(d->>'bumpLimit')::int;
  else
    -- Reports aren't sold now; keep recording them without a cap.
    if d->>'tier'<>'premium' then return; end if;
    managed:=true;
  end if;
  if not managed and cap is not null and used>=cap then raise exception 'BUSINESS_MONTHLY_LIMIT_REACHED'; end if;
  insert into private.merchant_membership_usage(merchant_id,action,post_id,fingerprint,managed) values(m.id,p_action,p_post_id,p_fingerprint,managed);
  if p_action='post' and managed then
    perform private.create_notification(auth.uid(),'merchant_operation',null,'post',p_post_id,
      m.name||' 글을 대신 올렸어요. 이번 달 '||(used+managed_used+1)||'개째예요(가게 '||used||' · 대신 '||(managed_used+1)||'). '||
      case when cap is null then '이 가게는 지금 글 수 제한이 없어요.'
        else case d->>'tier' when 'premium' then '프리미엄' when 'pro' then '프로' when 'plus' then '플러스' else '무료' end||' 멤버십은 한 달 '||cap||'개'||
          case when used+managed_used+1>cap then '라 '||(used+managed_used+1-cap)||'개 넘었어요.' else '예요.' end end,
      '/post/'||p_post_id::text);
  end if;
end $$;
