-- Owner-scoped business tools reuse merchant records, normal publishing and admin MFA.
alter table private.merchants add column owner_id uuid references public.profiles(id) on delete set null,
  add column owner_verified_at timestamptz, add column workspace_until date;
create index merchants_owner_idx on private.merchants(owner_id) where owner_id is not null;
alter table private.merchant_posts alter column original_url drop not null;
create table private.merchant_items (
  id uuid primary key, merchant_id uuid not null references private.merchants(id),
  name text not null check(length(btrim(name)) between 1 and 120),
  unit text not null check(length(btrim(unit)) between 1 and 20),
  unit_cost numeric(12,2) not null check(unit_cost between 0 and 99999999),
  quantity numeric(14,3) not null default 0 check(quantity between 0 and 99999999999),
  low_stock numeric(14,3) not null default 0 check(low_stock between 0 and 99999999999),
  updated_at timestamptz not null default now()
);
create index merchant_items_merchant_idx on private.merchant_items(merchant_id,name,id);
create table private.merchant_stock_movements (
  id uuid primary key default gen_random_uuid(), request_id uuid not null,
  merchant_id uuid not null references private.merchants(id),
  item_id uuid not null references private.merchant_items(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  delta numeric(14,3) not null check(delta<>0), note text not null check(length(btrim(note)) between 1 and 300),
  created_at timestamptz not null default now(), unique(request_id,item_id)
);
create index merchant_stock_merchant_idx on private.merchant_stock_movements(merchant_id,created_at desc);
create table private.merchant_workspace_drafts (
  id uuid primary key, merchant_id uuid not null references private.merchants(id),
  channel text not null check(channel in ('gling','casmo','hellovancouver')),
  title text not null check(length(btrim(title)) between 1 and 100),
  body text not null check(length(btrim(body)) between 1 and 4700),
  original_url text, tag_slug text not null, kind text not null check(kind in ('story','listing')),
  approved_at timestamptz, approved_by uuid references public.profiles(id) on delete set null,
  post_id uuid references public.posts(id) on delete set null, published_at timestamptz, external_url text, archived_at timestamptz,
  updated_at timestamptz not null default now()
);
create index merchant_drafts_merchant_idx on private.merchant_workspace_drafts(merchant_id,updated_at desc,id);
alter table private.merchant_items enable row level security;
alter table private.merchant_stock_movements enable row level security;
alter table private.merchant_workspace_drafts enable row level security;
revoke all on private.merchant_items,private.merchant_stock_movements,private.merchant_workspace_drafts from public,anon,authenticated;

create function private.merchant_workspace_plan(p_merchant_id uuid) returns text
language sql stable security definer set search_path='' as $$
  select case when m.status='paid' and m.workspace_until>=(now() at time zone c.timezone)::date then 'pro'
    when m.status='trial' and m.trial_ends_at>=(now() at time zone c.timezone)::date then 'trial' else 'basic' end
  from private.merchants m join public.cities c on c.id=m.city_id where m.id=p_merchant_id;
$$;
create function private.assert_merchant_workspace(p_merchant_id uuid,p_advanced boolean default false)
returns private.merchants language plpgsql security definer set search_path='' as $$
declare m private.merchants; uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(uid);
  if exists(select 1 from auth.users where id=uid and raw_app_meta_data->>'role'='admin') then
    if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
    perform public.log_admin_access('analytics');
  end if;
  select * into m from private.merchants where id=p_merchant_id;
  if m.id is null or (not private.is_admin() and m.owner_id is distinct from uid) then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  if p_advanced and private.merchant_workspace_plan(m.id)='basic' then raise exception 'MERCHANT_PLAN_REQUIRED'; end if;
  return m;
end;
$$;
revoke all on function private.merchant_workspace_plan(uuid),private.assert_merchant_workspace(uuid,boolean) from public,anon,authenticated;

create function public.get_my_merchants() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  if exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role'='admin') then
    if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
    perform public.log_admin_access('analytics');
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.id) from (
    select m.id,m.name,m.city_id,c.name city_name,m.contact,m.status,m.owner_id,m.owner_verified_at,
      m.trial_ends_at,m.workspace_until,(now() at time zone c.timezone)::date today,private.merchant_workspace_plan(m.id) plan
    from private.merchants m join public.cities c on c.id=m.city_id
    where m.owner_id=auth.uid() or private.is_admin() order by m.name,m.id limit 50)x),'[]'::jsonb);
