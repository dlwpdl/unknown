-- Private operating records; payments are notes, and coupon codes confer no public access.
create table private.partnership_creators (
  id uuid primary key,
  member_id uuid references public.profiles(id) on delete set null unique,
  display_name text not null check(length(btrim(display_name)) between 1 and 120),
  city_id text not null references public.cities(id),
  profile_url text not null check(private.valid_merchant_original(profile_url)),
  category text not null default '' check(length(category)<=80),
  contact text not null default '' check(length(contact)<=1000),
  reference_url text not null default '' check(reference_url='' or private.valid_merchant_original(reference_url)),
  reference_views integer check(reference_views>=0),
  metrics_note text not null default '' check(length(metrics_note)<=1000),
  status text not null default 'active' check(status in ('active','paused')),
  notes text not null default '' check(length(notes)<=3000),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check(reference_views is null or reference_url<>'')
);
create unique index partnership_creator_profile on private.partnership_creators(regexp_replace(lower(rtrim(split_part(profile_url,'?',1),'/')),'^https://www[.]','https://'));
create index partnership_creators_page on private.partnership_creators(updated_at desc,id);
create index partnership_creators_city on private.partnership_creators(city_id);
create table private.partnership_campaigns (
  id uuid primary key,
  merchant_id uuid not null references private.merchants(id),
  title text not null check(length(btrim(title)) between 1 and 160),
  status text not null default 'draft' check(status in ('draft','open','paused','closed')),
  terms text not null default '' check(length(terms)<=3000), terms_confirmed boolean not null default false,
  team_limit integer check(team_limit between 1 and 10000), minimum_views integer check(minimum_views>=0),
  support_amount_cents integer check(support_amount_cents between 0 and 99999999),
  currency text check(currency in ('CAD','USD')),
  deadline_note text not null default '' check(length(deadline_note)<=300), ends_on date check(isfinite(ends_on)),
  notes text not null default '' check(length(notes)<=3000),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index partnership_campaigns_page on private.partnership_campaigns(updated_at desc,id);
create index partnership_campaigns_merchant on private.partnership_campaigns(merchant_id);
create table private.partnership_participations (
  id uuid primary key,
  campaign_id uuid not null references private.partnership_campaigns(id),
  creator_id uuid not null references private.partnership_creators(id),
  stage text not null default 'applied' check(stage in ('applied','selected','visited','submitted','completed','declined','cancelled')),
  scheduled_at timestamptz check(isfinite(scheduled_at)), visited_at timestamptz check(isfinite(visited_at)),
  content_url text not null default '' check(content_url='' or private.valid_merchant_original(content_url)),
  actual_views integer check(actual_views>=0),
  payment_status text not null default 'not_applicable' check(payment_status in ('not_applicable','pending','paid')),
  payment_note text not null default '' check(length(payment_note)<=1000), notes text not null default '' check(length(notes)<=3000),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(campaign_id,creator_id)
);
create index partnership_participations_creator on private.partnership_participations(creator_id,updated_at desc,id);
create index partnership_participations_campaign on private.partnership_participations(campaign_id,updated_at desc,id);
create table private.partnership_benefits (
  id uuid primary key,
  merchant_id uuid not null references private.merchants(id),
  campaign_id uuid references private.partnership_campaigns(id),
  title text not null check(length(btrim(title)) between 1 and 160),
  audience text not null check(audience in ('creators','members')),
  status text not null default 'draft' check(status in ('draft','active','paused','ended')),
  discount_percent integer check(discount_percent between 1 and 100),
  terms text not null default '' check(length(terms)<=3000), terms_confirmed boolean not null default false,
  expires_on date check(isfinite(expires_on)), issue_limit integer check(issue_limit between 1 and 10000),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index partnership_benefits_page on private.partnership_benefits(updated_at desc,id);
create index partnership_benefits_merchant on private.partnership_benefits(merchant_id);
create index partnership_benefits_campaign on private.partnership_benefits(campaign_id);
create table private.partnership_coupons (
  id uuid primary key, benefit_id uuid not null references private.partnership_benefits(id),
  creator_id uuid references private.partnership_creators(id),
  -- Retain the original recipient identity even after account erasure; no access is granted by this UUID.
  user_id uuid,
  recipient_name text not null check(length(btrim(recipient_name)) between 1 and 120),
  code text not null unique check(length(code)=32),
  status text not null default 'issued' check(status in ('issued','redeemed','revoked')),
  expires_on date not null check(isfinite(expires_on)),
  terms_snapshot jsonb not null check(jsonb_typeof(terms_snapshot)='object' and octet_length(terms_snapshot::text)<=20000),
  redeemed_at timestamptz, revoked_at timestamptz,
  action_note text not null default '' check(length(action_note)<=1000),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check((creator_id is null)<>(user_id is null)),
  check((status='redeemed')=(redeemed_at is not null) and (status='revoked')=(revoked_at is not null)),
  unique(benefit_id,creator_id), unique(benefit_id,user_id)
);
create index partnership_coupons_benefit on private.partnership_coupons(benefit_id,updated_at desc,id);
create index partnership_coupons_creator on private.partnership_coupons(creator_id);
create index partnership_coupons_user on private.partnership_coupons(user_id);
create table private.partnership_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  resource_id uuid not null,
  action text not null check(length(action) between 1 and 80),
  details jsonb not null check(jsonb_typeof(details)='object' and octet_length(details::text)<=20000),
  created_at timestamptz not null default clock_timestamp()
);
create index partnership_events_resource on private.partnership_events(resource_id,created_at desc,id desc);
create index partnership_events_actor on private.partnership_events(actor_id);
create index partnership_events_campaign on private.partnership_events((details->>'campaign_id'),created_at desc,id desc);
create index partnership_events_creator on private.partnership_events((details->>'creator_id'),created_at desc,id desc);
create index partnership_events_benefit on private.partnership_events((details->>'benefit_id'),created_at desc,id desc);

do $$
declare t text;
begin
  foreach t in array array['creators','campaigns','participations','benefits','coupons','events'] loop
    execute format('alter table private.partnership_%I owner to postgres',t);
    execute format('alter table private.partnership_%I enable row level security',t);
    execute format('revoke all on private.partnership_%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;
alter sequence private.partnership_events_id_seq owner to postgres;
revoke all on sequence private.partnership_events_id_seq from public,anon,authenticated,service_role;

create function private.assert_partnership_admin() returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() or not exists(select 1 from auth.sessions s where s.user_id=auth.uid()
    and s.id::text=auth.jwt()->>'session_id' and s.aal='aal2' and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'ADMIN_REQUIRED';
  end if;
end $$;
create function private.lock_partnership_actor(p_members uuid[] default '{}') returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_partnership_admin();
  -- SHARE matches merchant mutations; sorted actor/recipient locks also protect account changes.
  perform 1 from public.profiles where id=auth.uid() or id=any(p_members) order by id for share;
  perform 1 from auth.users where id=auth.uid() or id=any(p_members) order by id for share;
  perform 1 from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' for share;
  perform private.assert_partnership_admin();
end $$;

create function private.partnership_record(p_kind text,p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case p_kind
    when 'creators' then (select to_jsonb(r)||jsonb_build_object('member_name',p.nickname,'city_name',c.name,
      'participation_count',(select count(*) from private.partnership_participations x where x.creator_id=r.id))
      from private.partnership_creators r join public.cities c on c.id=r.city_id left join public.profiles p on p.id=r.member_id where r.id=p_id)
    when 'campaigns' then (select to_jsonb(r)||jsonb_build_object('merchant_name',m.name,'city_name',c.name,
      'selected_count',(select count(*) from private.partnership_participations x where x.campaign_id=r.id and x.stage in ('selected','visited','submitted','completed')),
      'applicant_count',(select count(*) from private.partnership_participations x where x.campaign_id=r.id))
      from private.partnership_campaigns r join private.merchants m on m.id=r.merchant_id join public.cities c on c.id=m.city_id where r.id=p_id)
    when 'benefits' then (select to_jsonb(r)||jsonb_build_object('merchant_name',m.name,'campaign_title',c.title,
      'issued_count',(select count(*) from private.partnership_coupons x where x.benefit_id=r.id),
      'redeemed_count',(select count(*) from private.partnership_coupons x where x.benefit_id=r.id and x.status='redeemed'))
      from private.partnership_benefits r join private.merchants m on m.id=r.merchant_id left join private.partnership_campaigns c on c.id=r.campaign_id where r.id=p_id)
  end
$$;

create function public.get_admin_partnerships(p_kind text,p_search text default '',p_offset integer default 0,p_id uuid default null,p_child_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; item jsonb; children jsonb:='[]'; coupons jsonb:='[]'; events jsonb:='[]'; more boolean; child_more boolean:=false;
begin
  perform private.lock_partnership_actor();
  if p_kind is null or p_kind not in ('creators','campaigns','benefits') or p_search is null or length(p_search)>200
    or p_offset is null or p_offset not between 0 and 10000 or p_child_offset is null or p_child_offset not between 0 and 10000 then
    raise exception 'INVALID_PARTNERSHIP';
  end if;
  if p_id is not null then
    item:=private.partnership_record(p_kind,p_id);
    if item is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  end if;
  with matches as (
    select r.id,r.updated_at from private.partnership_creators r join public.cities city on city.id=r.city_id left join public.profiles p on p.id=r.member_id
      where p_kind='creators' and (p_search='' or position(lower(p_search) in lower(concat_ws(' ',r.display_name,p.nickname,city.name,r.city_id,r.profile_url,r.category)))>0
        or exists(select 1 from private.partnership_participations x join private.partnership_campaigns c on c.id=x.campaign_id
          join private.merchants m on m.id=c.merchant_id where x.creator_id=r.id and position(lower(p_search) in lower(c.title||' '||m.name))>0))
    union all
    select r.id,r.updated_at from private.partnership_campaigns r join private.merchants m on m.id=r.merchant_id
      where p_kind='campaigns' and (p_search='' or position(lower(p_search) in lower(r.title||' '||m.name))>0)
    union all
    select r.id,r.updated_at from private.partnership_benefits r join private.merchants m on m.id=r.merchant_id left join private.partnership_campaigns c on c.id=r.campaign_id
      where p_kind='benefits' and (p_search='' or position(lower(p_search) in lower(r.title||' '||m.name||' '||coalesce(c.title,'')))>0)
  ), page as materialized (select * from matches order by updated_at desc,id limit 51 offset p_offset)
  select coalesce((select jsonb_agg(private.partnership_record(p_kind,p.id) order by p.updated_at desc,p.id)
    from (select * from page order by updated_at desc,id limit 50)p),'[]'),(select count(*)>50 from page) into rows,more;
  if p_id is not null and p_kind in ('creators','campaigns') then
    with page as materialized (select p.*,r.display_name creator_name,r.profile_url creator_profile_url,c.title campaign_title,m.name merchant_name
      from private.partnership_participations p join private.partnership_creators r on r.id=p.creator_id
      join private.partnership_campaigns c on c.id=p.campaign_id join private.merchants m on m.id=c.merchant_id
      where (p_kind='creators' and p.creator_id=p_id) or (p_kind='campaigns' and p.campaign_id=p_id)
      order by p.updated_at desc,p.id limit 51 offset p_child_offset)
    select coalesce((select jsonb_agg(to_jsonb(p) order by p.updated_at desc,p.id) from (select * from page order by updated_at desc,id limit 50)p),'[]'),
      (select count(*)>50 from page) into children,child_more;
  elsif p_id is not null and p_kind='benefits' then
    with page as materialized (select q.*,b.title benefit_title,m.name merchant_name,
      q.expires_on<(clock_timestamp() at time zone z.timezone)::date expired
      from private.partnership_coupons q join private.partnership_benefits b on b.id=q.benefit_id
      join private.merchants m on m.id=b.merchant_id join public.cities z on z.id=m.city_id where q.benefit_id=p_id
      order by q.updated_at desc,q.id limit 51 offset p_child_offset)
    select coalesce((select jsonb_agg(to_jsonb(p) order by p.updated_at desc,p.id) from (select * from page order by updated_at desc,id limit 50)p),'[]'),
      (select count(*)>50 from page) into coupons,child_more;
  end if;
  if p_id is not null then
    select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]') into events from
      (select e.id,p.nickname actor_name,e.resource_id,e.action,e.created_at from private.partnership_events e left join public.profiles p on p.id=e.actor_id
       where e.resource_id=p_id or (p_kind='creators' and e.details->>'creator_id'=p_id::text)
         or (p_kind='campaigns' and e.details->>'campaign_id'=p_id::text) or (p_kind='benefits' and e.details->>'benefit_id'=p_id::text)
       order by e.created_at desc,e.id desc limit 20)e;
  end if;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,p_id);
  return jsonb_build_object('kind',p_kind,'rows',rows,'record',item,'participations',children,'coupons',coupons,'events',events,'more',more,'children_more',child_more);
end $$;

create function public.save_admin_partnership(p_kind text,p_record jsonb,p_expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; old jsonb; data jsonb; allowed text[]; field record; stamp timestamptz; mid uuid; cid uuid; crid uuid; members uuid[];
  m private.merchants; c private.partnership_campaigns; b private.partnership_benefits; r private.partnership_creators;
  p private.partnership_participations; q private.partnership_coupons; today date; action text;
begin
  perform private.assert_partnership_admin();
  allowed:=case p_kind
    when 'creator' then array['id','member_id','display_name','city_id','profile_url','category','contact','reference_url','reference_views','metrics_note','status','notes']
    when 'campaign' then array['id','merchant_id','title','status','terms','terms_confirmed','team_limit','minimum_views','support_amount_cents','currency','deadline_note','ends_on','notes']
    when 'benefit' then array['id','merchant_id','campaign_id','title','audience','status','discount_percent','terms','terms_confirmed','expires_on','issue_limit']
    when 'participation' then array['id','campaign_id','creator_id','stage','scheduled_at','visited_at','content_url','actual_views','payment_status','payment_note','notes'] end;
  if allowed is null or p_record is null or jsonb_typeof(p_record)<>'object' or octet_length(p_record::text)>25000 then raise exception 'INVALID_PARTNERSHIP'; end if;
  for field in select * from jsonb_each(p_record) loop
    if not field.key=any(allowed) then raise exception 'INVALID_PARTNERSHIP'; end if;
    if field.value='null'::jsonb then
      if field.key not in ('member_id','campaign_id','reference_views','team_limit','minimum_views','support_amount_cents','currency','ends_on','expires_on','issue_limit','discount_percent','scheduled_at','visited_at','actual_views') then raise exception 'INVALID_PARTNERSHIP'; end if;
    elsif field.key in ('terms_confirmed') then
      if jsonb_typeof(field.value)<>'boolean' then raise exception 'INVALID_PARTNERSHIP'; end if;
    elsif field.key in ('reference_views','team_limit','minimum_views','support_amount_cents','issue_limit','discount_percent','actual_views') then
      if jsonb_typeof(field.value)<>'number' or field.value::text !~ '^[0-9]+$' then raise exception 'INVALID_PARTNERSHIP'; end if;
    elsif jsonb_typeof(field.value)<>'string' then raise exception 'INVALID_PARTNERSHIP';
    elsif field.key in ('ends_on','expires_on') and (p_record->>field.key) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_PARTNERSHIP';
    end if;
  end loop;
  rid:=(p_record->>'id')::uuid;
  if rid is null or (p_expected_updated_at is not null and not isfinite(p_expected_updated_at)) then raise exception 'INVALID_PARTNERSHIP'; end if;
  -- A stable editor/request ID also serializes simultaneous create-only saves.
  perform pg_advisory_xact_lock(hashtextextended('partnership:'||p_kind||':'||rid,0));
  case p_kind
    when 'creator' then select to_jsonb(x) into old from private.partnership_creators x where id=rid;
    when 'campaign' then select to_jsonb(x) into old from private.partnership_campaigns x where id=rid;
    when 'benefit' then select to_jsonb(x) into old from private.partnership_benefits x where id=rid;
    when 'participation' then select to_jsonb(x) into old from private.partnership_participations x where id=rid;
  end case;
  data:=coalesce(old,'{}')||p_record;
  members:=array[(old->>'member_id')::uuid,(data->>'member_id')::uuid];
  perform private.lock_partnership_actor(members);
  -- Related rows always lock merchant -> campaign -> creator -> benefit -> participation -> coupon.
  if p_kind in ('campaign','benefit') then mid:=(data->>'merchant_id')::uuid; end if;
  if p_kind='participation' then
    cid:=(data->>'campaign_id')::uuid; crid:=(data->>'creator_id')::uuid;
    select merchant_id into mid from private.partnership_campaigns where id=cid;
  elsif p_kind='benefit' then cid:=(data->>'campaign_id')::uuid;
  elsif p_kind='campaign' then cid:=rid;
  end if;
  if p_kind<>'creator' then
    select * into m from private.merchants where id=mid for share;
    if m.id is null or (old is null and (m.deleted_at is not null or m.record_kind<>'business')) then raise exception 'PARTNERSHIP_INACTIVE'; end if;
    select * into c from private.partnership_campaigns where id=cid for update;
  end if;
  if p_kind='creator' then
    select to_jsonb(x) into old from private.partnership_creators x where id=rid for update;
  elsif p_kind='campaign' then old:=case when c.id is not null then to_jsonb(c) end;
  elsif p_kind='benefit' then
    select to_jsonb(x) into old from private.partnership_benefits x where id=rid for update;
  else
    select * into r from private.partnership_creators where id=crid for share;
    select to_jsonb(x) into old from private.partnership_participations x where id=rid for update;
  end if;
  perform private.assert_partnership_admin();
  if p_kind<>'creator' then select (clock_timestamp() at time zone timezone)::date into today from public.cities where id=m.city_id; end if;
  if (old is not null and (p_expected_updated_at is null or (old->>'updated_at')::timestamptz<>p_expected_updated_at))
    or (old is null and p_expected_updated_at is not null) then raise exception 'PARTNERSHIP_CHANGED'; end if;
  stamp:=greatest(clock_timestamp(),coalesce((old->>'updated_at')::timestamptz+interval '1 microsecond','-infinity'::timestamptz));
  action:=p_kind||case when old is null then '_created' else '_saved' end;
  if p_kind='creator' then
    r:=jsonb_populate_record(null::private.partnership_creators,
      '{"category":"","contact":"","reference_url":"","metrics_note":"","status":"active","notes":""}'::jsonb||data);
    if r.member_id is not null and not exists(select 1 from public.profiles where id=r.member_id and account_status='active') then raise exception 'INVALID_PARTNERSHIP'; end if;
    insert into private.partnership_creators(id,member_id,display_name,city_id,profile_url,category,contact,reference_url,reference_views,metrics_note,status,notes,created_at,updated_at)
      values(rid,r.member_id,btrim(r.display_name),r.city_id,r.profile_url,r.category,r.contact,r.reference_url,r.reference_views,r.metrics_note,r.status,r.notes,coalesce((old->>'created_at')::timestamptz,stamp),stamp)
      on conflict(id) do update set member_id=excluded.member_id,display_name=excluded.display_name,city_id=excluded.city_id,profile_url=excluded.profile_url,
        category=excluded.category,contact=excluded.contact,reference_url=excluded.reference_url,reference_views=excluded.reference_views,
        metrics_note=excluded.metrics_note,status=excluded.status,notes=excluded.notes,updated_at=excluded.updated_at;
  elsif p_kind='campaign' then
    c:=jsonb_populate_record(null::private.partnership_campaigns,
      '{"status":"draft","terms":"","terms_confirmed":false,"deadline_note":"","notes":""}'::jsonb||data);
    if old is not null and c.merchant_id is distinct from (old->>'merchant_id')::uuid then raise exception 'PARTNERSHIP_TERMS_LOCKED'; end if;
    if old is not null and exists(select 1 from private.partnership_events e where e.action='participation_selected' and e.details->>'campaign_id'=rid::text)
      and (data-array['title','status','notes','updated_at']) is distinct from (old-array['title','status','notes','updated_at']) then raise exception 'PARTNERSHIP_TERMS_LOCKED'; end if;
    if c.status='open' then
      if m.deleted_at is not null or m.record_kind<>'business' or m.consent<>'granted' or m.status='paused' then raise exception 'PARTNERSHIP_INACTIVE'; end if;
      if not c.terms_confirmed or length(btrim(c.terms))=0 or c.ends_on is null or c.ends_on<today
        or (c.support_amount_cents is not null and c.currency is null) then raise exception 'PARTNERSHIP_TERMS_REQUIRED'; end if;
    end if;
    insert into private.partnership_campaigns(id,merchant_id,title,status,terms,terms_confirmed,team_limit,minimum_views,support_amount_cents,currency,deadline_note,ends_on,notes,created_at,updated_at)
      values(rid,c.merchant_id,btrim(c.title),c.status,c.terms,c.terms_confirmed,c.team_limit,c.minimum_views,c.support_amount_cents,c.currency,c.deadline_note,c.ends_on,c.notes,coalesce((old->>'created_at')::timestamptz,stamp),stamp)
      on conflict(id) do update set title=excluded.title,status=excluded.status,terms=excluded.terms,terms_confirmed=excluded.terms_confirmed,team_limit=excluded.team_limit,
        minimum_views=excluded.minimum_views,support_amount_cents=excluded.support_amount_cents,currency=excluded.currency,deadline_note=excluded.deadline_note,
        ends_on=excluded.ends_on,notes=excluded.notes,updated_at=excluded.updated_at;
  elsif p_kind='benefit' then
    b:=jsonb_populate_record(null::private.partnership_benefits,'{"status":"draft","terms":"","terms_confirmed":false}'::jsonb||data);
    if old is not null and (b.merchant_id is distinct from (old->>'merchant_id')::uuid or b.campaign_id is distinct from (old->>'campaign_id')::uuid) then raise exception 'PARTNERSHIP_TERMS_LOCKED'; end if;
    if b.campaign_id is not null and (c.id is null or c.merchant_id<>b.merchant_id or b.audience<>'creators') then raise exception 'INVALID_PARTNERSHIP'; end if;
    if old is not null and exists(select 1 from private.partnership_coupons where benefit_id=rid)
      and (data-array['title','status','updated_at']) is distinct from (old-array['title','status','updated_at']) then raise exception 'PARTNERSHIP_TERMS_LOCKED'; end if;
    if b.status='active' then
      if m.deleted_at is not null or m.record_kind<>'business' or m.consent<>'granted' or m.status='paused' then raise exception 'PARTNERSHIP_INACTIVE'; end if;
      if not b.terms_confirmed or length(btrim(b.terms))=0 or b.expires_on is null or b.expires_on<today then raise exception 'PARTNERSHIP_TERMS_REQUIRED'; end if;
    end if;
    insert into private.partnership_benefits(id,merchant_id,campaign_id,title,audience,status,discount_percent,terms,terms_confirmed,expires_on,issue_limit,created_at,updated_at)
      values(rid,b.merchant_id,b.campaign_id,btrim(b.title),b.audience,b.status,b.discount_percent,b.terms,b.terms_confirmed,b.expires_on,b.issue_limit,coalesce((old->>'created_at')::timestamptz,stamp),stamp)
      on conflict(id) do update set title=excluded.title,audience=excluded.audience,status=excluded.status,discount_percent=excluded.discount_percent,
        terms=excluded.terms,terms_confirmed=excluded.terms_confirmed,expires_on=excluded.expires_on,issue_limit=excluded.issue_limit,updated_at=excluded.updated_at;
  else
    p:=jsonb_populate_record(null::private.partnership_participations,
      '{"stage":"applied","content_url":"","payment_status":"not_applicable","payment_note":"","notes":""}'::jsonb||data);
    if c.id is null or r.id is null then raise exception 'INVALID_PARTNERSHIP'; end if;
    if old is not null and (p.campaign_id is distinct from (old->>'campaign_id')::uuid or p.creator_id is distinct from (old->>'creator_id')::uuid) then raise exception 'PARTNERSHIP_TERMS_LOCKED'; end if;
    if (old is null and p.stage<>'applied') or (old is not null and p.stage<>old->>'stage' and not (
      (old->>'stage'='applied' and p.stage in ('selected','declined','cancelled')) or
      (old->>'stage'='selected' and p.stage in ('visited','cancelled')) or
      (old->>'stage'='visited' and p.stage in ('submitted','cancelled')) or
      (old->>'stage'='submitted' and p.stage in ('completed','cancelled')))) then raise exception 'PARTNERSHIP_STAGE'; end if;
    if p.stage in ('visited','submitted','completed') and (p.visited_at is null or p.visited_at>clock_timestamp()) then raise exception 'PARTNERSHIP_STAGE'; end if;
    if p.stage in ('submitted','completed') and p.content_url='' then raise exception 'PARTNERSHIP_STAGE'; end if;
    if (p.payment_status='paid' and (p.stage not in ('submitted','completed') or length(btrim(p.payment_note))=0))
      or (old->>'payment_status'='paid' and (p.payment_status<>'paid' or p.stage='cancelled')) then raise exception 'PARTNERSHIP_STAGE'; end if;
    if p.stage='selected' and old->>'stage'='applied' then
      if m.deleted_at is not null or m.record_kind<>'business' or m.consent<>'granted' or m.status='paused' or r.status<>'active' or c.status<>'open'
        or c.ends_on is null or c.ends_on<today then raise exception 'PARTNERSHIP_INACTIVE'; end if;
      if c.team_limit is not null and (select count(*) from private.partnership_participations where campaign_id=c.id and stage in ('selected','visited','submitted','completed'))>=c.team_limit then raise exception 'PARTNERSHIP_CAPACITY'; end if;
      action:='participation_selected';
    end if;
    insert into private.partnership_participations(id,campaign_id,creator_id,stage,scheduled_at,visited_at,content_url,actual_views,payment_status,payment_note,notes,created_at,updated_at)
      values(rid,p.campaign_id,p.creator_id,p.stage,p.scheduled_at,p.visited_at,p.content_url,p.actual_views,p.payment_status,p.payment_note,p.notes,coalesce((old->>'created_at')::timestamptz,stamp),stamp)
      on conflict(id) do update set stage=excluded.stage,scheduled_at=excluded.scheduled_at,visited_at=excluded.visited_at,content_url=excluded.content_url,
        actual_views=excluded.actual_views,payment_status=excluded.payment_status,payment_note=excluded.payment_note,notes=excluded.notes,updated_at=excluded.updated_at;
    if p.stage='cancelled' and old->>'stage' in ('selected','visited','submitted') then
      for q in select x.* from private.partnership_coupons x join private.partnership_benefits y on y.id=x.benefit_id
        where y.campaign_id=p.campaign_id and x.creator_id=p.creator_id and x.status='issued' order by x.id for update of x loop
        update private.partnership_coupons set status='revoked',revoked_at=stamp,action_note='Participation cancelled',updated_at=greatest(stamp,q.updated_at+interval '1 microsecond') where id=q.id;
        insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),q.id,'coupon_revoked',jsonb_build_object('benefit_id',q.benefit_id,'campaign_id',p.campaign_id,'creator_id',p.creator_id,'reason','participation_cancelled'));
      end loop;
    end if;
  end if;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,rid);
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),rid,action,
    jsonb_strip_nulls(jsonb_build_object('kind',p_kind,'campaign_id',case when p_kind='campaign' then rid else cid end,'creator_id',case when p_kind='creator' then rid else crid end,
      'benefit_id',case when p_kind='benefit' then rid end,'stage',case when p_kind='participation' then p.stage end)));
  return rid;
