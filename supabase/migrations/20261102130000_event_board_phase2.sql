-- Event board, step 2 (owner 2026-11-02 "컨펌 답 (크리에이터 보드 아이디어)": all seven ideas "넣기"; design table in
-- output/reviews/influencer-event-automation-2026-11-02/spec.md "## 2단계"). Data and server functions only: the admin board
-- (admin checkout) and the automations call these. Board functions check access exactly like the other admin partnership
-- functions (private.lock_partnership_actor / assert_partnership_admin: admin with a live AAL2 session) and log every change
-- to partnership_events. Automation functions are service_role only. outreach_stage is still read only through to_jsonb(row).

-- 1. What the discovery automation reads off an applicant's public profile; null means not checked yet.
alter table private.partnership_creators
  add column followers_count integer check(followers_count>=0),
  add column is_private boolean,
  add column recent_reel_avg_views integer check(recent_reel_avg_views>=0),
  add column uses_korean boolean,
  add column profile_checked_at timestamptz check(isfinite(profile_checked_at));

-- 3, 6. Why someone was left out, a "needs a look" flag, and the result DM: group, where it goes and how sending went.
-- dm_claimed_at is the sender's lease: a claimed row is not handed out again until it is finished or 15 minutes pass.
-- DM columns never touch updated_at, so sending in the background does not trip the board's PARTNERSHIP_CHANGED checks.
alter table private.partnership_participations
  add column drop_reason text check(length(btrim(drop_reason)) between 1 and 200),
  add column needs_check boolean not null default false,
  add column dm_group text check(dm_group in ('winner','discount','sorry')),
  add column dm_channel text check(dm_channel in ('instagram','threads')),
  add column dm_status text check(dm_status in ('queued','sent','already_in_thread','failed')),
  add column dm_sent_at timestamptz check(isfinite(dm_sent_at)),
  add column dm_error text check(length(btrim(dm_error)) between 1 and 300),
  add column dm_attempts integer not null default 0 check(dm_attempts between 0 and 100),
  add column dm_claimed_at timestamptz check(isfinite(dm_claimed_at)),
  add constraint partnership_participations_dm check(coalesce(dm_status='sent',false)=(dm_sent_at is not null)
    and (dm_error is null or coalesce(dm_status='failed',false)) and (dm_claimed_at is null or coalesce(dm_status='queued',false))
    and (dm_status is null or (dm_group is not null and dm_channel is not null)));
create index partnership_participations_dm_queue on private.partnership_participations(dm_claimed_at nulls first,id) where dm_status='queued';
-- Apply-link entries are Instagram handles.
update private.partnership_participations set dm_channel='instagram' where applied_via='apply_link' and dm_channel is null;

-- 4. The benefit's conditions in one place; DMs, the result post and the store page read the same columns.
-- weekdays: 1=Monday … 7=Sunday, null = every day.
alter table private.partnership_benefits
  add column starts_on date check(isfinite(starts_on)),
  add column max_discount_cents integer check(max_discount_cents between 1 and 99999999),
  add column weekdays smallint[] check(cardinality(weekdays) between 1 and 7 and array_position(weekdays,null) is null
    and weekdays<@'{1,2,3,4,5,6,7}'::smallint[]),
  add column dine_in_only boolean not null default false,
  add column checkout_note text check(length(btrim(checkout_note)) between 1 and 200),
  add constraint partnership_benefits_window check(starts_on<=expires_on);

-- 7. The business's own Instagram handle and place tag, entered once (address and logo stay on merchants).
-- The apply page's "Hosted by … with @…" line, the result post and DMs read this; it replaces step 1's apply_settings.instagram.
create table private.merchant_event_profiles (
  merchant_id uuid primary key references private.merchants(id),
  instagram text check(private.event_handle(instagram) is not distinct from instagram),
  ig_location_id text check(ig_location_id ~ '^[0-9]{1,30}$'),
  ig_location_name text check(length(btrim(ig_location_name)) between 1 and 120),
  updated_at timestamptz not null default clock_timestamp(),
  check((ig_location_id is null)=(ig_location_name is null))
);

