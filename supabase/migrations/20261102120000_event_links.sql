-- Event apply link + store share link (owner 2026-11-02 "신청 링크 + 가게 공유 링크 먼저", "링크 하나 (로그인 없이 보기)").
-- Only the event-link edge function (service_role) calls these; it hashes store tokens and caller IPs before they arrive.
-- The admin event board's outreach_stage (admin checkout 20261101230000) may not exist yet. It is read only through
-- to_jsonb(row), never named, so this migration and its functions work with or without that column.
create table private.partnership_campaign_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references private.partnership_campaigns(id),
  kind text not null check(kind in ('apply','store')),
  slug text unique check(slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
  -- The store token itself is shown once by scripts/event-links.mjs and never stored.
  token_sha256 text unique check(token_sha256 ~ '^[0-9a-f]{64}$'),
  expires_on date not null check(isfinite(expires_on)),
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check((kind='apply' and slug is not null and token_sha256 is null) or (kind='store' and token_sha256 is not null and slug is null))
);
create index partnership_campaign_links_campaign on private.partnership_campaign_links(campaign_id);

alter table private.partnership_participations
  add column applied_via text not null default 'admin' check(applied_via in ('admin','event_board','apply_link')),
  add column language text check(language in ('en','ko')),
  add column applied_at timestamptz check(isfinite(applied_at)),
  -- What the person picked on the apply page; null for people added by hand on the admin board.
  add column preferred_slots jsonb check(jsonb_typeof(preferred_slots)='array' and jsonb_array_length(preferred_slots) between 1 and 2),
  add column party_size integer check(party_size between 1 and 10),
  add column has_allergies boolean,
  add column allergies text check(length(allergies) between 1 and 200),
  add column reel_within_days integer check(reel_within_days between 1 and 7),
  add constraint partnership_participations_allergies check((allergies is not null)=coalesce(has_allergies,false));