exception
  when unique_violation then raise exception 'PARTNERSHIP_DUPLICATE';
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range
    or check_violation or not_null_violation or foreign_key_violation then raise exception 'INVALID_PARTNERSHIP';
end $$;

create function public.issue_admin_benefit_coupon(p_id uuid,p_benefit_id uuid,p_creator_id uuid default null,p_user_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare b private.partnership_benefits; c private.partnership_campaigns; r private.partnership_creators; m private.merchants;
  q private.partnership_coupons; recipient text; today date; linked_member uuid;
begin
  perform private.assert_partnership_admin();
  if p_id is null or p_benefit_id is null or (p_creator_id is null)=(p_user_id is null) then raise exception 'INVALID_PARTNERSHIP'; end if;
  perform pg_advisory_xact_lock(hashtextextended('partnership:coupon:'||p_id,0));
  select member_id into linked_member from private.partnership_creators where id=p_creator_id;
  perform private.lock_partnership_actor(array[p_user_id,linked_member]);
  select * into q from private.partnership_coupons where id=p_id;
  if q.id is not null then
    if q.benefit_id<>p_benefit_id or q.creator_id is distinct from p_creator_id or q.user_id is distinct from p_user_id then raise exception 'PARTNERSHIP_CHANGED'; end if;
    perform public.log_admin_access('analytics',null,p_id);
    return p_id;
  end if;
  select * into b from private.partnership_benefits where id=p_benefit_id;
  if b.id is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  select * into m from private.merchants where id=b.merchant_id for share;
  select * into c from private.partnership_campaigns where id=b.campaign_id for update;
  select * into r from private.partnership_creators where id=p_creator_id for share;
  select * into b from private.partnership_benefits where id=p_benefit_id for update;
  perform private.assert_partnership_admin();
  select (clock_timestamp() at time zone timezone)::date into today from public.cities where id=m.city_id;
  if (b.audience='creators')<>(p_creator_id is not null) then raise exception 'INVALID_PARTNERSHIP'; end if;
  if m.deleted_at is not null or m.record_kind<>'business' or m.consent<>'granted' or m.status='paused'
    or b.status<>'active' or not b.terms_confirmed or b.terms='' or b.expires_on is null or b.expires_on<today then raise exception 'PARTNERSHIP_INACTIVE'; end if;
  if p_creator_id is not null then
    if r.id is null or r.status<>'active' then raise exception 'PARTNERSHIP_INACTIVE'; end if;
    if r.member_id is distinct from linked_member then raise exception 'PARTNERSHIP_CHANGED'; end if;
    recipient:=r.display_name;
  else
    select nickname::text into recipient from public.profiles where id=p_user_id and account_status='active';
    if recipient is null then raise exception 'PARTNERSHIP_INACTIVE'; end if;
  end if;
  if b.campaign_id is not null then
    perform 1 from private.partnership_participations where campaign_id=c.id and creator_id=p_creator_id and stage in ('selected','visited','submitted','completed') for share;
    if not found or c.status<>'open' or c.ends_on is null or c.ends_on<today or c.merchant_id<>m.id then raise exception 'PARTNERSHIP_INACTIVE'; end if;
  end if;
  if exists(select 1 from private.partnership_coupons where benefit_id=b.id and (creator_id=p_creator_id or user_id=p_user_id)) then raise exception 'COUPON_ALREADY_ISSUED'; end if;
  if b.issue_limit is not null and (select count(*) from private.partnership_coupons where benefit_id=b.id)>=b.issue_limit then raise exception 'PARTNERSHIP_CAPACITY'; end if;
  insert into private.partnership_coupons(id,benefit_id,creator_id,user_id,recipient_name,code,expires_on,terms_snapshot)
    values(p_id,b.id,p_creator_id,p_user_id,recipient,replace(gen_random_uuid()::text,'-',''),b.expires_on,
      jsonb_build_object('title',b.title,'merchant_id',b.merchant_id,'campaign_id',b.campaign_id,'audience',b.audience,
        'discount_percent',b.discount_percent,'terms',b.terms,'expires_on',b.expires_on,'campaign_terms',c.terms,'support_amount_cents',c.support_amount_cents,'currency',c.currency));
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,p_id);
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),p_id,'coupon_issued',
    jsonb_strip_nulls(jsonb_build_object('benefit_id',b.id,'campaign_id',b.campaign_id,'creator_id',p_creator_id,'user_id',p_user_id)));
  return p_id;
