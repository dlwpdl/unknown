-- Verified purchases and promotion reservations share one database transaction.
-- No client write path, cash transfer, credit expiry, or second currency balance.
create table private.promotion_config (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into private.promotion_config default values;
create table private.promotion_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  store text not null check(store in ('APP_STORE','PLAY_STORE')),
  environment text not null check(environment in ('PRODUCTION','SANDBOX')),
  transaction_id text not null check(length(transaction_id) between 1 and 256),
  product_id text not null,
  credits integer not null check(credits in (900,1700)),
  granted boolean not null default false,
  refunded boolean not null default false,
  state_at timestamptz not null default '-infinity',
  created_at timestamptz not null default clock_timestamp(),
  unique(store,environment,transaction_id)
);
create index promotion_purchases_user_idx on private.promotion_purchases(user_id);
create table private.promotion_purchase_events (
  event_id text primary key,
  payload jsonb not null,
  received_at timestamptz not null default clock_timestamp()
);
create table private.promotion_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  post_id uuid references public.posts(id) on delete set null,
  title text not null,
  request_id text not null,
  budget integer not null check(budget in (900,1700)),
  delivered integer not null default 0 check(delivered>=0 and delivered<=budget),
  status text not null default 'active' check(status in ('active','paused','completed','refunded')),
  environment text not null default 'PRODUCTION' check(environment in ('PRODUCTION','SANDBOX')),
  created_at timestamptz not null default clock_timestamp(),
  unique(user_id,request_id)
);
create unique index promotion_one_active_post on private.promotion_campaigns(post_id) where status='active';
create table private.promotion_allocations (
  campaign_id uuid not null references private.promotion_campaigns(id),
  purchase_id uuid not null references private.promotion_purchases(id),
  amount integer not null check(amount>=0),
  used integer not null default 0 check(used>=0 and used<=amount),
  primary key(campaign_id,purchase_id)
);
create index promotion_allocations_purchase_idx on private.promotion_allocations(purchase_id);
create table private.promotion_placements (
  token uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references private.promotion_campaigns(id),
  viewer_id uuid references public.profiles(id) on delete set null,
  issued_at timestamptz not null default clock_timestamp(),
  counted_at timestamptz,
  unique(campaign_id,viewer_id)
);
revoke all on private.promotion_config,private.promotion_purchases,private.promotion_purchase_events,
  private.promotion_campaigns,private.promotion_allocations,private.promotion_placements from public,anon,authenticated;

create function private.promotion_balance(p_user_id uuid,p_environment text)
returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(p.credits-coalesce((select sum(a.amount) from private.promotion_allocations a where a.purchase_id=p.id),0)),0)::bigint
 from private.promotion_purchases p where p.user_id=p_user_id and p.environment=p_environment and p.granted and not p.refunded;
$$;
revoke all on function private.promotion_balance(uuid,text) from public,anon,authenticated;