-- 6. One DM text per event, group and language. An approval is the SHA-256 of the exact body the owner confirmed, so it
-- cannot outlive a change to the text.
create table private.partnership_dm_templates (
  campaign_id uuid not null references private.partnership_campaigns(id),
  dm_group text not null check(dm_group in ('winner','discount','sorry')),
  language text not null check(language in ('en','ko')),
  body text not null check(length(body) between 1 and 2000 and body=btrim(body)),
  approved_sha256 text check(approved_sha256=encode(sha256(convert_to(body,'UTF8')),'hex')),
  approved_at timestamptz check(isfinite(approved_at)),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(campaign_id,dm_group,language),
  check((approved_sha256 is null)=(approved_at is null))
);

-- 5. The results post. At most one draft or approved post per event at a time.
create table private.partnership_result_posts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references private.partnership_campaigns(id),
  status text not null default 'draft' check(status in ('draft','approved','published','failed')),
  permalink text check(permalink ~ '^https://www[.]instagram[.]com/(p|reel)/[A-Za-z0-9_-]{1,60}/$'),
  media_id text check(media_id ~ '^[0-9]{1,30}$'),
  created_at timestamptz not null default clock_timestamp(),
  published_at timestamptz check(isfinite(published_at)),
  check((status='published')=(published_at is not null and permalink is not null and media_id is not null)),
  check(status='published' or (permalink is null and media_id is null))
);
create unique index partnership_result_posts_open on private.partnership_result_posts(campaign_id) where status in ('draft','approved');
create index partnership_result_posts_campaign on private.partnership_result_posts(campaign_id,created_at desc);

do $$
declare t text;
begin
  foreach t in array array['merchant_event_profiles','partnership_dm_templates','partnership_result_posts'] loop
    execute format('alter table private.%I owner to postgres',t);
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

-- Where a creator's DM can go, from their profile link; null when neither Instagram nor Threads.
create function private.event_dm_channel(p_profile_url text) returns text
language sql immutable set search_path='' as $$
  select case when k ~ '^https://instagram[.]com/[^/]+$' then 'instagram' when k ~ '^https://threads[.]com/@[^/]+$' then 'threads' end
  from (select private.partnership_profile_key(p_profile_url) k) x
$$;

-- Step 1 functions, now reading the step 2 columns. Same signatures, so their owner and grants stay.
-- A drop reason means left out, the same as the board's dropped column, so the store never lists that person as a winner.
create or replace function private.event_winner(p private.partnership_participations) returns boolean
language sql stable set search_path='' as $$
  select (p.stage in ('selected','visited','submitted','completed') or coalesce(to_jsonb(p)->>'outreach_stage' in ('confirmed','posted'),false))
    and p.stage not in ('declined','cancelled') and coalesce(to_jsonb(p)->>'outreach_stage','')<>'dropped' and p.drop_reason is null
$$;