end $$;

create function public.act_admin_benefit_coupon(p_id uuid,p_expected_updated_at timestamptz,p_action text,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare b private.partnership_benefits; c private.partnership_campaigns; r private.partnership_creators; m private.merchants;
  q private.partnership_coupons; today date; stamp timestamptz; linked_member uuid;
begin
  perform private.assert_partnership_admin();
  if p_id is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at) or p_action is null or p_action not in ('redeem','revoke')
    or p_note is null or length(btrim(p_note)) not between 1 and 1000 then raise exception 'INVALID_PARTNERSHIP'; end if;
  select * into q from private.partnership_coupons where id=p_id;
  if q.id is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  select member_id into linked_member from private.partnership_creators where id=q.creator_id;
  perform private.lock_partnership_actor(array[q.user_id,linked_member]);
  select * into b from private.partnership_benefits where id=q.benefit_id;
  select * into m from private.merchants where id=b.merchant_id for share;
  select * into c from private.partnership_campaigns where id=b.campaign_id for update;
  select * into r from private.partnership_creators where id=q.creator_id for share;
  select * into b from private.partnership_benefits where id=q.benefit_id for update;
  if b.campaign_id is not null then
    perform 1 from private.partnership_participations where campaign_id=c.id and creator_id=q.creator_id and stage in ('selected','visited','submitted','completed') for share;
    if p_action='redeem' and not found then raise exception 'COUPON_UNAVAILABLE'; end if;
  end if;
  select * into q from private.partnership_coupons where id=p_id for update;
  perform private.assert_partnership_admin();
  if q.updated_at<>p_expected_updated_at then raise exception 'PARTNERSHIP_CHANGED'; end if;
  if q.status<>'issued' then raise exception 'COUPON_UNAVAILABLE'; end if;
  if p_action='redeem' then
    select (clock_timestamp() at time zone timezone)::date into today from public.cities where id=m.city_id;
    if m.deleted_at is not null or m.record_kind<>'business' or m.consent<>'granted' or m.status='paused'
      or b.status<>'active' or q.expires_on<today or b.expires_on<today
      or (q.creator_id is not null and (r.id is null or r.status<>'active'))
      or (q.user_id is not null and not exists(select 1 from public.profiles where id=q.user_id and account_status='active'))
      or (b.campaign_id is not null and (c.status<>'open' or c.ends_on is null or c.ends_on<today)) then raise exception 'COUPON_UNAVAILABLE'; end if;
    if q.creator_id is not null and r.member_id is distinct from linked_member then raise exception 'PARTNERSHIP_CHANGED'; end if;
  end if;
  stamp:=greatest(clock_timestamp(),q.updated_at+interval '1 microsecond');
  update private.partnership_coupons set status=case p_action when 'redeem' then 'redeemed' else 'revoked' end,
    redeemed_at=case when p_action='redeem' then stamp end,revoked_at=case when p_action='revoke' then stamp end,
    action_note=btrim(p_note),updated_at=stamp where id=p_id;
  perform public.log_admin_access('analytics',null,p_id);
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),p_id,case p_action when 'redeem' then 'coupon_redeemed' else 'coupon_revoked' end,
    jsonb_strip_nulls(jsonb_build_object('benefit_id',b.id,'campaign_id',b.campaign_id,'creator_id',q.creator_id,'user_id',q.user_id)));
  return p_id;