create function public.record_promotion_purchase(p_event jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid; stamp timestamptz; purchase private.promotion_purchases; previous jsonb; cid uuid; expected integer;
begin
  if p_event is null or jsonb_typeof(p_event)<>'object'
    or coalesce(p_event->>'event_type','') not in ('NON_RENEWING_PURCHASE','CANCELLATION','REFUND_REVERSED')
    or coalesce(p_event->>'user_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_event->>'store','') not in ('APP_STORE','PLAY_STORE')
    or coalesce(p_event->>'environment','') not in ('PRODUCTION','SANDBOX')
    or coalesce(length(p_event->>'event_id'),0) not between 1 and 256
    or coalesce(length(p_event->>'transaction_id'),0) not between 1 and 256
    or jsonb_typeof(p_event->'credits') is distinct from 'number' then raise exception 'INVALID_CREDIT_EVENT'; end if;
  expected:=case when p_event->>'store'='APP_STORE' then case p_event->>'product_id'
    when 'com.dlwpdl.gling.credits.900' then 900 when 'com.dlwpdl.gling.credits.1700' then 1700 end
    else case p_event->>'product_id' when 'gling_credits_900' then 900 when 'gling_credits_1700' then 1700 end end;
  if expected is null or (p_event->>'credits')::numeric<>expected then raise exception 'INVALID_CREDIT_EVENT'; end if;
  stamp:=(p_event->>'occurred_at')::timestamptz;
  if stamp is null or stamp>'now'::timestamptz+interval '5 minutes' or stamp<'2020-01-01'::timestamptz then raise exception 'INVALID_CREDIT_EVENT'; end if;
  uid:=(p_event->>'user_id')::uuid;
  if not private.is_active_account(uid) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('promotion-purchase:'||(p_event->>'store')||':'||(p_event->>'environment')||':'||(p_event->>'transaction_id'),0));
  perform pg_advisory_xact_lock(hashtextextended(uid::text||':promotion',0));
  select * into purchase from private.promotion_purchases where store=p_event->>'store' and environment=p_event->>'environment' and transaction_id=p_event->>'transaction_id';
  if purchase.id is not null and (purchase.user_id is distinct from uid or purchase.product_id<>p_event->>'product_id') then raise exception 'PURCHASE_IDENTITY_MISMATCH'; end if;
  insert into private.promotion_purchase_events(event_id,payload) values(p_event->>'event_id',p_event) on conflict do nothing;
  if not found then
    select payload into previous from private.promotion_purchase_events where event_id=p_event->>'event_id';
    if previous is distinct from p_event then raise exception 'CREDIT_EVENT_ID_REUSED'; end if;
    return;
  end if;
  if purchase.id is null then
    insert into private.promotion_purchases(user_id,store,environment,transaction_id,product_id,credits)
      values(uid,p_event->>'store',p_event->>'environment',p_event->>'transaction_id',p_event->>'product_id',expected) returning * into purchase;
  end if;
  if p_event->>'event_type'='NON_RENEWING_PURCHASE' then
    -- An out-of-order original purchase never cancels an already recorded refund.
    update private.promotion_purchases set granted=true where id=purchase.id;
  elsif stamp>purchase.state_at or (stamp=purchase.state_at and p_event->>'event_type'='CANCELLATION') then
    update private.promotion_purchases set refunded=(p_event->>'event_type'='CANCELLATION'),state_at=stamp where id=purchase.id;
    if p_event->>'event_type'='CANCELLATION' then
      for cid in select c.id from private.promotion_campaigns c join private.promotion_allocations a on a.campaign_id=c.id
        where a.purchase_id=purchase.id and c.status='active' order by c.id loop
        update private.promotion_campaigns set status='refunded' where id=cid;
        -- Release every unused allocation; refunded lots stay unavailable, healthy lots return to the wallet.
        update private.promotion_allocations set amount=used where campaign_id=cid;
      end loop;
    end if;
  end if;
end;
$$;
revoke all on function public.record_promotion_purchase(jsonb) from public,anon,authenticated;
grant execute on function public.record_promotion_purchase(jsonb) to service_role;

create function public.get_promotion_wallet()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); membership jsonb; ready boolean;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(uid);
  membership:=public.get_membership();
  ready:=coalesce(membership->>'conversationPeriod'='active' and jsonb_typeof(membership->'conversationSlotsAvailable')='number',false);
  return jsonb_build_object('balance',private.promotion_balance(uid,'PRODUCTION'),'testBalance',private.promotion_balance(uid,'SANDBOX'),
    'configured',(select enabled from private.promotion_config),
    'slotStatus',case when ready then 'ready' else 'not_ready' end,
    'slotAvailable',case when ready then greatest(0,(membership->>'conversationSlotsAvailable')::integer) end,
    'slotLimit',case when ready then (membership->>'conversationLimit')::integer end,
    'purchases',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'transactionId',p.transaction_id,'credits',p.credits,'refunded',p.refunded,
      'createdAt',p.created_at,'environment',p.environment) order by p.created_at desc,p.id)
      from (select * from private.promotion_purchases where user_id=uid and granted order by created_at desc,id limit 50) p),'[]'::jsonb),
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'postId',c.post_id,'title',c.title,'budget',c.budget,
      'delivered',c.delivered,'status',c.status,'environment',c.environment,'createdAt',c.created_at) order by c.created_at desc,c.id)
      from (select * from private.promotion_campaigns where user_id=uid order by created_at desc,id limit 50)c),'[]'::jsonb));