create or replace function public.event_apply_info(p_slug text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('title',c.title,'business',m.name,'avatar',a.path,'instagram',e.instagram,'support',s.support,
    'visit_dates',v.dates,'time_slots',s.time_slots,'party_max',s.party_max,'reel_days_max',s.reel_days_max,
    'terms',c.terms,'closes_on',case when coalesce(c.ends_on>=t.today,true) then least(l.expires_on,c.ends_on) end,'deadline_note',c.deadline_note)
  from private.partnership_campaign_links l join private.partnership_campaigns c on c.id=l.campaign_id
    join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id
    join private.partnership_apply_settings s on s.campaign_id=c.id
    left join private.merchant_event_profiles e on e.merchant_id=m.id
    cross join lateral (select public.get_merchant_profile(m.id)->>'avatar_path' path) a
    cross join lateral (select (clock_timestamp() at time zone z.timezone)::date today) t
    cross join lateral (select array_agg(d order by d) dates from unnest(s.visit_dates) d where d>=t.today) v
  where l.kind='apply' and l.slug=p_slug and c.id=private.event_link_campaign('apply',p_slug) and a.path is not null and v.dates is not null
$$;

-- As step 1, plus: an apply-link entry is reached on Instagram.
create or replace function public.event_apply(p_slug text,p_handle text,p_slots jsonb,p_party integer,p_allergies text,p_reel_days integer,
  p_language text,p_ip_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cid uuid; handle text; city text; today date; cfg private.partnership_apply_settings; allergy text:=btrim(p_allergies);
  url text; crid uuid; pid uuid; again boolean:=false;
begin
  if p_ip_sha256 is null or p_ip_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_EVENT_LINK'; end if;
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
  insert into private.partnership_participations(id,campaign_id,creator_id,applied_via,language,applied_at,
      preferred_slots,party_size,has_allergies,allergies,reel_within_days,dm_channel)
    values(gen_random_uuid(),cid,crid,'apply_link',p_language,clock_timestamp(),p_slots,p_party,p_allergies is not null,allergy,p_reel_days,'instagram')
    on conflict(campaign_id,creator_id) do nothing returning id into pid;
  if pid is null then
    again:=true;
    update private.partnership_participations p set applied_via='apply_link',language=p_language,applied_at=coalesce(p.applied_at,clock_timestamp()),
      preferred_slots=p_slots,party_size=p_party,has_allergies=p_allergies is not null,allergies=allergy,reel_within_days=p_reel_days,
      dm_channel=coalesce(p.dm_channel,'instagram'),updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond')
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

-- As step 1, plus each benefit's conditions so the business sees the same rules the DMs state.
create or replace function public.event_store_view(p_token_sha256 text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('title',c.title,'business',m.name,'avatar',public.get_merchant_profile(m.id)->>'avatar_path',
    'ends_on',c.ends_on,'deadline_note',c.deadline_note,'timezone',z.timezone,
    'applicant_count',(select count(*) from private.partnership_participations p where p.campaign_id=c.id),
    'winners',(select coalesce(jsonb_agg(jsonb_build_object('handle',w.handle,'name',w.display_name,'scheduled_at',w.scheduled_at,
          'party_size',w.party_size,'has_allergies',w.has_allergies,'allergies',w.allergies)
        order by w.scheduled_at nulls last,w.display_name),'[]')
      from (select r.display_name,p.scheduled_at,p.party_size,p.has_allergies,p.allergies,substring(private.partnership_profile_key(r.profile_url) from '^https://instagram[.]com/([^/]+)$') handle
        from private.partnership_participations p join private.partnership_creators r on r.id=p.creator_id
        where p.campaign_id=c.id and private.event_winner(p)) w),
    'benefits',(select coalesce(jsonb_agg(jsonb_build_object('title',b.title,'discount_percent',b.discount_percent,'expires_on',b.expires_on,'terms',b.terms,
          'starts_on',b.starts_on,'max_discount_cents',b.max_discount_cents,'weekdays',b.weekdays,'dine_in_only',b.dine_in_only,'checkout_note',b.checkout_note)
        order by b.created_at,b.id),'[]')
      from private.partnership_benefits b where b.campaign_id=c.id and b.status='active'))
  from private.partnership_campaigns c join private.merchants m on m.id=c.merchant_id join public.cities z on z.id=m.city_id
  where c.id=private.event_link_campaign('store',p_token_sha256)
$$;

-- As step 1, plus: someone left out with a reason, or told "sorry" in the results, is not on the discount list.
create or replace function public.event_store_lookup(p_token_sha256 text,p_handle text) returns jsonb
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
      and coalesce(to_jsonb(p)->>'outreach_stage','')<>'dropped' and p.drop_reason is null and coalesce(p.dm_group,'discount')='discount'
      and (not private.event_entry_late(p)
        or coalesce((select s.late_gets_benefit from private.partnership_apply_settings s where s.campaign_id=cid),false)))
    or exists(select 1 from private.partnership_coupons q join private.partnership_benefits b on b.id=q.benefit_id
      where b.campaign_id=cid and q.creator_id=crid and q.status='issued' and q.expires_on>=today) then
    return jsonb_build_object('status','discount');
  end if;
  return jsonb_build_object('status','none');
end $$;

-- Board functions (admin, AAL2), same order of checks as move_admin_event_stage.

create function public.save_event_benefit_terms(p_benefit_id uuid,p_starts_on date,p_max_discount_cents integer,p_weekdays smallint[],
  p_dine_in_only boolean,p_checkout_note text,p_expected_updated_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare b private.partnership_benefits; days smallint[]; note text:=nullif(btrim(p_checkout_note),''); stamp timestamptz;
begin
  perform private.lock_partnership_actor();
  if p_benefit_id is null or p_dine_in_only is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or not coalesce(isfinite(p_starts_on),true) or not coalesce(p_max_discount_cents between 1 and 99999999,true)
    or array_position(p_weekdays,null) is not null or not coalesce(p_weekdays<@'{1,2,3,4,5,6,7}'::smallint[],true)
    or length(note)>200 then raise exception 'INVALID_PARTNERSHIP'; end if;
  days:=(select array_agg(distinct d order by d) from unnest(p_weekdays) d);
  select * into b from private.partnership_benefits where id=p_benefit_id for update;
  if b.id is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  if p_starts_on>b.expires_on then raise exception 'INVALID_PARTNERSHIP'; end if;
  perform private.assert_partnership_admin();
  if b.updated_at<>p_expected_updated_at then raise exception 'PARTNERSHIP_CHANGED'; end if;
  stamp:=greatest(clock_timestamp(),b.updated_at+interval '1 microsecond');
  update private.partnership_benefits set starts_on=p_starts_on,max_discount_cents=p_max_discount_cents,weekdays=days,
    dine_in_only=p_dine_in_only,checkout_note=note,updated_at=stamp where id=p_benefit_id;
  perform public.log_admin_access('analytics',null,p_benefit_id);
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),p_benefit_id,'benefit_terms_saved',
    jsonb_build_object('kind','benefit','benefit_id',p_benefit_id,'campaign_id',b.campaign_id,'starts_on',p_starts_on,
      'max_discount_cents',p_max_discount_cents,'weekdays',days,'dine_in_only',p_dine_in_only,'checkout_note',note));
  return p_benefit_id;
end $$;

-- Blank values clear a field; the handle is stored the way Instagram writes it.
create function public.save_merchant_event_profile(p_merchant_id uuid,p_instagram text,p_ig_location_id text,p_ig_location_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare m private.merchants; handle text:=private.event_handle(p_instagram); loc text:=nullif(btrim(p_ig_location_id),'');
  place text:=nullif(btrim(p_ig_location_name),'');
begin
  perform private.lock_partnership_actor();
  if p_merchant_id is null or (handle is null and nullif(btrim(p_instagram),'') is not null) or loc !~ '^[0-9]{1,30}$'
    or length(place)>120 or (loc is null)<>(place is null) then raise exception 'INVALID_PARTNERSHIP'; end if;
  select * into m from private.merchants where id=p_merchant_id for share;
  if m.id is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  if m.deleted_at is not null or m.record_kind<>'business' then raise exception 'PARTNERSHIP_INACTIVE'; end if;
  perform private.assert_partnership_admin();
  insert into private.merchant_event_profiles(merchant_id,instagram,ig_location_id,ig_location_name) values(p_merchant_id,handle,loc,place)
    on conflict(merchant_id) do update set instagram=excluded.instagram,ig_location_id=excluded.ig_location_id,
      ig_location_name=excluded.ig_location_name,updated_at=clock_timestamp();
  perform public.log_admin_access('analytics',null,p_merchant_id);
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),p_merchant_id,'merchant_event_profile_saved',
    jsonb_build_object('kind','merchant','merchant_id',p_merchant_id,'instagram',handle,'ig_location_id',loc,'ig_location_name',place));
  return p_merchant_id;
