-- General and canonical-business subscriptions are separate verified receipt families.
create or replace function public.apply_membership_snapshot(p_user_id uuid,p_entitlements jsonb,p_observed_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_observed_at is null or p_observed_at>clock_timestamp()+interval '1 minute'
    or p_entitlements is null or jsonb_typeof(p_entitlements)<>'array' then raise exception 'INVALID_MEMBERSHIP'; end if;
  if jsonb_array_length(p_entitlements)>8 or exists(
    select 1 from jsonb_array_elements(p_entitlements)e
    where coalesce(e->>'tier','') not in('plus','pro','premium')
      or coalesce(e->>'kind','general') not in('general','business')
      or coalesce(e->>'plan_version','1') not in('1','2')
      or (coalesce(e->>'plan_version','1')='1' and (coalesce(e->>'kind','general')<>'general' or e->>'tier'='pro'))
      or coalesce(e->>'store','') not in('app_store','play_store','test_store')
      or coalesce(e->>'product_id','')='' or length(e->>'product_id')>256
      or jsonb_typeof(e->'product_id') is distinct from 'string'
      or (coalesce(e->>'plan_version','1')='1' and e->>'product_id'~'(\.v2$|_v2:)')
      or coalesce(jsonb_typeof(e->'will_renew'),'')<>'boolean'
      or (e->>'expires_at')::timestamptz is null
      or not isfinite((e->>'expires_at')::timestamptz)
      or (e->>'plan_version'='2' and (e->>'kind' is null or not coalesce((
        (e->>'store' in('app_store','test_store') and e->>'product_id'='com.dlwpdl.gling.'||(e->>'kind')||'.'||(e->>'tier')||'.monthly.v2')
        or (e->>'store' in('play_store','test_store') and e->>'product_id'='gling_'||(e->>'kind')||'_'||(e->>'tier')||'_v2:monthly')),false)))
  ) or (select count(*)<>count(distinct(coalesce(e->>'kind','general'),e->>'tier',coalesce(e->>'plan_version','1'))) from jsonb_array_elements(p_entitlements)e)
    then raise exception 'INVALID_MEMBERSHIP'; end if;
  if not private.is_active_account(p_user_id) then return false; end if;
  insert into private.membership_accounts(user_id,entitlements,observed_at) values(p_user_id,p_entitlements,p_observed_at)
    on conflict(user_id) do update set entitlements=excluded.entitlements,observed_at=excluded.observed_at,synced_at=now()
    where excluded.observed_at>membership_accounts.observed_at;
  return found;
end;
$$;
revoke all on function public.apply_membership_snapshot(uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.apply_membership_snapshot(uuid,jsonb,timestamptz) to service_role;

create function private.membership_entitlement(p_user_id uuid,p_kind text) returns jsonb
language sql stable security definer set search_path='' as $$
  select e from private.membership_accounts m,jsonb_array_elements(m.entitlements)e
  where m.user_id=p_user_id and coalesce(e->>'kind','general')=p_kind and (e->>'expires_at')::timestamptz>now()
  order by case e->>'tier' when 'premium' then 3 when 'pro' then 2 else 1 end desc,
    coalesce(e->>'plan_version','1')::int desc,(e->>'expires_at')::timestamptz desc limit 1;
$$;
revoke all on function private.membership_entitlement(uuid,text) from public,anon,authenticated;

create or replace function private.membership_details(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('tier',coalesce(e->>'tier','free'),'expiresAt',e->>'expires_at',
    'store',e->>'store','willRenew',e->'will_renew','productId',e->>'product_id',
    'planVersion',case when e is null then 2 else coalesce(e->>'plan_version','1')::int end,
    'postLimit',case e->>'tier' when 'premium' then 3 when 'pro' then 3 when 'plus' then 2 else 1 end,
    'meetupLimit',case e->>'tier' when 'premium' then 20 when 'pro' then 10 when 'plus' then 5 else 3 end,
    'conversationLimit',null) from(select private.membership_entitlement(p_user_id,'general')e)s;
$$;
revoke all on function private.membership_details(uuid) from public,anon,authenticated;

create or replace function private.listing_limit(p_user_id uuid) returns integer
language sql stable security definer set search_path='' as $$
  select case private.membership_details(p_user_id)->>'tier' when 'premium' then 20 when 'pro' then 20 when 'plus' then 10 else 5 end;
$$;
create or replace function private.bump_cooldown(p_user_id uuid) returns interval
language sql stable security definer set search_path='' as $$
  select case when coalesce(e->>'plan_version','1')='1' and e is not null
    then case e->>'tier' when 'premium' then interval '12 hours' else interval '18 hours' end
    else case e->>'tier' when 'premium' then interval '24 hours' when 'pro' then interval '30 hours' when 'plus' then interval '36 hours' else interval '48 hours' end end
  from(select private.membership_entitlement(p_user_id,'general')e)s;
$$;
revoke all on function private.listing_limit(uuid),private.bump_cooldown(uuid) from public,anon,authenticated;

create table private.personal_bump_state(user_id uuid primary key references public.profiles(id) on delete cascade,last_bumped_at timestamptz not null);
create table private.business_membership_bindings(
  user_id uuid primary key references public.profiles(id) on delete cascade,
  merchant_id uuid not null unique references private.merchants(id),created_at timestamptz not null default now()
);
-- No post FK: deletion, editing, restoration or a month change must not erase charged usage/duplicate history.
create table private.merchant_membership_usage(
  id bigint generated always as identity primary key,merchant_id uuid not null references private.merchants(id),
  action text not null check(action in('post','bump','report')),post_id uuid, fingerprint text,
  managed boolean not null default false,created_at timestamptz not null default now()
);
create unique index merchant_usage_post_once on private.merchant_membership_usage(post_id) where action='post';
create unique index merchant_usage_report_once on private.merchant_membership_usage(post_id) where action='report';
create index merchant_usage_month on private.merchant_membership_usage(merchant_id,created_at,action);
create index merchant_usage_fingerprint on private.merchant_membership_usage(merchant_id,fingerprint) where fingerprint is not null;
revoke all on private.personal_bump_state,private.business_membership_bindings,private.merchant_membership_usage from public,anon,authenticated,service_role;

create function private.promotion_fingerprint(p_body text) returns text
language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(regexp_replace(lower(replace(replace(p_body,
    '업체에서 직접 게시한 안내입니다.',''),'업체의 허락을 받아 글링에서 대신 게시한 안내입니다.','')),'[^[:alnum:]가-힣]+','','g'),'UTF8')),'hex');
$$;
revoke all on function private.promotion_fingerprint(text) from public,anon,authenticated;
insert into private.merchant_membership_usage(merchant_id,action,post_id,fingerprint,created_at)
  select mp.merchant_id,'post',mp.post_id,private.promotion_fingerprint(p.body),mp.created_at
  from private.merchant_posts mp join public.posts p on p.id=mp.post_id on conflict do nothing;

create function private.business_membership_details(p_merchant_id uuid) returns jsonb
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
      else case e->>'tier' when 'premium' then 30 when 'pro' then 30 when 'plus' then 12 else 4 end end,
    'bumpLimit',case e->>'tier' when 'premium' then 24 when 'pro' then 16 when 'plus' then 8 else 0 end,
    'bumpCooldownHours',case e->>'tier' when 'premium' then 48 when 'pro' then 60 else 72 end,
    'managedPostLimit',case e->>'tier' when 'premium' then 4 else 0 end,
    'managedBumpLimit',case e->>'tier' when 'premium' then 8 else 0 end,
    'reportLimit',case e->>'tier' when 'premium' then 1 else 0 end,
    'postsUsed',posts,'bumpsUsed',bumps,'managedPostsUsed',managed_posts,'managedBumpsUsed',managed_bumps,'reportsUsed',reports,
    'resetsAt',(date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')+interval '1 month',
    'nextBumpAt',(select max(created_at)+interval '24 hours' from private.merchant_membership_usage where merchant_id=p_merchant_id and action='bump'))
    from selected cross join usage;
$$;
revoke all on function private.business_membership_details(uuid) from public,anon,authenticated;

create function public.get_business_membership(p_merchant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_merchant_content_access(p_merchant_id);
  return private.business_membership_details(p_merchant_id);
end;
$$;
create function public.bind_business_membership(p_merchant_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); m private.merchants; old_id uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  m:=private.assert_merchant_workspace(p_merchant_id);
  if m.owner_id<>u then raise exception 'MERCHANT_OWNER_REQUIRED'; end if;
  if m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
  if m.status='paused' then raise exception 'MERCHANT_OPERATIONS_PAUSED'; end if;
  select merchant_id into old_id from private.business_membership_bindings where user_id=u;
  if old_id=p_merchant_id then return; end if;
  if old_id is not null then raise exception 'BUSINESS_SUBSCRIPTION_BOUND'; end if;
  if exists(select 1 from private.business_membership_bindings where merchant_id=p_merchant_id and user_id<>u) then raise exception 'BUSINESS_SUBSCRIPTION_BOUND'; end if;
  insert into private.business_membership_bindings(user_id,merchant_id) values(u,p_merchant_id) on conflict do nothing;
  if not exists(select 1 from private.business_membership_bindings where user_id=u and merchant_id=p_merchant_id) then raise exception 'BUSINESS_SUBSCRIPTION_BOUND'; end if;
end;
$$;
revoke all on function public.get_business_membership(uuid),public.bind_business_membership(uuid) from public,anon,authenticated;
grant execute on function public.get_business_membership(uuid),public.bind_business_membership(uuid) to authenticated;

create or replace function private.merchant_workspace_plan(p_merchant_id uuid) returns text
language sql stable security definer set search_path='' as $$
  select case when private.business_membership_details(m.id)->>'tier'<>'free' then 'pro'
    when m.status='paid' and m.workspace_until>=(now() at time zone c.timezone)::date then 'pro'
    when m.status='trial' and m.trial_ends_at>=(now() at time zone c.timezone)::date then 'trial' else 'basic' end
  from private.merchants m join public.cities c on c.id=m.city_id where m.id=p_merchant_id;
$$;
revoke all on function private.merchant_workspace_plan(uuid) from public,anon,authenticated;

create function private.consume_business_usage(p_merchant_id uuid,p_action text,p_post_id uuid,p_fingerprint text default null) returns void
language plpgsql security definer set search_path='' as $$
declare m private.merchants; d jsonb; managed boolean; used int; managed_used int; cap int; managed_cap int;
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
  managed:=d->>'tier'='premium' and auth.uid()<>m.owner_id and private.is_admin_id(auth.uid());
  if p_action='post' then
    if exists(select 1 from private.merchant_membership_usage where merchant_id=m.id and fingerprint=p_fingerprint and post_id<>p_post_id)
      then raise exception 'DUPLICATE_PROMOTION'; end if;
    used:=(d->>'postsUsed')::int;managed_used:=(d->>'managedPostsUsed')::int;cap:=(d->>'postLimit')::int;managed_cap:=(d->>'managedPostLimit')::int;
  elsif p_action='bump' then
    if (d->>'nextBumpAt')::timestamptz>now() then raise exception 'BUSINESS_BUMP_COOLDOWN'; end if;
    used:=(d->>'bumpsUsed')::int;managed_used:=(d->>'managedBumpsUsed')::int;cap:=(d->>'bumpLimit')::int;managed_cap:=(d->>'managedBumpLimit')::int;
  else
    if d->>'tier'<>'premium' then return; end if;
    used:=(d->>'reportsUsed')::int;managed_used:=used;cap:=(d->>'reportLimit')::int;managed_cap:=cap;managed:=true;
  end if;
  if cap is not null and (used>=cap or (managed and managed_used>=managed_cap) or (not managed and used-managed_used>=cap-managed_cap)) then raise exception 'BUSINESS_MONTHLY_LIMIT_REACHED'; end if;
  insert into private.merchant_membership_usage(merchant_id,action,post_id,fingerprint,managed) values(m.id,p_action,p_post_id,p_fingerprint,managed);
end;
$$;
revoke all on function private.consume_business_usage(uuid,text,uuid,text) from public,anon,authenticated,service_role;

create function private.track_business_post_usage() returns trigger
language plpgsql security definer set search_path='' as $$
declare body text;
begin
  select p.body into body from public.posts p where p.id=new.post_id;
  perform private.consume_business_usage(new.merchant_id,'post',new.post_id,private.promotion_fingerprint(body));
  return new;
end;
$$;
create trigger merchant_post_membership_quota before insert or update of merchant_id on private.merchant_posts for each row execute function private.track_business_post_usage();
create function private.track_business_report_usage() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform private.consume_business_usage(new.merchant_id,'report',new.id); return new; end;
$$;
create trigger merchant_report_membership_quota before insert on private.merchant_reports for each row execute function private.track_business_report_usage();
revoke all on function private.track_business_post_usage(),private.track_business_report_usage() from public,anon,authenticated,service_role;

create or replace function public.bump_post(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); p public.posts; mid uuid; cooldown interval; next_at timestamptz; last_at timestamptz; legacy boolean;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select merchant_id into mid from private.merchant_posts where post_id=p_post_id;
  if mid is not null then perform private.assert_merchant_content_access(mid,false,true);
  else perform 1 from public.profiles where id=u for update; end if;
  select * into p from public.posts where id=p_post_id for update;
  if p.id is null or (mid is null and p.author_id<>u) then raise exception 'POST_NOT_FOUND'; end if;
  if not private.listing_alive(p.kind,p.status,p.listing_status,p.expires_at) or p.room_preview is not null
    or exists(select 1 from public.tags where id=p.tag_id and kind='meetup') then raise exception 'LISTING_NOT_OPEN'; end if;
  if mid is not null then
    cooldown:=make_interval(hours=>(private.business_membership_details(mid)->>'bumpCooldownHours')::int);
  else
    cooldown:=private.bump_cooldown(u);
    legacy:=(private.membership_details(u)->>'planVersion')::int=1;
    select last_bumped_at into last_at from private.personal_bump_state where user_id=u;
    if not legacy and last_at+cooldown>now() then raise exception 'BUMP_COOLDOWN'; end if;
  end if;
  next_at:=greatest(p.created_at,coalesce(p.bumped_at,p.created_at))+cooldown;
  if next_at>now() then raise exception using message=case when mid is not null then 'BUSINESS_BUMP_COOLDOWN' else 'BUMP_COOLDOWN' end; end if;
  if mid is not null then perform private.consume_business_usage(mid,'bump',p.id);
  else insert into private.personal_bump_state(user_id,last_bumped_at) values(u,now()) on conflict(user_id) do update set last_bumped_at=excluded.last_bumped_at; end if;
  update public.posts set sort_at=now(),bumped_at=now(),bump_count=bump_count+1,
    expires_at=case when kind='listing' then now()+interval '14 days' else expires_at end where id=p.id;
  return jsonb_build_object('bumpedAt',now(),'nextBumpAt',now()+cooldown,'expiresAt',case when p.kind='listing' then now()+interval '14 days' else p.expires_at end);
end;
$$;
revoke all on function public.bump_post(uuid) from public,anon;
grant execute on function public.bump_post(uuid) to authenticated;

create or replace function public.get_membership() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); day date; d jsonb; groups int; gl int; b jsonb; mid uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select (now() at time zone c.timezone)::date into day from public.profiles p join public.cities c on c.id=p.city_id where p.id=u;
  d:=private.membership_details(u); groups:=private.membership_meetup_count(u); gl:=private.relationship_locked_count(u,'group');
  b:=private.membership_entitlement(u,'business'); select merchant_id into mid from private.business_membership_bindings where user_id=u;
  return d||jsonb_build_object('postsUsed',(select count(*) from public.posts p join public.tags t on t.id=p.tag_id where p.author_id=u and p.posted_on=day and p.kind='story' and t.kind='post' and p.room_preview is null),
    'meetupsUsed',groups,'conversationsUsed',private.direct_slot_count(u),'conversationPeriod','active',
    'meetupSlotsLocked',gl,'meetupSlotsAvailable',greatest(0,(d->>'meetupLimit')::int-groups-gl),
    'conversationSlotsLocked',0,'conversationSlotsAvailable',null,
    'meetupUnlocksAt',coalesce((select jsonb_agg(unlocks_at order by unlocks_at) from private.relationship_cooldowns where user_id=u and pool='group' and unlocks_at>now()),'[]'::jsonb),'conversationUnlocksAt','[]'::jsonb,
    'listingsUsed',private.active_listing_count(u),'listingLimit',private.listing_limit(u),
    'billingPolicyVersion',2,'bumpCooldownHours',(extract(epoch from private.bump_cooldown(u))/3600)::int,
    'nextBumpAt',(select last_bumped_at+private.bump_cooldown(u) from private.personal_bump_state where user_id=u),
    'businessSubscription',jsonb_build_object('merchantId',mid,'tier',coalesce(b->>'tier','free'),
      'expiresAt',b->>'expires_at','productId',b->>'product_id','store',b->>'store','willRenew',b->'will_renew'));
end;
$$;
revoke all on function public.get_membership() from public,anon;
grant execute on function public.get_membership() to authenticated;
-- Match the existing trusted function owner even when a privileged migration runner is used.
alter table private.personal_bump_state owner to postgres;
alter table private.business_membership_bindings owner to postgres;
alter table private.merchant_membership_usage owner to postgres;
do $$ declare signature text; begin
  foreach signature in array array[
    'private.membership_entitlement(uuid,text)','private.promotion_fingerprint(text)',
    'private.business_membership_details(uuid)','private.consume_business_usage(uuid,text,uuid,text)',
    'private.track_business_post_usage()','private.track_business_report_usage()',
    'public.get_business_membership(uuid)','public.bind_business_membership(uuid)'
  ] loop execute 'alter function '||signature||' owner to postgres'; end loop;
end $$;
-- Extend only the existing tier filter; retain the AAL2 guard, audit, redaction and pagination.
do $$ declare definition text; signature text; begin
  foreach signature in array array['public.get_admin_analytics(integer,text,text,boolean,integer)','public.get_admin_behavior(integer,text,text,boolean)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    execute regexp_replace(definition,'''all''[[:space:]]*,[[:space:]]*''free''[[:space:]]*,[[:space:]]*''plus''[[:space:]]*,[[:space:]]*''premium''','''all'',''free'',''plus'',''pro'',''premium''');
  end loop;
end $$;
notify pgrst,'reload schema';