end;
$$;
create function public.register_my_merchant(p_id uuid,p_name text,p_city_id text,p_contact text)
returns uuid language plpgsql security definer set search_path='' as $$
declare old_owner uuid; today date;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  if exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role'='admin') and not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 120
    or p_contact is null or length(p_contact)>1000 then raise exception 'INVALID_MERCHANT'; end if;
  select (now() at time zone timezone)::date into today from public.cities where id=p_city_id and is_open;
  if today is null then raise exception 'CITY_NOT_OPEN'; end if;
  perform private.enforce_rate_limit('merchant-register',5,interval '1 day');
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,119));
  if exists(select 1 from private.merchants where id=p_id) then
    select owner_id into old_owner from private.merchants where id=p_id;
    if old_owner is distinct from auth.uid() then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
    return p_id;
  end if;
  insert into private.merchants(id,name,city_id,contact,status,trial_ends_at,owner_id)
    values(p_id,btrim(p_name),p_city_id,btrim(p_contact),'trial',today+13,auth.uid());
  return p_id;
end;
$$;
create function public.get_merchant_workspace(p_merchant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants; merchant jsonb; today date; data jsonb;
begin
  m:=private.assert_merchant_workspace(p_merchant_id);
  select (now() at time zone c.timezone)::date,jsonb_build_object('id',m.id,'name',m.name,'city_id',m.city_id,
    'city_name',c.name,'contact',m.contact,'status',m.status,'owner_id',m.owner_id,'owner_verified_at',m.owner_verified_at,
    'trial_ends_at',m.trial_ends_at,'workspace_until',m.workspace_until,'today',(now() at time zone c.timezone)::date,
    'plan',private.merchant_workspace_plan(m.id)) into today,merchant from public.cities c where c.id=m.city_id;
  data:=private.merchant_period_data(m.id,today-13,today);
  return data||jsonb_build_object('merchant',merchant,
    'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.id) from
      (select id,name,unit,unit_cost,quantity,low_stock,updated_at from private.merchant_items where merchant_id=m.id order by name,id limit 500)x),'[]'::jsonb),
    'drafts',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc,x.id) from
      (select id,channel,title,body,original_url,tag_slug,kind,approved_at,post_id,published_at,external_url,archived_at,updated_at from private.merchant_workspace_drafts
        where merchant_id=m.id order by updated_at desc,id limit 100)x),'[]'::jsonb),
    'movements',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from
      (select s.id,s.item_id,i.name item_name,s.delta,s.note,s.created_at from private.merchant_stock_movements s
        join private.merchant_items i on i.id=s.item_id where s.merchant_id=m.id order by s.created_at desc,s.id limit 100)x),'[]'::jsonb),
    'reports',coalesce((select jsonb_agg(to_jsonb(x) order by x.generated_at desc,x.id) from
      (select * from private.merchant_reports where merchant_id=m.id order by generated_at desc,id limit 12)x),'[]'::jsonb));