end $$;

-- Leaving someone out keeps a one-line reason (the stage itself moves through move_admin_event_stage).
create function public.set_participation_review(p_participation_id uuid,p_drop_reason text,p_needs_check boolean,p_expected_updated_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare p private.partnership_participations; reason text:=nullif(btrim(p_drop_reason),''); stamp timestamptz;
begin
  perform private.lock_partnership_actor();
  if p_participation_id is null or p_needs_check is null or length(reason)>200
    or p_expected_updated_at is null or not isfinite(p_expected_updated_at) then raise exception 'INVALID_PARTNERSHIP'; end if;
  select * into p from private.partnership_participations where id=p_participation_id for update;
  if p.id is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  perform private.assert_partnership_admin();
  if p.updated_at<>p_expected_updated_at then raise exception 'PARTNERSHIP_CHANGED'; end if;
  if p.drop_reason is not distinct from reason and p.needs_check=p_needs_check then return p_participation_id; end if;
  stamp:=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond');
  update private.partnership_participations set drop_reason=reason,needs_check=p_needs_check,updated_at=stamp where id=p_participation_id;
  perform public.log_admin_access('analytics',null,p_participation_id);
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),p_participation_id,'participation_reviewed',
    jsonb_build_object('kind','participation','campaign_id',p.campaign_id,'creator_id',p.creator_id,'drop_reason',reason,'needs_check',p_needs_check));
  return p_participation_id;