end;
$$;
revoke all on function public.get_promotion_wallet() from public,anon,authenticated;
grant execute on function public.get_promotion_wallet() to authenticated;

create function public.start_promotion(p_post_id uuid,p_budget integer,p_request_id text,p_allow_no_slots boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); post public.posts; existing private.promotion_campaigns; cid uuid; lot record; needed integer; take integer; wallet jsonb;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(uid);
  if p_post_id is null or p_budget is null or p_budget not in (900,1700) or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,100}$'
    or p_allow_no_slots is null then raise exception 'INVALID_PROMOTION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text||':promotion',0));
  select * into existing from private.promotion_campaigns where user_id=uid and request_id=p_request_id;
  if existing.id is not null then
    if existing.post_id is distinct from p_post_id or existing.budget<>p_budget then raise exception 'REQUEST_ID_REUSED'; end if;
    return existing.id;
  end if;
  if not (select enabled from private.promotion_config) then raise exception 'PROMOTIONS_NOT_READY'; end if;
  select * into post from public.posts where id=p_post_id and author_id=uid and status='published'
    and not coalesce((room_preview->>'closed')::boolean,false);
  if post.id is null then raise exception 'POST_NOT_FOUND'; end if;
  if not exists(select 1 from public.cities where id=post.city_id and is_open) then raise exception 'CITY_NOT_OPEN'; end if;
  wallet:=public.get_promotion_wallet();
  if wallet->>'slotStatus'='ready' and (wallet->>'slotAvailable')::integer=0 and not p_allow_no_slots then raise exception 'NO_CONVERSATION_SLOTS'; end if;
  if private.promotion_balance(uid,'PRODUCTION')<p_budget then raise exception 'INSUFFICIENT_CREDITS'; end if;
  if exists(select 1 from private.promotion_campaigns where post_id=p_post_id and status='active') then raise exception 'PROMOTION_ALREADY_ACTIVE'; end if;
  insert into private.promotion_campaigns(user_id,post_id,title,request_id,budget)
    values(uid,p_post_id,post.title,p_request_id,p_budget) returning id into cid;
  needed:=p_budget;
  for lot in select p.id,p.credits-coalesce((select sum(a.amount) from private.promotion_allocations a where a.purchase_id=p.id),0) available
    from private.promotion_purchases p where p.user_id=uid and p.environment='PRODUCTION' and p.granted and not p.refunded order by p.created_at,p.id loop
    take:=least(needed,lot.available);
    if take>0 then insert into private.promotion_allocations(campaign_id,purchase_id,amount) values(cid,lot.id,take); needed:=needed-take; end if;
    exit when needed=0;
  end loop;
  if needed<>0 then raise exception 'INSUFFICIENT_CREDITS'; end if;
  return cid;
