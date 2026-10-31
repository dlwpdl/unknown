-- Vancouver official-meetup experiment (owner 2026-10-30 "밴쿠버에서 시작해. 제휴장소는 지모코 퍼센트는 아직 정하지말고 바꿀수잇게").
-- Additive only; released apps keep their RPCs and simply ignore the new room_preview key.
--   1. An admin attaches a partner business and an editable benefit (text, optional percent) to a meetup. It lives in the
--      public room_preview as "partner", so every existing feed/detail read already carries it to anon and members.
--      Nobody else can write that key: create/edit paths strip or keep it server-side.
--   2. Check-ins record who checked a member in (self, host or check-in staff) so a reward decision can tell them apart.
--   3. Admin-only experiment metrics as one JSON value. Nothing here creates a meetup or grants a reward.

-- 1. Partner benefit ------------------------------------------------------------------------------------------------
create function private.guard_meetup_partner() returns trigger
language plpgsql security definer set search_path='' as $$
declare kept jsonb:=case when tg_op='UPDATE' then old.room_preview->'partner' end;
begin
  if new.room_preview is null or new.room_preview->'partner' is not distinct from kept then return new; end if;
  -- Only admin_set_meetup_partner raises the transaction flag, and it still has to be an admin.
  if current_setting('gling.meetup_partner_write',true)='on' and private.is_admin() then return new; end if;
  new.room_preview:=case when kept is null then new.room_preview-'partner' else jsonb_set(new.room_preview,'{partner}',kept) end;
  return new;
end $$;
revoke all on function private.guard_meetup_partner() from public,anon,authenticated,service_role;
create trigger posts_meetup_partner_guard before insert or update of room_preview on public.posts
  for each row execute function private.guard_meetup_partner();