end $$;

-- "결과 발표": a draft results post (reused while one is draft or approved) and everyone's DM group, for rows not yet queued
-- or sent. Left out (dropped or with a reason) → no DM, checked first so nobody dropped is ever told they won;
-- winner (stage selected or later, or put in the winner group by the board) → winner; on-time entries, or late ones when the
-- event allows, get discount while the event has an active creator benefit; everyone else → sorry.
create function public.request_event_result(p_campaign_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c private.partnership_campaigns; post uuid; late_ok boolean; perk boolean; counts jsonb;
begin
  perform private.lock_partnership_actor();
  if p_campaign_id is null then raise exception 'INVALID_PARTNERSHIP'; end if;
  select * into c from private.partnership_campaigns where id=p_campaign_id for update;
  if c.id is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  perform private.assert_partnership_admin();
  select id into post from private.partnership_result_posts where campaign_id=c.id and status in ('draft','approved');
  if post is null then
    insert into private.partnership_result_posts(campaign_id) values(c.id) returning id into post;
    insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),post,'result_post_requested',
      jsonb_build_object('kind','result_post','campaign_id',c.id));
  end if;
  late_ok:=coalesce((select late_gets_benefit from private.partnership_apply_settings where campaign_id=c.id),false);
  perk:=exists(select 1 from private.partnership_benefits where campaign_id=c.id and audience='creators' and status='active');
  update private.partnership_participations p set dm_group=case
      when coalesce(to_jsonb(p)->>'outreach_stage','')='dropped' or p.drop_reason is not null then null
      when p.stage in ('selected','visited','submitted','completed') or p.dm_group='winner' then 'winner'
      when perk and (late_ok or not private.event_entry_late(p)) then 'discount'
      else 'sorry' end
    where p.campaign_id=c.id and p.dm_status is null;
  select jsonb_object_agg(g,n) into counts from (select coalesce(dm_group,'none') g,count(*) n
    from private.partnership_participations where campaign_id=c.id group by 1) x;
  perform public.log_admin_access('analytics',null,c.id);
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),c.id,'event_result_grouped',
    jsonb_build_object('kind','campaign','campaign_id',c.id,'result_post_id',post,'groups',coalesce(counts,'{}')));
  return post;
end $$;

-- Saving keeps the approval only when the text is exactly the approved one. Returns the body's SHA-256 to approve with.
create function public.save_event_dm_template(p_campaign_id uuid,p_dm_group text,p_language text,p_body text) returns text
language plpgsql security definer set search_path='' as $$
declare body text:=btrim(p_body); sha text; kept boolean;
begin
  perform private.lock_partnership_actor();
  if p_campaign_id is null or p_dm_group is null or p_dm_group not in ('winner','discount','sorry') or p_language is null
    or p_language not in ('en','ko') or coalesce(length(body),0) not between 1 and 2000 then raise exception 'INVALID_PARTNERSHIP'; end if;
  perform 1 from private.partnership_campaigns where id=p_campaign_id for share;
  if not found then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  perform private.assert_partnership_admin();
  sha:=encode(sha256(convert_to(body,'UTF8')),'hex');
  insert into private.partnership_dm_templates as t(campaign_id,dm_group,language,body) values(p_campaign_id,p_dm_group,p_language,body)
    on conflict(campaign_id,dm_group,language) do update set body=excluded.body,
      approved_sha256=case when t.approved_sha256=sha then t.approved_sha256 end,approved_at=case when t.approved_sha256=sha then t.approved_at end,
      updated_at=clock_timestamp()
    returning t.approved_sha256 is not null into kept;
  perform public.log_admin_access('analytics',null,p_campaign_id);
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),p_campaign_id,'dm_template_saved',
    jsonb_build_object('kind','campaign','campaign_id',p_campaign_id,'dm_group',p_dm_group,'language',p_language,'body_sha256',sha,'approved',kept));
  return sha;