end;
$$;
revoke all on function public.start_promotion(uuid,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.start_promotion(uuid,integer,text,boolean) to authenticated;

create function public.pause_promotion(p_campaign_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(uid);
  perform pg_advisory_xact_lock(hashtextextended(uid::text||':promotion',0));
  if not exists(select 1 from private.promotion_campaigns where id=p_campaign_id and user_id=uid) then raise exception 'PROMOTION_NOT_FOUND'; end if;
  update private.promotion_campaigns set status='paused' where id=p_campaign_id and status='active';
  if found then update private.promotion_allocations set amount=used where campaign_id=p_campaign_id; end if;
end;
$$;
revoke all on function public.pause_promotion(uuid) from public,anon,authenticated;
grant execute on function public.pause_promotion(uuid) to authenticated;

create function public.serve_promotion(p_city_id text,p_tag_id smallint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); chosen private.promotion_campaigns; placement private.promotion_placements;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(uid);
  if not (select enabled from private.promotion_config) then return null; end if;
  if not exists(select 1 from public.profiles where id=uid and city_id=p_city_id)
    or not exists(select 1 from public.cities where id=p_city_id and is_open) then return null; end if;
  if exists(select 1 from auth.users where id=uid and (email like '%@seed.gling.invalid'
    or raw_app_meta_data->>'role'='admin' or raw_app_meta_data->'review_access'='true'::jsonb)) then return null; end if;
  -- Bound report storage to one placement per account and campaign. Existing token survives refresh.
  perform pg_advisory_xact_lock(hashtextextended(uid::text||':promotion-viewer',0));
  select c.* into chosen from private.promotion_campaigns c join public.posts p on p.id=c.post_id
    where c.environment='PRODUCTION' and c.status='active' and c.delivered<c.budget and c.user_id<>uid
      and p.status='published' and p.city_id=p_city_id and (p_tag_id is null or p.tag_id=p_tag_id)
      and not coalesce((p.room_preview->>'closed')::boolean,false) and private.is_active_account(c.user_id)
      and not private.is_blocked_between(uid,c.user_id)
      and not exists(select 1 from private.promotion_placements v where v.campaign_id=c.id and v.viewer_id=uid and v.counted_at>clock_timestamp()-interval '24 hours')
    order by c.delivered::numeric/c.budget,c.created_at,c.id limit 1;
  if chosen.id is null then return null; end if;
  select * into placement from private.promotion_placements where campaign_id=chosen.id and viewer_id=uid;
  if placement.token is null then
    insert into private.promotion_placements(campaign_id,viewer_id) values(chosen.id,uid) returning * into placement;
  elsif placement.issued_at<clock_timestamp()-interval '10 minutes' then
    update private.promotion_placements set token=gen_random_uuid(),issued_at=clock_timestamp(),counted_at=null
      where token=placement.token returning * into placement;
  end if;
  return jsonb_build_object('token',placement.token,'postId',chosen.post_id,'campaignId',chosen.id,'expiresAt',placement.issued_at+interval '10 minutes');
end;
$$;
revoke all on function public.serve_promotion(text,smallint) from public,anon,authenticated;
grant execute on function public.serve_promotion(text,smallint) to authenticated;

create function public.record_promotion_impression(p_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); placement private.promotion_placements; campaign private.promotion_campaigns; owner uuid; lot uuid; stamp timestamptz:=clock_timestamp();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(uid);
  if not (select enabled from private.promotion_config) then return false; end if;
  select c.user_id into owner from private.promotion_placements v join private.promotion_campaigns c on c.id=v.campaign_id
    where v.token=p_token and v.viewer_id=uid;
  if owner is null or owner=uid then return false; end if;
  -- Same owner lock as reservations, pauses and refunds: no last-credit race or lock inversion.
  perform pg_advisory_xact_lock(hashtextextended(owner::text||':promotion',0));
  select * into placement from private.promotion_placements where token=p_token and viewer_id=uid for update;
  if placement.token is null or placement.counted_at is not null or placement.issued_at>stamp-interval '1 second'
    or placement.issued_at<stamp-interval '10 minutes' then return false; end if;
  select * into campaign from private.promotion_campaigns where id=placement.campaign_id;
  if campaign.environment<>'PRODUCTION' or campaign.status<>'active' or campaign.delivered>=campaign.budget
    or not private.is_active_account(owner) or private.is_blocked_between(uid,owner)
    or not exists(select 1 from public.posts p join public.profiles v on v.id=uid
      where p.id=campaign.post_id and p.status='published' and p.city_id=v.city_id and not coalesce((p.room_preview->>'closed')::boolean,false)) then return false; end if;
  select a.purchase_id into lot from private.promotion_allocations a join private.promotion_purchases p on p.id=a.purchase_id
    where a.campaign_id=campaign.id and a.used<a.amount and p.granted and not p.refunded order by p.created_at,p.id limit 1;
  if lot is null then return false; end if;
  update private.promotion_allocations set used=used+1 where campaign_id=campaign.id and purchase_id=lot;
  update private.promotion_campaigns set delivered=delivered+1,status=case when delivered+1=budget then 'completed' else 'active' end where id=campaign.id;
  update private.promotion_placements set counted_at=stamp where token=p_token;
  return true;
end;
$$;
revoke all on function public.record_promotion_impression(uuid) from public,anon,authenticated;
grant execute on function public.record_promotion_impression(uuid) to authenticated;