end;
$$;
create function public.save_merchant_workspace_item(p_merchant_id uuid,p_id uuid,p_name text,p_unit text,p_unit_cost numeric,p_low_stock numeric)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_merchant_workspace(p_merchant_id);
  if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 120 or p_unit is null or length(btrim(p_unit)) not between 1 and 20
    or p_unit_cost is null or p_unit_cost<0 or p_unit_cost>99999999 or p_low_stock is null or p_low_stock<0 or p_low_stock>99999999999 then raise exception 'INVALID_MERCHANT_ITEM'; end if;
  perform private.enforce_rate_limit('merchant-item-save',60,interval '1 minute');
  perform 1 from private.merchants where id=p_merchant_id for update;
  if not exists(select 1 from private.merchant_items where id=p_id) and
    (select count(*) from private.merchant_items where merchant_id=p_merchant_id)>=500 then raise exception 'MERCHANT_ITEM_CAP'; end if;
  insert into private.merchant_items(id,merchant_id,name,unit,unit_cost,low_stock) values(p_id,p_merchant_id,btrim(p_name),btrim(p_unit),p_unit_cost,p_low_stock)
  on conflict(id) do update set name=excluded.name,unit=excluded.unit,unit_cost=excluded.unit_cost,low_stock=excluded.low_stock,updated_at=now()
    where private.merchant_items.merchant_id=p_merchant_id;
  if not found then raise exception 'MERCHANT_ITEM_NOT_FOUND'; end if;
  return p_id;
end;
$$;
create function public.adjust_merchant_inventory(p_merchant_id uuid,p_request_id uuid,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare change jsonb; existing jsonb; normalized jsonb; count_changes int;
begin
  perform private.assert_merchant_workspace(p_merchant_id);
  if p_request_id is null or p_changes is null or jsonb_typeof(p_changes)<>'array'
    or jsonb_array_length(p_changes) not between 1 and 50 then raise exception 'INVALID_MERCHANT_STOCK'; end if;
  count_changes:=jsonb_array_length(p_changes);
  if exists(select 1 from jsonb_array_elements(p_changes) e where e->>'item_id' is null or e->>'delta' is null or e->>'note' is null
    or jsonb_typeof(e->'delta')<>'number' or (e->>'delta')::numeric=0 or abs((e->>'delta')::numeric)>99999999999
    or trunc((e->>'delta')::numeric,3)<>(e->>'delta')::numeric
    or length(btrim(e->>'note')) not between 1 and 300)
    or (select count(distinct e->>'item_id') from jsonb_array_elements(p_changes)e)<>count_changes then raise exception 'INVALID_MERCHANT_STOCK'; end if;
  select jsonb_agg(jsonb_build_object('item_id',(e->>'item_id')::uuid,'delta',(e->>'delta')::numeric,'note',btrim(e->>'note')) order by e->>'item_id')
    into normalized from jsonb_array_elements(p_changes)e;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,119));
  if exists(select 1 from private.merchant_stock_movements where request_id=p_request_id) then
    select jsonb_agg(jsonb_build_object('item_id',item_id,'delta',delta,'note',note) order by item_id::text) into existing
      from private.merchant_stock_movements where request_id=p_request_id and merchant_id=p_merchant_id;
    if existing is distinct from normalized then raise exception 'MERCHANT_REQUEST_CONFLICT'; end if;
    return jsonb_build_object('applied',count_changes);
  end if;
  if count_changes>1 then perform private.assert_merchant_workspace(p_merchant_id,true); end if;
  perform private.enforce_rate_limit('merchant-stock',60,interval '1 minute');
  for change in select * from jsonb_array_elements(normalized) loop
    perform 1 from private.merchant_items where id=(change->>'item_id')::uuid and merchant_id=p_merchant_id for update;
    if not found then raise exception 'MERCHANT_ITEM_NOT_FOUND'; end if;
    if exists(select 1 from private.merchant_items where id=(change->>'item_id')::uuid and quantity+(change->>'delta')::numeric<0) then raise exception 'MERCHANT_STOCK_NEGATIVE'; end if;
    update private.merchant_items set quantity=quantity+(change->>'delta')::numeric,updated_at=now() where id=(change->>'item_id')::uuid;
    insert into private.merchant_stock_movements(request_id,merchant_id,item_id,actor_id,delta,note)
      values(p_request_id,p_merchant_id,(change->>'item_id')::uuid,auth.uid(),(change->>'delta')::numeric,change->>'note');
  end loop;
  return jsonb_build_object('applied',count_changes);