end $$;

-- Called after the owner confirms the text, with the SHA-256 save_event_dm_template returned for it; a text changed since is refused.
create function public.approve_event_dm_template(p_campaign_id uuid,p_dm_group text,p_language text,p_body_sha256 text) returns text
language plpgsql security definer set search_path='' as $$
declare t private.partnership_dm_templates;
begin
  perform private.lock_partnership_actor();
  if p_campaign_id is null or p_dm_group is null or p_language is null or p_body_sha256 is null or p_body_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_PARTNERSHIP';
  end if;
  select * into t from private.partnership_dm_templates where campaign_id=p_campaign_id and dm_group=p_dm_group and language=p_language for update;
  if t.campaign_id is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  perform private.assert_partnership_admin();
  if encode(sha256(convert_to(t.body,'UTF8')),'hex')<>p_body_sha256 then raise exception 'PARTNERSHIP_CHANGED'; end if;
  if t.approved_sha256 is not null then return p_body_sha256; end if;
  update private.partnership_dm_templates set approved_sha256=p_body_sha256,approved_at=clock_timestamp(),updated_at=clock_timestamp()
    where campaign_id=p_campaign_id and dm_group=p_dm_group and language=p_language;
  perform public.log_admin_access('analytics',null,p_campaign_id);
  insert into private.partnership_events(actor_id,resource_id,action,details) values(auth.uid(),p_campaign_id,'dm_template_approved',
    jsonb_build_object('kind','campaign','campaign_id',p_campaign_id,'dm_group',p_dm_group,'language',p_language,'body_sha256',p_body_sha256));
  return p_body_sha256;
end $$;