end $$;

alter function private.assert_partnership_admin() owner to postgres;
alter function private.lock_partnership_actor(uuid[]) owner to postgres;
alter function private.partnership_record(text,uuid) owner to postgres;
revoke all on function private.assert_partnership_admin(),private.lock_partnership_actor(uuid[]),private.partnership_record(text,uuid) from public,anon,authenticated,service_role;
alter function public.get_admin_partnerships(text,text,integer,uuid,integer) owner to postgres;
alter function public.save_admin_partnership(text,jsonb,timestamptz) owner to postgres;
alter function public.issue_admin_benefit_coupon(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.act_admin_benefit_coupon(uuid,timestamptz,text,text) owner to postgres;
revoke all on function public.get_admin_partnerships(text,text,integer,uuid,integer),public.save_admin_partnership(text,jsonb,timestamptz),
  public.issue_admin_benefit_coupon(uuid,uuid,uuid,uuid),public.act_admin_benefit_coupon(uuid,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_partnerships(text,text,integer,uuid,integer),public.save_admin_partnership(text,jsonb,timestamptz),
  public.issue_admin_benefit_coupon(uuid,uuid,uuid,uuid),public.act_admin_benefit_coupon(uuid,timestamptz,text,text) to authenticated;
notify pgrst,'reload schema';