-- What an applicant picks from, all shown on the public apply page (owner 2026-11-02 "날짜랑 시간이랑 인원이랑 알러지랑
-- … 언제 릴스 올릴수 있냐? 몇일내에? … 우리가 지원하는게 잇으면 잇다 없으면 없다"). One row per campaign, set by
-- scripts/event-links.mjs settings. support lists fixed items (their labels live in the page copy) as covered or not.
-- A Reel is due within 7 days at most (owner 2026-11-02 "7일이 맥시멈으로하자"). instagram is the business's own handle for
-- the "Hosted by @gling.app with @…" line; without it the page names the business instead.
create table private.partnership_apply_settings (
  campaign_id uuid primary key references private.partnership_campaigns(id),
  visit_dates date[] not null check(cardinality(visit_dates) between 1 and 60 and array_position(visit_dates,null) is null),
  time_slots text[] not null check(cardinality(time_slots) between 1 and 24
    and array_to_string(time_slots,',','x') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$'),
  party_max integer not null check(party_max between 1 and 10),
  reel_days_max integer not null default 7 check(reel_days_max between 1 and 7),
  support jsonb not null default '[]',
  instagram text check(instagram ~ '^[a-z0-9._]{1,30}$'),
  updated_at timestamptz not null default clock_timestamp()
);

create table private.partnership_apply_attempts (
  ip_sha256 text not null check(ip_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
create index partnership_apply_attempts_ip on private.partnership_apply_attempts(ip_sha256,created_at);

do $$
declare t text;
begin
  foreach t in array array['campaign_links','apply_attempts','apply_settings'] loop
    execute format('alter table private.partnership_%I owner to postgres',t);
    execute format('alter table private.partnership_%I enable row level security',t);
    execute format('revoke all on private.partnership_%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

-- Instagram handle as typed ("@Name", " name ") → "name", or null when Instagram would not accept it.
create function private.event_handle(p_handle text) returns text
language sql immutable set search_path='' as $$
  select h from (select lower(regexp_replace(btrim(coalesce(p_handle,'')),'^@','')) h) x
  where h ~ '^[a-z0-9._]{1,30}$' and h !~ '^[.]|[.]$|[.][.]'
$$;

-- The campaign behind a live link. Applying also needs the campaign open and not ended;
-- a store keeps seeing a closed campaign (visits come after applications) until its own link expires.
create function private.event_link_campaign(p_kind text,p_key text) returns uuid
language sql stable set search_path='' as $$
  select c.id from private.partnership_campaign_links l
    join private.partnership_campaigns c on c.id=l.campaign_id
    join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id
  where l.kind=p_kind and (case p_kind when 'apply' then l.slug else l.token_sha256 end)=p_key
    and l.revoked_at is null and m.deleted_at is null
    and l.expires_on>=(clock_timestamp() at time zone z.timezone)::date
    and (p_kind='store' or (c.status='open' and c.ends_on>=(clock_timestamp() at time zone z.timezone)::date))
$$;

-- Selected (strict stage) or confirmed/posted on the board, unless cancelled, declined or dropped.
create function private.event_winner(p private.partnership_participations) returns boolean
language sql stable set search_path='' as $$
  -- coalesce: without the board column the outreach test is null, and "not event_winner" must still be true for applicants.
  select (p.stage in ('selected','visited','submitted','completed') or coalesce(to_jsonb(p)->>'outreach_stage' in ('confirmed','posted'),false))
    and p.stage not in ('declined','cancelled') and coalesce(to_jsonb(p)->>'outreach_stage','')<>'dropped'
$$;

-- The approved page (galbi example 2026-11-02): business name and logo, what the event covers, what to do (terms),
-- when (applications close on the earlier of the link's expiry and the campaign's end) and the choices for the form.
-- Visit dates already past drop off; with none left there is no page.
-- The logo is the business profile's own public avatar path (public-post?format=business-image), only while that
-- profile is public. The page always shows the real logo (owner 2026-11-02 "항상 로고로해야지 맞는듯"), so without
-- one there is no page. There is no business Instagram field to show; nothing else about the business leaves.
create function public.event_apply_info(p_slug text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('title',c.title,'business',m.name,'avatar',a.path,'instagram',s.instagram,'support',s.support,
    'visit_dates',v.dates,'time_slots',s.time_slots,'party_max',s.party_max,'reel_days_max',s.reel_days_max,
    'terms',c.terms,'closes_on',least(l.expires_on,c.ends_on),'deadline_note',c.deadline_note)
  from private.partnership_campaign_links l join private.partnership_campaigns c on c.id=l.campaign_id
    join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id
    join private.partnership_apply_settings s on s.campaign_id=c.id
    cross join lateral (select public.get_merchant_profile(m.id)->>'avatar_path' path) a
    cross join lateral (select array_agg(d order by d) dates from unnest(s.visit_dates) d
      where d>=(clock_timestamp() at time zone z.timezone)::date) v
  where l.kind='apply' and l.slug=p_slug and c.id=private.event_link_campaign('apply',p_slug) and a.path is not null and v.dates is not null
$$;

-- [{key, covered, note_en?, note_ko?}], each key once, from the fixed list the page has labels for.
create function private.event_support_ok(p jsonb) returns boolean
language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p)='array' and jsonb_array_length(p)<=5 then coalesce((
    select count(distinct e->>'key')=count(*) and bool_and(coalesce(case when jsonb_typeof(e)='object' then
      e->>'key' in ('meal','drinks','alcohol','parking','fee') and jsonb_typeof(e->'covered')='boolean'
      and jsonb_typeof(coalesce(e->'note_en','""'))='string' and length(coalesce(e->>'note_en',''))<=120
      and jsonb_typeof(coalesce(e->'note_ko','""'))='string' and length(coalesce(e->>'note_ko',''))<=120
      and e-'key'-'covered'-'note_en'-'note_ko'='{}'::jsonb end,false))
    from jsonb_array_elements(p) e),true) else false end
$$;
alter table private.partnership_apply_settings add constraint partnership_apply_settings_support check(private.event_support_ok(support));

-- First choice required, second optional: [{date, time}] from the campaign's dates (today or later) and times, no repeats.
create function private.event_slots_ok(p jsonb,p_dates date[],p_times text[],p_today date) returns boolean
language sql stable set search_path='' as $$
  select case when jsonb_typeof(p)='array' and jsonb_array_length(p) between 1 and 2 then coalesce((
    with open_days as (select array_agg(to_char(d,'YYYY-MM-DD')) days from unnest(p_dates) d where d>=p_today)
    select count(distinct e)=count(*) and bool_and(coalesce(case when jsonb_typeof(e)<>'object' then false
      when e-'date'-'time'<>'{}'::jsonb then false else e->>'date'=any(o.days) and e->>'time'=any(p_times) end,false))
    from jsonb_array_elements(p) e,open_days o),false) else false end
$$;

-- Input problems return {ok:false} instead of raising, so the attempt row (the rate limit) is kept.
create function public.event_apply(p_slug text,p_handle text,p_slots jsonb,p_party integer,p_allergies text,p_reel_days integer,
  p_language text,p_ip_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cid uuid; handle text; city text; today date; cfg private.partnership_apply_settings; allergy text:=btrim(p_allergies);
  url text; crid uuid; pid uuid; again boolean:=false;
begin
  if p_ip_sha256 is null or p_ip_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_EVENT_LINK'; end if;
  -- One caller's attempts run one at a time, so parallel requests cannot slip past the hourly cap.
  perform pg_advisory_xact_lock(hashtextextended('event_apply:'||p_ip_sha256,0));
  delete from private.partnership_apply_attempts where created_at<clock_timestamp()-interval '1 hour';
  if (select count(*) from private.partnership_apply_attempts where ip_sha256=p_ip_sha256)>=10 then
    return jsonb_build_object('ok',false,'error','rate_limited');
  end if;
  insert into private.partnership_apply_attempts(ip_sha256) values(p_ip_sha256);
  cid:=private.event_link_campaign('apply',p_slug);
  if cid is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  handle:=private.event_handle(p_handle);
  select m.city_id,(clock_timestamp() at time zone z.timezone)::date into city,today
    from private.partnership_campaigns c join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id where c.id=cid;
  select * into cfg from private.partnership_apply_settings where campaign_id=cid;
  if cfg.campaign_id is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  -- null allergies means "none"; an empty answer is not one.
  if not coalesce(handle is not null and p_language in ('en','ko')
      and p_party between 1 and cfg.party_max and p_reel_days between 1 and cfg.reel_days_max
      and (p_allergies is null or length(allergy) between 1 and 200)
      and private.event_slots_ok(p_slots,cfg.visit_dates,cfg.time_slots,today),false) then
    return jsonb_build_object('ok',false,'error','invalid');
  end if;
  url:='https://www.instagram.com/'||handle||'/';
  insert into private.partnership_creators(id,display_name,city_id,profile_url) values(gen_random_uuid(),handle,city,url)
    on conflict ((private.partnership_profile_key(profile_url))) do nothing;
  select id into crid from private.partnership_creators where private.partnership_profile_key(profile_url)=private.partnership_profile_key(url);
  -- New rows take the board defaults (stage applied, outreach candidate). A repeat entry refreshes what the person picked only
  -- while they are still a candidate: anyone typing a picked person's handle must not change the visit, party or allergies
  -- the business sees. Either way the answer is the same, so it does not reveal who was picked.
  insert into private.partnership_participations(id,campaign_id,creator_id,applied_via,language,applied_at,
      preferred_slots,party_size,has_allergies,allergies,reel_within_days)
    values(gen_random_uuid(),cid,crid,'apply_link',p_language,clock_timestamp(),p_slots,p_party,p_allergies is not null,allergy,p_reel_days)
    on conflict(campaign_id,creator_id) do nothing returning id into pid;
  if pid is null then
    again:=true;
    update private.partnership_participations p set applied_via='apply_link',language=p_language,applied_at=clock_timestamp(),
      preferred_slots=p_slots,party_size=p_party,has_allergies=p_allergies is not null,allergies=allergy,reel_within_days=p_reel_days,
      updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond')
      where p.campaign_id=cid and p.creator_id=crid and p.stage='applied'
        and coalesce(to_jsonb(p)->>'outreach_stage','candidate') in ('candidate','proposed','replied') and not private.event_winner(p)
      returning p.id into pid;
  end if;
  if pid is not null then
    insert into private.partnership_events(actor_id,resource_id,action,details) values(null,pid,'participation_applied',
      jsonb_build_object('kind','participation','campaign_id',cid,'creator_id',crid,'stage','applied','source','apply_link','again',again));
  end if;
  return jsonb_build_object('ok',true,'already',again);
end $$;

create function public.event_store_view(p_token_sha256 text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('title',c.title,'business',m.name,'avatar',public.get_merchant_profile(m.id)->>'avatar_path',
    'ends_on',c.ends_on,'deadline_note',c.deadline_note,'timezone',z.timezone,
    'applicant_count',(select count(*) from private.partnership_participations p where p.campaign_id=c.id),
    -- What the business needs to get ready: the confirmed visit, how many come, allergies.
    'winners',(select coalesce(jsonb_agg(jsonb_build_object('handle',w.handle,'name',w.display_name,'scheduled_at',w.scheduled_at,
          'party_size',w.party_size,'has_allergies',w.has_allergies,'allergies',w.allergies)
        order by w.scheduled_at nulls last,w.display_name),'[]')
      from (select r.display_name,p.scheduled_at,p.party_size,p.has_allergies,p.allergies,substring(private.partnership_profile_key(r.profile_url) from '^https://instagram[.]com/([^/]+)$') handle
        from private.partnership_participations p join private.partnership_creators r on r.id=p.creator_id
        where p.campaign_id=c.id and private.event_winner(p)) w),
    'benefits',(select coalesce(jsonb_agg(jsonb_build_object('title',b.title,'discount_percent',b.discount_percent,'expires_on',b.expires_on,'terms',b.terms)
        order by b.created_at,b.id),'[]')
      from private.partnership_benefits b where b.campaign_id=c.id and b.status='active'))
  from private.partnership_campaigns c join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id
  where c.id=private.event_link_campaign('store',p_token_sha256)
$$;

-- Only this one handle's status leaves the function, never the list it was checked against.
create function public.event_store_lookup(p_token_sha256 text,p_handle text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare cid uuid:=private.event_link_campaign('store',p_token_sha256); crid uuid; today date;
begin
  if cid is null then return null; end if;
  select r.id into crid from private.partnership_creators r
    where private.partnership_profile_key(r.profile_url)='https://instagram.com/'||private.event_handle(p_handle);
  if exists(select 1 from private.partnership_participations p where p.campaign_id=cid and p.creator_id=crid and private.event_winner(p)) then
    return jsonb_build_object('status','winner');
  end if;
  select (clock_timestamp() at time zone z.timezone)::date into today from private.partnership_campaigns c
    join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id where c.id=cid;
  if exists(select 1 from private.partnership_participations p where p.campaign_id=cid and p.creator_id=crid
      and coalesce(to_jsonb(p)->>'outreach_stage','')<>'dropped')
    or exists(select 1 from private.partnership_coupons q join private.partnership_benefits b on b.id=q.benefit_id
      where b.campaign_id=cid and q.creator_id=crid and q.status='issued' and q.expires_on>=today) then
    return jsonb_build_object('status','discount');
  end if;
  return jsonb_build_object('status','none');
end $$;

-- scripts/event-links.mjs makes and kills links; there is no admin screen for them in this first step.
-- An apply link needs the business's public logo and apply settings with a visit date still ahead, as event_apply_info does.
create function public.create_event_link(p_campaign_id uuid,p_kind text,p_slug text,p_token_sha256 text,p_expires_on date) returns uuid
language plpgsql security definer set search_path='' as $$
declare lid uuid;
begin
  if p_kind='apply' and exists(select 1 from private.partnership_campaigns c where c.id=p_campaign_id
      and public.get_merchant_profile(c.merchant_id)->>'avatar_path' is null) then
    raise exception 'BUSINESS_LOGO_REQUIRED';
  end if;
  if p_kind='apply' and exists(select 1 from private.partnership_campaigns c where c.id=p_campaign_id) and not exists(
      select 1 from private.partnership_apply_settings s join private.partnership_campaigns c on c.id=s.campaign_id
        join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id
      where s.campaign_id=p_campaign_id and (select max(d) from unnest(s.visit_dates) d)>=(clock_timestamp() at time zone z.timezone)::date) then
    raise exception 'APPLY_SETTINGS_REQUIRED';
  end if;
  insert into private.partnership_campaign_links(campaign_id,kind,slug,token_sha256,expires_on)
    values(p_campaign_id,p_kind,p_slug,p_token_sha256,p_expires_on) returning id into lid;
  insert into private.partnership_events(actor_id,resource_id,action,details)
    values(null,lid,'campaign_link_created',jsonb_build_object('kind','campaign_link','campaign_id',p_campaign_id,'link_kind',p_kind));
  return lid;
end $$;

-- Dates and times are de-duplicated and sorted; anything else out of range fails on the table's checks.
create function public.set_event_apply_settings(p_campaign_id uuid,p_visit_dates date[],p_time_slots text[],p_party_max integer,
  p_reel_days_max integer default 7,p_support jsonb default '[]',p_instagram text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  insert into private.partnership_apply_settings(campaign_id,visit_dates,time_slots,party_max,reel_days_max,support,instagram)
    values(p_campaign_id,(select array_agg(distinct d order by d) from unnest(p_visit_dates) d),
      (select array_agg(distinct t order by t) from unnest(p_time_slots) t),p_party_max,coalesce(p_reel_days_max,7),coalesce(p_support,'[]'),
      case when btrim(p_instagram)<>'' then coalesce(private.event_handle(p_instagram),p_instagram) end)
    on conflict(campaign_id) do update set visit_dates=excluded.visit_dates,time_slots=excluded.time_slots,party_max=excluded.party_max,
      reel_days_max=excluded.reel_days_max,support=excluded.support,instagram=excluded.instagram,updated_at=clock_timestamp();
  insert into private.partnership_events(actor_id,resource_id,action,details)
    values(null,p_campaign_id,'campaign_apply_settings_saved',jsonb_build_object('kind','campaign','campaign_id',p_campaign_id));
end $$;

create function public.revoke_event_link(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
  update private.partnership_campaign_links set revoked_at=clock_timestamp() where id=p_id and revoked_at is null returning campaign_id into cid;
  if cid is null then return false; end if;
  insert into private.partnership_events(actor_id,resource_id,action,details)
    values(null,p_id,'campaign_link_revoked',jsonb_build_object('kind','campaign_link','campaign_id',cid));
  return true;
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.event_handle(text)','private.event_link_campaign(text,text)',
    'private.event_winner(private.partnership_participations)','private.event_support_ok(jsonb)',
    'private.event_slots_ok(jsonb,date[],text[],date)','public.event_apply_info(text)',
    'public.event_apply(text,text,jsonb,integer,text,integer,text,text)','public.event_store_view(text)','public.event_store_lookup(text,text)',
    'public.create_event_link(uuid,text,text,text,date)','public.set_event_apply_settings(uuid,date[],text[],integer,integer,jsonb,text)',
    'public.revoke_event_link(uuid)'] loop
    execute format('alter function %s owner to postgres',f);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  end loop;
end $$;
grant execute on function public.event_apply_info(text),public.event_apply(text,text,jsonb,integer,text,integer,text,text),
  public.event_store_view(text),public.event_store_lookup(text,text),public.create_event_link(uuid,text,text,text,date),
  public.set_event_apply_settings(uuid,date[],text[],integer,integer,jsonb,text),public.revoke_event_link(uuid) to service_role;
notify pgrst,'reload schema';
