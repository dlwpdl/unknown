-- Owner 2026-10-26: the admin can do everything for any business — no plan locks, bump cooldowns or post caps.

CREATE OR REPLACE FUNCTION private.assert_merchant_content_access(p_merchant_id uuid, p_advanced boolean DEFAULT false, p_write boolean DEFAULT false)
 RETURNS private.merchants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m private.merchants; uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=uid and account_status='active' for share;
  if not found then raise exception 'ACCOUNT_LOCKED'; end if;
  perform private.assert_merchant_access();
  if p_write then select * into m from private.merchants where id=p_merchant_id for update;
  else select * into m from private.merchants where id=p_merchant_id for share; end if;
  if m.id is null or m.deleted_at is not null then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  if private.is_admin() then perform public.log_admin_access('analytics');
  elsif m.owner_id is distinct from uid then
    perform 1 from private.merchant_operators where merchant_id=m.id and user_id=uid for share;
    if not found or m.owner_verified_at is null then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  end if;
  if p_advanced and not private.is_admin() and private.merchant_workspace_plan(m.id)='basic' then raise exception 'MERCHANT_PLAN_REQUIRED'; end if;
  return m;
end;
$function$;

CREATE OR REPLACE FUNCTION private.assert_merchant_workspace(p_merchant_id uuid, p_advanced boolean DEFAULT false)
 RETURNS private.merchants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m private.merchants; uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=uid and account_status='active' for share;
  if not found then raise exception 'ACCOUNT_LOCKED'; end if;
  perform private.assert_merchant_access();
  if private.is_admin() then perform public.log_admin_access('analytics'); end if;
  select * into m from private.merchants where id=p_merchant_id for update;
  if m.id is null or m.deleted_at is not null or (not private.is_admin() and m.owner_id is distinct from uid) then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  if p_advanced and not private.is_admin() and private.merchant_workspace_plan(m.id)='basic' then raise exception 'MERCHANT_PLAN_REQUIRED'; end if;
  return m;
end;
$function$;

CREATE OR REPLACE FUNCTION public.business_paid_features(p_merchant_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from private.merchants m where m.id=p_merchant_id and (m.owner_id=auth.uid() or private.is_admin()
    or exists(select 1 from private.merchant_operators o where o.merchant_id=m.id and o.user_id=auth.uid()))) then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  return coalesce(private.is_admin_id(auth.uid()),false) or private.merchant_workspace_plan(p_merchant_id)<>'basic';
end;
$function$;

CREATE OR REPLACE FUNCTION private.consume_business_usage(p_merchant_id uuid, p_action text, p_post_id uuid, p_fingerprint text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if not managed and (d->>'nextBumpAt')::timestamptz>now() then raise exception 'BUSINESS_BUMP_COOLDOWN'; end if;
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
end $function$;