end;
$$;
create function public.save_merchant_workspace_draft(p_merchant_id uuid,p_id uuid,p_channel text,p_title text,p_body text,p_original_url text,p_tag_slug text,p_kind text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_merchant_workspace(p_merchant_id);
  if p_id is null or p_channel is null or p_channel not in ('gling','casmo','hellovancouver')
    or p_title is null or length(btrim(p_title)) not between 1 and 100 or p_body is null or length(btrim(p_body)) not between 1 and 4700
    or p_kind is null or p_kind not in ('story','listing') or not exists(select 1 from public.tags where slug=p_tag_slug and kind='post') then raise exception 'INVALID_MERCHANT_DRAFT'; end if;
  if p_original_url is not null and not private.valid_merchant_original(p_original_url) then raise exception 'INVALID_ORIGINAL_URL'; end if;
  perform private.enforce_rate_limit('merchant-draft-save',60,interval '1 minute');
  perform 1 from private.merchants where id=p_merchant_id for update;
  if not exists(select 1 from private.merchant_workspace_drafts where id=p_id) and
    (select count(*) from private.merchant_workspace_drafts where merchant_id=p_merchant_id)>=100 then raise exception 'MERCHANT_DRAFT_CAP'; end if;
  if exists(select 1 from private.merchant_workspace_drafts where id=p_id and (published_at is not null or external_url is not null)) then raise exception 'MERCHANT_DRAFT_PUBLISHED'; end if;
  insert into private.merchant_workspace_drafts(id,merchant_id,channel,title,body,original_url,tag_slug,kind)
    values(p_id,p_merchant_id,p_channel,btrim(p_title),btrim(p_body),p_original_url,p_tag_slug,p_kind)
  on conflict(id) do update set channel=excluded.channel,title=excluded.title,body=excluded.body,original_url=excluded.original_url,
    tag_slug=excluded.tag_slug,kind=excluded.kind,approved_at=null,approved_by=null,updated_at=now()
    where private.merchant_workspace_drafts.merchant_id=p_merchant_id and private.merchant_workspace_drafts.published_at is null and private.merchant_workspace_drafts.external_url is null;
  if not found then raise exception 'MERCHANT_DRAFT_NOT_FOUND'; end if;
  return p_id;
end;
$$;
create function public.approve_merchant_workspace_drafts(p_merchant_id uuid,p_ids uuid[],p_approve boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare changed int;
begin
  perform private.assert_merchant_workspace(p_merchant_id);
  if p_ids is null or p_approve is null or cardinality(p_ids) not between 1 and 50 or array_position(p_ids,null) is not null
    or (select count(distinct x) from unnest(p_ids)x)<>cardinality(p_ids) then raise exception 'INVALID_MERCHANT_DRAFT_SELECTION'; end if;
  if p_approve and cardinality(p_ids)>1 then perform private.assert_merchant_workspace(p_merchant_id,true); end if;
  if (select count(*) from private.merchant_workspace_drafts where merchant_id=p_merchant_id and id=any(p_ids) and published_at is null and external_url is null and archived_at is null)<>cardinality(p_ids) then raise exception 'MERCHANT_DRAFT_NOT_FOUND'; end if;
  update private.merchant_workspace_drafts set approved_at=case when p_approve then now() end,approved_by=case when p_approve then auth.uid() end,
    updated_at=now() where merchant_id=p_merchant_id and id=any(p_ids) and published_at is null and external_url is null and archived_at is null;
  get diagnostics changed=row_count;
  if changed<>cardinality(p_ids) then raise exception 'MERCHANT_DRAFT_NOT_FOUND'; end if;
  return jsonb_build_object('approved',cardinality(p_ids));
end;
$$;
create function public.publish_merchant_workspace_draft(p_merchant_id uuid,p_draft_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare m private.merchants; d private.merchant_workspace_drafts; pid uuid; tag smallint;
begin
  m:=private.assert_merchant_workspace(p_merchant_id);
  select * into d from private.merchant_workspace_drafts where merchant_id=m.id and id=p_draft_id for update;
  if d.id is null or d.channel<>'gling' then raise exception 'MERCHANT_DRAFT_NOT_FOUND'; end if;
  if d.post_id is not null then return d.post_id; end if;
  if d.published_at is not null or d.archived_at is not null then raise exception 'MERCHANT_DRAFT_PUBLISHED'; end if;
  if m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
  if m.status='paused' then raise exception 'MERCHANT_OPERATIONS_PAUSED'; end if;
  if m.consent='revoked' then raise exception 'MERCHANT_CONSENT_REQUIRED'; end if;
  if d.approved_at is null then raise exception 'MERCHANT_DRAFT_APPROVAL_REQUIRED'; end if;
  select id into tag from public.tags where slug=d.tag_slug and kind='post';
  -- Never impersonate the business owner: use the authenticated actor and established safety/quota path.
  pid:=public.create_post(p_city_id=>m.city_id,p_tag_id=>tag,p_title=>d.title,
    p_body=>d.body||E'\n\n'||case when auth.uid()=m.owner_id then '업체에서 직접 게시한 안내입니다.' else '업체의 허락을 받아 글링에서 대신 게시한 안내입니다.' end,p_kind=>d.kind);
  insert into private.merchant_posts(post_id,merchant_id,original_url,creation_request_id) values(pid,m.id,d.original_url,d.id);
  update private.merchant_workspace_drafts set post_id=pid,published_at=now(),updated_at=now() where id=d.id;
  update private.merchants set consent='granted',consent_note=case when consent='pending' then '확인된 업체 소유자가 원고 '||d.id::text||'의 게시를 승인함' else consent_note end,
    updated_at=now() where id=m.id;
  return pid;
end;
$$;
create function public.record_merchant_external_post(p_merchant_id uuid,p_draft_id uuid,p_url text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_merchant_workspace(p_merchant_id);
  if not private.valid_merchant_original(p_url) or p_url !~ '^https://(cafe\.naver\.com|m\.cafe\.naver\.com|cafe\.daum\.net|m\.cafe\.daum\.net)/' then raise exception 'INVALID_MERCHANT_CAFE_URL'; end if;
  update private.merchant_workspace_drafts set external_url=p_url,updated_at=now()
    where merchant_id=p_merchant_id and id=p_draft_id and channel in ('casmo','hellovancouver') and approved_at is not null and published_at is null and archived_at is null;
  if not found then raise exception 'MERCHANT_DRAFT_APPROVAL_REQUIRED'; end if;
  -- This is the owner's record, not an API-verified publication or measurable café reach.
  return p_draft_id;
end;
$$;
create function public.archive_merchant_workspace_drafts(p_merchant_id uuid,p_ids uuid[],p_archive boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare changed int;
begin
  perform private.assert_merchant_workspace(p_merchant_id);
  if p_ids is null or p_archive is null or cardinality(p_ids) not between 1 and 50 or array_position(p_ids,null) is not null
    or (select count(distinct x) from unnest(p_ids)x)<>cardinality(p_ids) then raise exception 'INVALID_MERCHANT_DRAFT_SELECTION'; end if;
  update private.merchant_workspace_drafts set archived_at=case when p_archive then now() end,
    approved_at=case when published_at is null and external_url is null then null else approved_at end,
    approved_by=case when published_at is null and external_url is null then null else approved_by end,updated_at=now()
    where merchant_id=p_merchant_id and id=any(p_ids);
  get diagnostics changed=row_count;
  if changed<>cardinality(p_ids) then raise exception 'MERCHANT_DRAFT_NOT_FOUND'; end if;
  return jsonb_build_object('archived',changed);
end;
$$;
create function public.set_admin_merchant_workspace_owner(p_merchant_id uuid,p_owner_id uuid,p_verified boolean,p_workspace_until date default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare m private.merchants;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  select * into m from private.merchants where id=p_merchant_id for update;
  if m.id is null then raise exception 'MERCHANT_NOT_FOUND'; end if;
  if p_owner_id is null or p_verified is null or not private.is_active_account(p_owner_id) then raise exception 'INVALID_MERCHANT_OWNER'; end if;
  if m.owner_id is not null and m.owner_id<>p_owner_id then raise exception 'MERCHANT_OWNER_TRANSFER_REQUIRED'; end if;
  if p_workspace_until is not null and p_workspace_until<(now() at time zone (select timezone from public.cities where id=m.city_id))::date then raise exception 'INVALID_MERCHANT_ACCESS_PERIOD'; end if;
  update private.merchants set owner_id=p_owner_id,owner_verified_at=case when p_verified then coalesce(owner_verified_at,now()) end,
    workspace_until=p_workspace_until,updated_at=now() where id=m.id;
  return m.id;
end;
$$;
create function private.erase_deleted_merchant_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
declare mid uuid;
begin
  if new.account_status='deleted' and old.account_status is distinct from new.account_status then
    for mid in select id from private.merchants where owner_id=new.id loop
      delete from private.merchant_items where merchant_id=mid;
      delete from private.merchant_workspace_drafts where merchant_id=mid;
      update private.merchants set owner_id=null,owner_verified_at=null,workspace_until=null,status='paused',consent='revoked',contact='',consent_note='',updated_at=now() where id=mid;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.erase_deleted_merchant_workspace() from public,anon,authenticated;
create trigger merchant_workspace_account_erasure after update of account_status on public.profiles for each row execute function private.erase_deleted_merchant_workspace();

revoke all on function public.get_my_merchants(),public.register_my_merchant(uuid,text,text,text),public.get_merchant_workspace(uuid),
  public.save_merchant_workspace_item(uuid,uuid,text,text,numeric,numeric),public.adjust_merchant_inventory(uuid,uuid,jsonb),
  public.save_merchant_workspace_draft(uuid,uuid,text,text,text,text,text,text),public.approve_merchant_workspace_drafts(uuid,uuid[],boolean),
  public.publish_merchant_workspace_draft(uuid,uuid),public.record_merchant_external_post(uuid,uuid,text),public.archive_merchant_workspace_drafts(uuid,uuid[],boolean),public.set_admin_merchant_workspace_owner(uuid,uuid,boolean,date) from public,anon,authenticated;
grant execute on function public.get_my_merchants(),public.register_my_merchant(uuid,text,text,text),public.get_merchant_workspace(uuid),
  public.save_merchant_workspace_item(uuid,uuid,text,text,numeric,numeric),public.adjust_merchant_inventory(uuid,uuid,jsonb),
  public.save_merchant_workspace_draft(uuid,uuid,text,text,text,text,text,text),public.approve_merchant_workspace_drafts(uuid,uuid[],boolean),
  public.publish_merchant_workspace_draft(uuid,uuid),public.record_merchant_external_post(uuid,uuid,text),public.archive_merchant_workspace_drafts(uuid,uuid[],boolean),public.set_admin_merchant_workspace_owner(uuid,uuid,boolean,date) to authenticated;
-- Exclude the business owner consistently in admin reports, owner reports and click transport.
do $$ declare definition text; anchor text; begin
  definition:=pg_get_functiondef('private.merchant_period_data(uuid,date,date)'::regprocedure);
  anchor:='private.external_merchant_viewer(v.user_id,p.author_id)';
  if strpos(definition,anchor)=0 then raise exception 'merchant read guard anchor missing'; end if;
  definition:=replace(definition,anchor,anchor||' and v.user_id is distinct from (select owner_id from private.merchants where id=p_merchant_id)');
  anchor:='private.external_merchant_viewer(c.user_id,p.author_id)';
  if strpos(definition,anchor)=0 then raise exception 'merchant click guard anchor missing'; end if;
  execute replace(definition,anchor,anchor||' and c.user_id is distinct from (select owner_id from private.merchants where id=p_merchant_id)');
  definition:=pg_get_functiondef('public.record_merchant_source_click(uuid,text,text,uuid)'::regprocedure);
  anchor:='if not private.external_merchant_viewer(uid,author) then return; end if;';
  if strpos(definition,anchor)=0 then raise exception 'merchant source guard anchor missing'; end if;
  execute replace(definition,anchor,'if uid=(select owner_id from private.merchants where id=mid) or not private.external_merchant_viewer(uid,author) then return; end if;');
end $$;
notify pgrst,'reload schema';