-- p_merchant_id null clears the benefit. p_percent stays optional and can change any time.
create function public.admin_set_meetup_partner(p_post_id uuid,p_merchant_id uuid,p_benefit text default null,p_percent numeric default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare meetup public.posts; business_name text; benefit text:=nullif(btrim(regexp_replace(coalesce(p_benefit,''),'\s+',' ','g')),''); partner jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform private.lock_relationships();
  select * into meetup from public.posts where id=p_post_id and room_preview is not null for update;
  if meetup.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if p_merchant_id is not null then
    -- Same visibility as the public business profile the line links to.
    select coalesce(nullif(btrim(public.get_merchant_profile(m.id)->>'name'),''),m.name) into business_name
      from private.merchants m where m.id=p_merchant_id and public.get_merchant_profile(m.id) is not null;
    if business_name is null then raise exception 'PARTNER_BUSINESS_NOT_FOUND'; end if;
    if benefit is null and p_percent is null or char_length(benefit)>60 then raise exception 'INVALID_PARTNER_BENEFIT'; end if;
    if p_percent is not null and (p_percent<1 or p_percent>100 or p_percent<>trunc(p_percent)) then raise exception 'INVALID_PARTNER_PERCENT'; end if;
    partner:=jsonb_strip_nulls(jsonb_build_object('businessId',p_merchant_id,'name',business_name,'benefit',benefit,'percent',p_percent::integer));
  end if;
  perform set_config('gling.meetup_partner_write','on',true);
  update public.posts set room_preview=case when partner is null then room_preview-'partner' else room_preview||jsonb_build_object('partner',partner) end
    where id=p_post_id;
  perform set_config('gling.meetup_partner_write','',true);
  perform public.log_admin_access('posts',null,p_post_id);
  return partner;
end $$;
revoke all on function public.admin_set_meetup_partner(uuid,uuid,text,numeric) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_meetup_partner(uuid,uuid,text,numeric) to authenticated;

-- Signed-out readers see an allow-list of room_preview keys in the public feed/detail reads; the partner joins it.
do $$
declare f regprocedure; definition text; anchor text:=',''recommendedAgeMax'']))'; patched integer:=0;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('public','private') and p.prosrc like '%'||anchor||'%' loop
    definition:=pg_get_functiondef(f);
    if strpos(definition,'''partner''')>0 then raise exception 'MEETUP_PARTNER_ALLOWLIST_CHANGED %',f; end if;
    execute replace(definition,anchor,',''recommendedAgeMax'',''partner'']))');
    patched:=patched+1;
  end loop;
  if patched=0 or not exists(select 1 from pg_proc where oid='private.business_base_get_public_post(uuid)'::regprocedure and prosrc like '%''partner'']))%')
    then raise exception 'MEETUP_PARTNER_ALLOWLIST_CHANGED'; end if;
end $$;

-- 2. Check-in source ------------------------------------------------------------------------------------------------
-- No user id is kept, only the role of whoever checked the member in; older rows stay null ("unknown").
alter table private.meetup_attendance add column check_in_source text check(check_in_source in('self','host','staff'));

create function private.record_meetup_check_in_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if tg_op='UPDATE' and old.checked_in_at is not null then new.check_in_source:=old.check_in_source; return new; end if;
  new.check_in_source:=case when new.checked_in_at is null or actor is null then null when actor=new.user_id then 'self'
    when actor=(select host_id from private.meetup_sessions where id=new.session_id) then 'host' else 'staff' end;
  return new;
end $$;
revoke all on function private.record_meetup_check_in_source() from public,anon,authenticated,service_role;
create trigger meetup_attendance_check_in_source before insert or update on private.meetup_attendance
  for each row execute function private.record_meetup_check_in_source();

-- 3. Experiment metrics ---------------------------------------------------------------------------------------------
-- Operated or staff accounts never count as attendees, hosts or requesters (same markers as the persona red lines and
-- the admin meetup alerts). p_exclude adds accounts that carry no marker, such as the official account.
create function private.is_meetup_operator(p_user uuid,p_exclude uuid[]) returns boolean
language sql stable security definer set search_path='' as $$
  select p_user=any(coalesce(p_exclude,'{}')) or private.is_operated_character(p_user) or exists(select 1 from auth.users u where u.id=p_user and (
    coalesce(u.raw_app_meta_data->>'role','member') in('admin','review','reviewer','bot','seed','test','tester','system')
    or coalesce(u.raw_app_meta_data->'review_access','false'::jsonb)='true'::jsonb
    or coalesce(u.email,'') like '%@official.gling.invalid'));
$$;
revoke all on function private.is_meetup_operator(uuid,uuid[]) from public,anon,authenticated,service_role;

-- Official meetups are the ones with a partner benefit, or exactly p_post_ids. Sessions starting in [p_since, p_until).
create function public.admin_meetup_experiment_metrics(p_since timestamptz default null,p_until timestamptz default null,
  p_city_id text default null,p_post_ids uuid[] default null,p_exclude uuid[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare since timestamptz:=coalesce(p_since,now()-interval '28 days'); until timestamptz:=coalesce(p_until,now()+interval '1 day'); result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if until<=since or until-since>interval '120 days' then raise exception 'INVALID_WINDOW'; end if;
  perform public.log_admin_access('analytics');
  with official as (
    select p.* from public.posts p where p.room_preview is not null and (p_city_id is null or p.city_id=p_city_id)
      and case when p_post_ids is null then p.room_preview ? 'partner' else p.id=any(p_post_ids) end
  ), new_host as (
    -- A real member's meetups created in the window when they had never opened a meetup before it.
    select p.* from public.posts p where p.room_preview is not null and p.created_at>=since and p.created_at<until
      and (p_city_id is null or p.city_id=p_city_id) and not private.is_meetup_operator(p.author_id,p_exclude)
      and not exists(select 1 from public.posts e where e.author_id=p.author_id and e.room_preview is not null and e.created_at<since)
  ), sessions as (
    select s.*,x.kind from private.meetup_sessions s
      join (select id,'official' kind from official union all select id,'new_host' from new_host) x on x.id=s.post_id
      where s.starts_at>=since and s.starts_at<until
  ), attendees as (
    select s.id session_id,s.kind,s.post_id,s.starts_at,a.user_id,a.check_in_source,a.confirmation_source,
      exists(select 1 from private.meetup_attendance_confirmations c where c.session_id=s.id and c.witness_id=s.host_id and c.attendee_id=a.user_id) host_witnessed
    from sessions s join private.meetup_attendance a on a.session_id=s.id
    where a.checked_in_at is not null and a.user_id<>s.host_id and not private.is_meetup_operator(a.user_id,p_exclude)
  ), people as (
    select distinct user_id from attendees union select distinct author_id from new_host
  ), marks as (
    select u.user_id,m.mark from people u cross join lateral unnest(private.invite_marks(u.user_id)) m(mark)
  ), shared as (
    select a.user_id,b.user_id other_id from marks a join marks b on b.mark=a.mark and b.user_id<>a.user_id
    union select m.user_id,i.invitee_id from marks m join private.invite_identity_marks i on i.mark=m.mark and i.invitee_id<>m.user_id
  ), flagged as (
    select user_id,array_agg(distinct other_id) others from shared group by user_id
  ), scored as (
    select t.*,
      coalesce(t.check_in_source in('host','staff') or t.confirmation_source='admin',false) or t.host_witnessed reward_eligible,
      exists(select 1 from attendees e where e.kind='official' and e.user_id=t.user_id and e.starts_at<t.starts_at) repeat_attendee,
      f.others multi_account_with
    from attendees t left join flagged f on f.user_id=t.user_id
  )
  select jsonb_build_object(
    'window',jsonb_build_object('since',since,'until',until,'cityId',p_city_id),
    'official',coalesce((select jsonb_agg(jsonb_build_object('postId',o.id,'title',o.title,'cityId',o.city_id,'status',o.status,
      'hostId',o.author_id,'hostIsOperator',private.is_meetup_operator(o.author_id,p_exclude),'partner',o.room_preview->'partner',
      'joinRequests',(select jsonb_build_object('total',count(*),'approved',count(*) filter(where r.status='approved'),
          'pending',count(*) filter(where r.status='pending'),'other',count(*) filter(where r.status not in('approved','pending')))
        from public.meetup_requests r where r.post_id=o.id and not private.is_meetup_operator(r.requester_id,p_exclude)),
      'sessions',coalesce((select jsonb_agg(jsonb_build_object('sessionId',s.id,'startsAt',s.starts_at,'endsAt',s.ends_at,
          'hostCheckedIn',exists(select 1 from private.meetup_attendance h where h.session_id=s.id and h.user_id=s.host_id and h.checked_in_at is not null),
          'attendees',(select count(*) from scored r where r.session_id=s.id),
          'rewardEligible',(select count(*) from scored r where r.session_id=s.id and r.reward_eligible),
          'repeatAttendees',(select count(*) from scored r where r.session_id=s.id and r.repeat_attendee),
          'checkInSource',(select jsonb_build_object('self',count(*) filter(where r.check_in_source='self'),'host',count(*) filter(where r.check_in_source='host'),
              'staff',count(*) filter(where r.check_in_source='staff'),'unknown',count(*) filter(where r.check_in_source is null))
            from scored r where r.session_id=s.id),
          'people',coalesce((select jsonb_agg(jsonb_build_object('userId',r.user_id,'nickname',pr.nickname,'checkInSource',r.check_in_source,
              'confirmationSource',r.confirmation_source,'hostWitnessed',r.host_witnessed,'rewardEligible',r.reward_eligible,
              'repeatAttendee',r.repeat_attendee,'multiAccountWith',to_jsonb(r.multi_account_with)) order by pr.nickname)
            from scored r join public.profiles pr on pr.id=r.user_id where r.session_id=s.id),'[]'::jsonb)
        ) order by s.starts_at) from sessions s where s.post_id=o.id and s.kind='official'),'[]'::jsonb)
    ) order by o.created_at) from official o where exists(select 1 from sessions s where s.post_id=o.id and s.kind='official')
      or o.created_at>=since and o.created_at<until),'[]'::jsonb),
    'totals',jsonb_build_object(
      'officialSessions',(select count(*) from sessions where kind='official'),
      'joinRequests',(select count(*) from public.meetup_requests r join official o on o.id=r.post_id
        where r.created_at>=since and r.created_at<until and not private.is_meetup_operator(r.requester_id,p_exclude)),
      'distinctAttendees',(select count(distinct user_id) from scored where kind='official'),
      'repeatAttendees',(select count(*) from (select user_id from scored where kind='official' group by user_id having count(distinct session_id)>1) x),
      'rewardEligibleAttendees',(select count(distinct user_id) from scored where kind='official' and reward_eligible),
      'multiAccountFlagged',(select count(distinct user_id) from scored where multi_account_with is not null)),
    'newHosts',coalesce((select jsonb_agg(jsonb_build_object('hostId',n.author_id,'nickname',pr.nickname,'postId',n.id,'title',n.title,
        'createdAt',n.created_at,'status',n.status,'sessions',(select count(*) from sessions s where s.post_id=n.id),
        'attendees',(select count(distinct r.user_id) from scored r where r.post_id=n.id),
        'rewardEligible',(select count(distinct r.user_id) from scored r where r.post_id=n.id and r.reward_eligible),
        'hostMultiAccountWith',to_jsonb((select f.others from flagged f where f.user_id=n.author_id))) order by n.created_at)
      from new_host n join public.profiles pr on pr.id=n.author_id),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.admin_meetup_experiment_metrics(timestamptz,timestamptz,text,uuid[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_meetup_experiment_metrics(timestamptz,timestamptz,text,uuid[],uuid[]) to authenticated;

-- Existing cron, visibility and report functions run as postgres.
alter function private.guard_meetup_partner() owner to postgres;
alter function public.admin_set_meetup_partner(uuid,uuid,text,numeric) owner to postgres;
alter function private.record_meetup_check_in_source() owner to postgres;
alter function private.is_meetup_operator(uuid,uuid[]) owner to postgres;
alter function public.admin_meetup_experiment_metrics(timestamptz,timestamptz,text,uuid[],uuid[]) owner to postgres;
-- The partner line's tap target, so the existing behavior batch accepts it.
insert into private.behavior_targets(id) values('meetup.partner.open') on conflict do nothing;
notify pgrst,'reload schema';
