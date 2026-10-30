-- Owner 2026-10-30: the admin can give a member a personal membership, or a business its business membership,
-- for a set period. It never charges or renews (store 'admin'); a higher paid plan still wins.
-- Continues the uncommitted 2026-10-27 draft (20261027120000_admin_business_membership_control.sql), but plugs the
-- grant into private.membership_entitlement like invite rewards do, so get_membership, business limits and the
-- workspace plan all follow it without copying their bodies.

-- Append-only: the latest row per member/business is the current state (tier null = cleared). Rows are the history.
create table private.admin_membership_grants(
  id bigint generated always as identity primary key,
  kind text not null check(kind in('general','business')),
  user_id uuid references public.profiles(id) on delete cascade,
  merchant_id uuid references private.merchants(id) on delete cascade,
  tier text check(tier in('plus','pro','premium')),
  expires_at timestamptz,
  note text check(note is null or length(note)<=500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check((kind='general' and user_id is not null and merchant_id is null) or (kind='business' and merchant_id is not null and user_id is null)),
  check((tier is null)=(expires_at is null))
);
create index admin_membership_grants_user on private.admin_membership_grants(user_id,id desc) where kind='general';
create index admin_membership_grants_merchant on private.admin_membership_grants(merchant_id,id desc) where kind='business';
alter table private.admin_membership_grants owner to postgres;
revoke all on private.admin_membership_grants from public,anon,authenticated,service_role;

create function private.admin_membership_entitlement(p_user_id uuid,p_kind text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('tier',g.tier,'kind',g.kind,'store','admin','plan_version','2','will_renew',false,
    'product_id','gling.admin.'||g.kind||'.'||g.tier,'expires_at',g.expires_at)
  from (select * from private.admin_membership_grants
    where case when p_kind='business'
      then kind='business' and merchant_id=(select merchant_id from private.business_membership_bindings where user_id=p_user_id)
      else kind='general' and user_id=p_user_id end
    order by id desc limit 1) g
  where g.tier is not null and g.expires_at>now();
$$;

-- Same contract as 20261029120000: highest tier wins; on a tie paid beats the admin grant, which beats an invite reward.
create or replace function private.membership_entitlement(p_user_id uuid,p_kind text) returns jsonb
language sql stable security definer set search_path='' as $$
  select e from (
    select private.store_membership_entitlement(p_user_id,p_kind) e,2 rank
    union all select private.admin_membership_entitlement(p_user_id,p_kind),1
    union all select private.invite_reward_entitlement(p_user_id,p_kind),0
  ) c where e is not null
  order by case e->>'tier' when 'premium' then 3 when 'pro' then 2 else 1 end desc,rank desc limit 1;
$$;

create function private.admin_membership_source(p_tier text,p_store text) returns text
language sql immutable set search_path='' as $$
  select case when p_tier='admin' then 'operator' when coalesce(p_tier,'free')='free' then 'free'
    when p_store='admin' then 'admin' when p_store='reward' then 'reward' else 'store' end;
$$;

create function private.admin_membership_grant_json(p_kind text,p_user_id uuid,p_merchant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when g.tier is null then null else jsonb_build_object('tier',g.tier,'expires_at',g.expires_at,
    'active',g.expires_at>now(),'note',g.note,'created_at',g.created_at,'created_by',p.nickname) end
  from (select * from private.admin_membership_grants where kind=p_kind
    and case when p_kind='business' then merchant_id=p_merchant_id else user_id=p_user_id end order by id desc limit 1) g
  left join public.profiles p on p.id=g.created_by;
$$;

create function public.get_admin_membership(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_user_id is null or not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  d:=private.membership_details(p_user_id);
  select jsonb_build_object('user_id',p_user_id,
    'personal',jsonb_build_object('tier',d->>'tier','source',private.admin_membership_source(d->>'tier',d->>'store'),
      'expires_at',d->>'expiresAt','will_renew',d->'willRenew','grant',private.admin_membership_grant_json('general',p_user_id,null)),
    'businesses',coalesce((select jsonb_agg(jsonb_build_object('merchant_id',m.id,'name',m.name,'city_name',c.name,
        'owner_verified',m.owner_verified_at is not null,
        'bound_elsewhere',exists(select 1 from private.business_membership_bindings b where b.user_id=p_user_id and b.merchant_id<>m.id)
          or exists(select 1 from private.business_membership_bindings b where b.merchant_id=m.id and b.user_id<>p_user_id),
        'tier',bd->>'tier','source',private.admin_membership_source(bd->>'tier',bd->>'store'),'expires_at',bd->>'expiresAt',
        'will_renew',bd->'willRenew','grant',private.admin_membership_grant_json('business',null,m.id)) order by m.name,m.id)
      from private.merchants m join public.cities c on c.id=m.city_id
      cross join lateral (select private.business_membership_details(m.id) bd) x
      where m.owner_id=p_user_id and m.record_kind='business' and m.deleted_at is null),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'kind',h.kind,'merchant_name',m.name,'tier',h.tier,
        'expires_at',h.expires_at,'note',h.note,'created_at',h.created_at,'created_by',p.nickname) order by h.id desc)
      from (select * from private.admin_membership_grants g where g.user_id=p_user_id
        or g.merchant_id in(select id from private.merchants where owner_id=p_user_id) order by g.id desc limit 30) h
      left join private.merchants m on m.id=h.merchant_id left join public.profiles p on p.id=h.created_by),'[]'::jsonb))
  into result;
  perform public.log_admin_access('user_detail',p_user_id,null);
  return result;
end $$;

-- p_merchant_id null = the member's personal membership; otherwise that member's business.
create function public.set_admin_membership(p_user_id uuid,p_merchant_id uuid,p_tier text,p_expires_on date,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.merchants; tz text; note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_tier is null or p_tier not in('plus','pro','premium') then raise exception 'INVALID_MEMBERSHIP_TIER'; end if;
  if note is not null and length(note)>500 then raise exception 'INVALID_MEMBERSHIP_NOTE'; end if;
  perform 1 from public.profiles where id=p_user_id and account_status='active' for share;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-membership:'||coalesce(p_merchant_id,p_user_id)::text,0));
  if p_merchant_id is null then
    select c.timezone into tz from public.profiles p join public.cities c on c.id=p.city_id where p.id=p_user_id;
  else
    select * into m from private.merchants where id=p_merchant_id for update;
    if m.id is null or m.record_kind<>'business' or m.deleted_at is not null or m.owner_id is distinct from p_user_id then raise exception 'MERCHANT_NOT_FOUND'; end if;
    -- Business membership reaches a business only through its verified owner's single binding.
    if m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
    if exists(select 1 from private.business_membership_bindings where (user_id=p_user_id and merchant_id<>m.id) or (merchant_id=m.id and user_id<>p_user_id))
      then raise exception 'BUSINESS_SUBSCRIPTION_BOUND'; end if;
    insert into private.business_membership_bindings(user_id,merchant_id) values(p_user_id,m.id) on conflict do nothing;
    select timezone into tz from public.cities where id=m.city_id;
  end if;
  tz:=coalesce(tz,'America/Vancouver');
  if p_expires_on is null or p_expires_on<(now() at time zone tz)::date or p_expires_on>(now() at time zone tz)::date+interval '3 years'
    then raise exception 'INVALID_MEMBERSHIP_EXPIRY'; end if;
  insert into private.admin_membership_grants(kind,user_id,merchant_id,tier,expires_at,note,created_by)
    values(case when m.id is null then 'general' else 'business' end,case when m.id is null then p_user_id end,m.id,p_tier,
      ((p_expires_on+1)::timestamp at time zone tz)-interval '1 second',note,auth.uid());
  perform public.log_admin_access('user_detail',p_user_id,m.id);
  return public.get_admin_membership(p_user_id);
end $$;

create function public.clear_admin_membership(p_user_id uuid,p_merchant_id uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare note text:=nullif(btrim(coalesce(p_note,'')),''); kind text:=case when p_merchant_id is null then 'general' else 'business' end;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if note is not null and length(note)>500 then raise exception 'INVALID_MEMBERSHIP_NOTE'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  if p_merchant_id is not null and not exists(select 1 from private.merchants where id=p_merchant_id and owner_id=p_user_id)
    then raise exception 'MERCHANT_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-membership:'||coalesce(p_merchant_id,p_user_id)::text,0));
  -- Only record a clear when a grant is currently on file; repeated clicks add nothing.
  if private.admin_membership_grant_json(kind,p_user_id,p_merchant_id) is not null then
    insert into private.admin_membership_grants(kind,user_id,merchant_id,note,created_by)
      values(kind,case when p_merchant_id is null then p_user_id end,p_merchant_id,note,auth.uid());
  end if;
  perform public.log_admin_access('user_detail',p_user_id,p_merchant_id);
  return public.get_admin_membership(p_user_id);
end $$;

do $$ declare signature text; begin
  foreach signature in array array[
    'private.admin_membership_entitlement(uuid,text)','private.membership_entitlement(uuid,text)',
    'private.admin_membership_source(text,text)','private.admin_membership_grant_json(text,uuid,uuid)',
    'public.get_admin_membership(uuid)','public.set_admin_membership(uuid,uuid,text,date,text)','public.clear_admin_membership(uuid,uuid,text)'
  ] loop
    execute 'alter function '||signature||' owner to postgres';
    execute 'revoke all on function '||signature||' from public, anon, authenticated, service_role';
  end loop;
end $$;
grant execute on function public.get_admin_membership(uuid),public.set_admin_membership(uuid,uuid,text,date,text),
  public.clear_admin_membership(uuid,uuid,text) to authenticated;

notify pgrst,'reload schema';