-- "DM 보내기" for the people picked on the board, all in p_dm_group. Each needs an approved text in their language (none
-- recorded = English). Rows already sent or already queued are skipped, as are people with no Instagram or Threads profile;
-- failed or already-in-thread rows go back in the queue with a fresh try count.
create function public.queue_event_dms(p_campaign_id uuid,p_participation_ids uuid[],p_dm_group text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare queued integer;
begin
  perform private.lock_partnership_actor();
  if p_campaign_id is null or p_dm_group is null or p_dm_group not in ('winner','discount','sorry') or p_participation_ids is null
    or cardinality(p_participation_ids) not between 1 and 500 or array_position(p_participation_ids,null) is not null then
    raise exception 'INVALID_PARTNERSHIP';
  end if;
  perform 1 from private.partnership_campaigns where id=p_campaign_id for share;
  if not found then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  perform 1 from private.partnership_participations where id=any(p_participation_ids) order by id for update;
  if (select count(*) from private.partnership_participations where id=any(p_participation_ids) and campaign_id=p_campaign_id)
    <>(select count(distinct x) from unnest(p_participation_ids) x) then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  if exists(select 1 from private.partnership_participations where id=any(p_participation_ids)
      and coalesce(dm_status,'') not in ('sent','queued') and dm_group is distinct from p_dm_group) then
    raise exception 'PARTNERSHIP_CHANGED';
  end if;
  if exists(select 1 from private.partnership_participations p where p.id=any(p_participation_ids) and coalesce(p.dm_status,'') not in ('sent','queued')
      and not exists(select 1 from private.partnership_dm_templates t where t.campaign_id=p_campaign_id and t.dm_group=p_dm_group
        and t.language=coalesce(p.language,'en') and t.approved_sha256 is not null)) then
    raise exception 'DM_TEMPLATE_NOT_APPROVED';
  end if;
  perform private.assert_partnership_admin();
  with q as (
    update private.partnership_participations p set dm_status='queued',dm_channel=coalesce(p.dm_channel,private.event_dm_channel(r.profile_url)),
      dm_attempts=0,dm_error=null,dm_sent_at=null,dm_claimed_at=null
    from private.partnership_creators r
    where r.id=p.creator_id and p.id=any(p_participation_ids) and coalesce(p.dm_status,'') not in ('sent','queued')
      and coalesce(p.dm_channel,private.event_dm_channel(r.profile_url)) is not null
    returning p.id,p.creator_id,p.dm_channel,p.language),
  logged as (
    insert into private.partnership_events(actor_id,resource_id,action,details)
    select auth.uid(),q.id,'participation_dm_queued',jsonb_build_object('kind','participation','campaign_id',p_campaign_id,
      'creator_id',q.creator_id,'dm_group',p_dm_group,'dm_channel',q.dm_channel,'language',coalesce(q.language,'en')) from q
    returning 1)
  select count(*) into queued from logged;
  perform public.log_admin_access('analytics',null,p_campaign_id);
  return jsonb_build_object('queued',queued,'skipped',(select count(distinct x) from unnest(p_participation_ids) x)-queued);
end $$;

-- Automation functions (service_role).

-- The discovery automation's read of an applicant's public profile.
create function public.set_creator_profile_stats(p_creator_id uuid,p_followers_count integer,p_is_private boolean,
  p_recent_reel_avg_views integer,p_uses_korean boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update private.partnership_creators set followers_count=p_followers_count,is_private=p_is_private,
    recent_reel_avg_views=p_recent_reel_avg_views,uses_korean=p_uses_korean,profile_checked_at=clock_timestamp()
    where id=p_creator_id;
  if not found then return false; end if;
  insert into private.partnership_events(actor_id,resource_id,action,details) values(null,p_creator_id,'creator_profile_checked',
    jsonb_build_object('kind','creator','creator_id',p_creator_id,'followers_count',p_followers_count,'is_private',p_is_private,
      'recent_reel_avg_views',p_recent_reel_avg_views,'uses_korean',p_uses_korean));
  return true;
end $$;

-- Up to p_limit queued DMs whose text is still approved, each leased for 15 minutes with its try count raised. Parallel
-- senders skip each other's rows (skip locked) and the lease keeps a row from being handed out again after this commits.
-- A row that used three tries without a result is marked failed for the board's "다시 확인" column instead.
create function public.claim_event_dms(p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare claimed jsonb;
begin
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'INVALID_EVENT_DM'; end if;
  with stale as (
    select id from private.partnership_participations where dm_status='queued' and dm_attempts>=3
      and dm_claimed_at<clock_timestamp()-interval '15 minutes' for update skip locked),
  gave_up as (
    update private.partnership_participations p set dm_status='failed',dm_claimed_at=null,dm_error='No result after 3 tries'
    from stale where p.id=stale.id returning p.id,p.campaign_id,p.creator_id,p.dm_group,p.dm_channel,p.dm_attempts)
  insert into private.partnership_events(actor_id,resource_id,action,details)
    select null,g.id,'participation_dm_finished',jsonb_build_object('kind','participation','campaign_id',g.campaign_id,'creator_id',g.creator_id,
      'dm_group',g.dm_group,'dm_channel',g.dm_channel,'dm_status','failed','attempts',g.dm_attempts) from gave_up g;
  with picked as (
    select p.id from private.partnership_participations p
      join private.partnership_dm_templates t on t.campaign_id=p.campaign_id and t.dm_group=p.dm_group
        and t.language=coalesce(p.language,'en') and t.approved_sha256 is not null
    where p.dm_status='queued' and p.dm_attempts<3 and (p.dm_claimed_at is null or p.dm_claimed_at<clock_timestamp()-interval '15 minutes')
    order by p.dm_claimed_at nulls first,p.id limit p_limit
    for update of p skip locked),
  took as (
    update private.partnership_participations p set dm_claimed_at=clock_timestamp(),dm_attempts=p.dm_attempts+1
    from picked where p.id=picked.id returning p.*)
  select coalesce(jsonb_agg(jsonb_build_object('participation_id',k.id,'campaign_id',k.campaign_id,'creator_id',k.creator_id,
      'display_name',r.display_name,'profile_url',r.profile_url,'dm_group',k.dm_group,'dm_channel',k.dm_channel,
      'language',t.language,'body',t.body,'body_sha256',t.approved_sha256,'attempt',k.dm_attempts) order by k.id),'[]')
    into claimed
    from took k join private.partnership_creators r on r.id=k.creator_id
    join private.partnership_dm_templates t on t.campaign_id=k.campaign_id and t.dm_group=k.dm_group and t.language=coalesce(k.language,'en');
  return claimed;
end $$;

-- What happened to a claimed DM. An error note goes only with failed. false when the row is not out with a sender.
create function public.finish_event_dm(p_participation_id uuid,p_status text,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare p private.partnership_participations; note text:=nullif(btrim(p_error),'');
begin
  if p_participation_id is null or p_status is null or p_status not in ('sent','already_in_thread','failed')
    or (p_status='failed')<>(note is not null) or length(note)>300 then raise exception 'INVALID_EVENT_DM'; end if;
  update private.partnership_participations set dm_status=p_status,dm_sent_at=case when p_status='sent' then clock_timestamp() end,
    dm_error=note,dm_claimed_at=null
    where id=p_participation_id and dm_status='queued' and dm_claimed_at is not null returning * into p;
  if p.id is null then return false; end if;
  insert into private.partnership_events(actor_id,resource_id,action,details) values(null,p.id,'participation_dm_finished',
    jsonb_build_object('kind','participation','campaign_id',p.campaign_id,'creator_id',p.creator_id,'dm_group',p.dm_group,
      'dm_channel',p.dm_channel,'dm_status',p_status,'attempts',p.dm_attempts));
  return true;
end $$;

-- The results post moves draft → approved (owner confirmed) → published (with its permalink and media id) or failed;
-- a failed post can be approved again or recorded as published.
create function public.set_result_post(p_post_id uuid,p_status text,p_permalink text default null,p_media_id text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare r private.partnership_result_posts;
begin
  select * into r from private.partnership_result_posts where id=p_post_id for update;
  if r.id is null or p_status is null or (r.status,p_status) not in (('draft','approved'),('approved','published'),('approved','failed'),
      ('failed','approved'),('failed','published')) then raise exception 'INVALID_EVENT_RESULT'; end if;
  update private.partnership_result_posts set status=p_status,permalink=p_permalink,media_id=p_media_id,
    published_at=case when p_status='published' then clock_timestamp() end where id=p_post_id;
  insert into private.partnership_events(actor_id,resource_id,action,details) values(null,p_post_id,'result_post_'||p_status,
    jsonb_strip_nulls(jsonb_build_object('kind','result_post','campaign_id',r.campaign_id,'status',p_status,'permalink',p_permalink,'media_id',p_media_id)));
  return true;
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.event_dm_channel(text)',
    'public.save_event_benefit_terms(uuid,date,integer,smallint[],boolean,text,timestamptz)','public.save_merchant_event_profile(uuid,text,text,text)',
    'public.set_participation_review(uuid,text,boolean,timestamptz)','public.request_event_result(uuid)',
    'public.save_event_dm_template(uuid,text,text,text)','public.approve_event_dm_template(uuid,text,text,text)',
    'public.queue_event_dms(uuid,uuid[],text)','public.set_creator_profile_stats(uuid,integer,boolean,integer,boolean)',
    'public.claim_event_dms(integer)','public.finish_event_dm(uuid,text,text)','public.set_result_post(uuid,text,text,text)'] loop
    execute format('alter function %s owner to postgres',f);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  end loop;
end $$;
grant execute on function public.save_event_benefit_terms(uuid,date,integer,smallint[],boolean,text,timestamptz),
  public.save_merchant_event_profile(uuid,text,text,text),public.set_participation_review(uuid,text,boolean,timestamptz),
  public.request_event_result(uuid),public.save_event_dm_template(uuid,text,text,text),public.approve_event_dm_template(uuid,text,text,text),
  public.queue_event_dms(uuid,uuid[],text) to authenticated;
grant execute on function public.set_creator_profile_stats(uuid,integer,boolean,integer,boolean),public.claim_event_dms(integer),
  public.finish_event_dm(uuid,text,text),public.set_result_post(uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
