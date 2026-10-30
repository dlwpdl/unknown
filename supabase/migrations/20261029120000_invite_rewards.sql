-- Invite rewards (owner 2026-10-29, review output/reviews/gling-idea-note-review-2026-10-29 §4).
-- Additive only. Released apps keep working: the reward reaches them through the same membership functions,
-- shaped like a store entitlement (store 'reward', will_renew false, a 'gling.invite.*' product id).
--   Personal link: the invitee's first host-confirmed meetup attendance gives the inviter Plus 2 weeks
--   (Pro 2 weeks when the inviter hosted that meetup or has hosted before).
--   Business link: the invited business's first own post gives both businesses Business Plus 2 weeks.
--   Periods queue one after another; at most 8 weeks per person (personal) or per business, ever.
--   One reward per device and per email/phone, never for inviting yourself. Only the server grants.

-- 1. Links. One personal link per member, one link per business (the same link works as the shop's QR).
create table private.invite_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  merchant_id uuid references private.merchants(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index invite_links_personal_once on private.invite_links(owner_id) where merchant_id is null;
create unique index invite_links_business_once on private.invite_links(merchant_id) where merchant_id is not null;

-- 2. Who joined through which link. Outcome stays null until the reward step is decided.
create table private.invite_redemptions (
  invitee_id uuid primary key references public.profiles(id) on delete cascade,
  link_id uuid not null references private.invite_links(id) on delete cascade,
  inviter_id uuid not null,
  redeemed_at timestamptz not null default now(),
  qualified_at timestamptz,
  outcome text check (outcome in ('rewarded','cap','self','duplicate','inviter_inactive')),
  check ((qualified_at is null) = (outcome is null))
);
create index invite_redemptions_link_idx on private.invite_redemptions(link_id);

-- 3. Granted periods. Business periods belong to the business (merchant_id), personal ones to the member.
create table private.invite_rewards (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  merchant_id uuid references private.merchants(id) on delete cascade,
  kind text not null check (kind in ('general','business')),
  tier text not null check (tier in ('plus','pro')),
  days integer not null check (days between 1 and 14),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  invitee_id uuid not null,
  reason text not null check (reason in ('attended','business_inviter','business_invitee')),
  created_at timestamptz not null default now(),
  unique (invitee_id, reason),
  check ((kind = 'business') = (merchant_id is not null))
);
create index invite_rewards_general_idx on private.invite_rewards(user_id, ends_at) where kind = 'general';
create index invite_rewards_business_idx on private.invite_rewards(merchant_id, ends_at) where kind = 'business';

-- 4. Hashed device/email/phone marks of rewarded invitees. No foreign key: a deleted and re-created
-- account must not earn its inviter a second reward. Only sha256 hashes are kept.
create table private.invite_identity_marks (
  mark text primary key check (mark ~ '^[0-9a-f]{64}$'),
  invitee_id uuid not null,
  created_at timestamptz not null default now()
);

alter table private.invite_links enable row level security;
alter table private.invite_redemptions enable row level security;
alter table private.invite_rewards enable row level security;
alter table private.invite_identity_marks enable row level security;
revoke all on private.invite_links, private.invite_redemptions, private.invite_rewards, private.invite_identity_marks
  from public, anon, authenticated, service_role;
alter table private.invite_links owner to postgres;
alter table private.invite_redemptions owner to postgres;
alter table private.invite_rewards owner to postgres;
alter table private.invite_identity_marks owner to postgres;

-- 5. Membership: the store entitlement keeps its logic under a new name; the reward joins it here,
-- so membership_details, business membership, limits and meetup tools all see the same tier.
alter function private.membership_entitlement(uuid,text) rename to store_membership_entitlement;

create function private.invite_reward_entitlement(p_user_id uuid, p_kind text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('tier', r.tier, 'kind', r.kind, 'store', 'reward', 'plan_version', '2', 'will_renew', false,
    'product_id', 'gling.invite.'||r.kind||'.'||r.tier, 'expires_at', r.ends_at)
  from private.invite_rewards r
  where r.starts_at <= now() and r.ends_at > now()
    and case when p_kind = 'business'
      then r.kind = 'business' and r.merchant_id = (select merchant_id from private.business_membership_bindings where user_id = p_user_id)
      else r.kind = 'general' and r.user_id = p_user_id end
  order by case r.tier when 'pro' then 2 else 1 end desc, r.ends_at desc limit 1;
$$;

-- A paid plan wins when it is at least as high; a higher reward tier shows on top of a lower paid plan.
create function private.membership_entitlement(p_user_id uuid, p_kind text) returns jsonb
language sql stable security definer set search_path='' as $$
  select e from (
    select private.store_membership_entitlement(p_user_id, p_kind) e, 1 paid
    union all select private.invite_reward_entitlement(p_user_id, p_kind), 0
  ) c where e is not null
  order by case e->>'tier' when 'premium' then 3 when 'pro' then 2 else 1 end desc, paid desc limit 1;
$$;

-- 6. Granting. Serialized per beneficiary; returns the days actually added (0 at the cap or on a repeat).
create function private.grant_invite_reward(p_user uuid, p_merchant uuid, p_tier text, p_invitee uuid, p_reason text)
returns integer language plpgsql security definer set search_path='' as $$
declare used integer; granted integer; start_at timestamptz; inserted integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('invite-reward:'||coalesce(p_merchant, p_user)::text, 0));
  select coalesce(sum(days), 0), greatest(now(), coalesce(max(ends_at), now())) into used, start_at
    from private.invite_rewards
    where case when p_merchant is null then kind = 'general' and user_id = p_user else kind = 'business' and merchant_id = p_merchant end;
  granted := least(14, 56 - used);
  if granted <= 0 then return 0; end if;
  insert into private.invite_rewards(user_id, merchant_id, kind, tier, days, starts_at, ends_at, invitee_id, reason)
    values (p_user, p_merchant, case when p_merchant is null then 'general' else 'business' end, p_tier, granted,
      start_at, start_at + make_interval(days => granted), p_invitee, p_reason)
    on conflict (invitee_id, reason) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return 0; end if;
  -- Business membership is read through the owner binding; bind a business that has none yet.
  if p_merchant is not null then
    insert into private.business_membership_bindings(user_id, merchant_id)
      select m.owner_id, m.id from private.merchants m
      where m.id = p_merchant and m.owner_id is not null and m.owner_verified_at is not null
        and not exists (select 1 from private.business_membership_bindings b where b.user_id = m.owner_id or b.merchant_id = m.id)
      on conflict do nothing;
  end if;
  return granted;
end $$;

create function private.invite_marks(p_user uuid) returns text[]
language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(distinct encode(extensions.digest(v, 'sha256'), 'hex')), '{}') from (
    select 'email:'||lower(btrim(u.email)) v from auth.users u where u.id = p_user and coalesce(btrim(u.email), '') <> ''
    union all select 'phone:'||regexp_replace(u.phone, '\D', '', 'g') from auth.users u
      where u.id = p_user and length(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g')) >= 7
    union all select 'device:'||d.device_hash from private.account_security_devices d where d.user_id = p_user
  ) s;
$$;

-- Null when the invitee may count; otherwise the outcome to record.
create function private.invite_identity_problem(p_invitee uuid, p_inviters uuid[]) returns text
language plpgsql stable security definer set search_path='' as $$
declare mine text[] := private.invite_marks(p_invitee); inviter uuid;
begin
  if p_invitee = any(p_inviters) then return 'self'; end if;
  foreach inviter in array p_inviters loop
    if mine && private.invite_marks(inviter) then return 'self'; end if;
  end loop;
  if exists (select 1 from private.invite_identity_marks where mark = any(mine) and invitee_id <> p_invitee) then return 'duplicate'; end if;
  return null;
end $$;

create function private.record_invite_marks(p_invitee uuid) returns void
language sql security definer set search_path='' as $$
  insert into private.invite_identity_marks(mark, invitee_id) select unnest(private.invite_marks(p_invitee)), p_invitee on conflict do nothing;
$$;

-- 7. Personal reward: the invitee's attendance is confirmed by the host (as witness), an admin, or any
-- non-peer source, at a meetup somebody else hosted.
create function private.process_invite_attendance(p_invitee uuid) returns void
language plpgsql security definer set search_path='' as $$
declare red record; host uuid; problem text; tier text; days integer := 0;
begin
  select r.inviter_id, l.merchant_id into red from private.invite_redemptions r join private.invite_links l on l.id = r.link_id
    where r.invitee_id = p_invitee and r.outcome is null for update of r;
  if not found or red.merchant_id is not null then return; end if;
  select s.host_id into host from private.meetup_attendance a join private.meetup_sessions s on s.id = a.session_id
    where a.user_id = p_invitee and a.confirmed_at is not null and s.host_id <> p_invitee
      and (a.confirmation_source <> 'peer' or exists (select 1 from private.meetup_attendance_confirmations c
        where c.session_id = s.id and c.witness_id = s.host_id and c.attendee_id = p_invitee))
    order by (s.host_id = red.inviter_id) desc limit 1;
  if host is null then return; end if;
  problem := case when not private.is_active_account(red.inviter_id) then 'inviter_inactive'
    else private.invite_identity_problem(p_invitee, array[red.inviter_id]) end;
  if problem is null then
    tier := case when host = red.inviter_id
      or exists (select 1 from private.meetup_sessions where host_id = red.inviter_id)
      or exists (select 1 from public.posts where author_id = red.inviter_id and room_preview is not null and status = 'published')
      then 'pro' else 'plus' end;
    days := private.grant_invite_reward(red.inviter_id, null, tier, p_invitee, 'attended');
    perform private.record_invite_marks(p_invitee);
  end if;
  update private.invite_redemptions set qualified_at = now(), outcome = coalesce(problem, case when days > 0 then 'rewarded' else 'cap' end)
    where invitee_id = p_invitee;
end $$;

-- Every confirmation path (peer, admin, a future host button) updates confirmed_at; a reward problem never
-- blocks the attendance record itself.
create function private.invite_attendance_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.confirmed_at is not null and exists (select 1 from private.invite_redemptions where invitee_id = new.user_id and outcome is null) then
    begin perform private.process_invite_attendance(new.user_id);
    exception when others then raise warning 'invite reward skipped: %', sqlerrm; end;
  end if;
  return new;
end $$;
create trigger meetup_attendance_invite_reward after insert or update of confirmed_at on private.meetup_attendance
  for each row execute function private.invite_attendance_trigger();

-- 8. Business reward: the invited business's first post of its own (admin-written posts don't count).
create function private.process_invite_business_post(p_merchant uuid) returns void
language plpgsql security definer set search_path='' as $$
declare owner uuid; red record; inviter_owner uuid; problem text; a integer := 0; b integer := 0;
begin
  select owner_id into owner from private.merchants where id = p_merchant;
  if owner is null then return; end if;
  select r.inviter_id, l.merchant_id into red from private.invite_redemptions r join private.invite_links l on l.id = r.link_id
    where r.invitee_id = owner and r.outcome is null and l.merchant_id is not null and l.merchant_id <> p_merchant for update of r;
  if not found then return; end if;
  if (select count(*) from private.merchant_membership_usage where merchant_id = p_merchant and action = 'post' and not managed) <> 1 then return; end if;
  select owner_id into inviter_owner from private.merchants where id = red.merchant_id and deleted_at is null;
  problem := case when inviter_owner is null or not private.is_active_account(inviter_owner) then 'inviter_inactive'
    else private.invite_identity_problem(owner, array[red.inviter_id, inviter_owner]) end;
  if problem is null then
    a := private.grant_invite_reward(inviter_owner, red.merchant_id, 'plus', owner, 'business_inviter');
    b := private.grant_invite_reward(owner, p_merchant, 'plus', owner, 'business_invitee');
    perform private.record_invite_marks(owner);
  end if;
  update private.invite_redemptions set qualified_at = now(), outcome = coalesce(problem, case when a + b > 0 then 'rewarded' else 'cap' end)
    where invitee_id = owner;
end $$;

create function private.invite_business_post_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.action = 'post' and not new.managed then
    begin perform private.process_invite_business_post(new.merchant_id);
    exception when others then raise warning 'invite reward skipped: %', sqlerrm; end;
  end if;
  return new;
end $$;
create trigger merchant_usage_invite_reward after insert on private.merchant_membership_usage
  for each row execute function private.invite_business_post_trigger();

-- 9. Member RPCs. Nobody sees another member's code list, contacts or invitees; only counts.
create function private.invite_code() returns text
language sql volatile set search_path='' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '')
  from (select extensions.gen_random_bytes(8) b) r, generate_series(0, 7) i;
$$;

create function public.create_invite_link(p_merchant_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid(); found_code text; attempt integer;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_merchant_id is not null then perform private.assert_merchant_content_access(p_merchant_id, false, true); end if;
  select code into found_code from private.invite_links
    where case when p_merchant_id is null then owner_id = u and merchant_id is null else merchant_id = p_merchant_id end;
  if found_code is not null then return jsonb_build_object('code', found_code); end if;
  perform private.enforce_rate_limit('invite_link', 10, interval '1 day');
  for attempt in 1..5 loop
    begin
      insert into private.invite_links(code, owner_id, merchant_id) values (private.invite_code(), u, p_merchant_id) returning code into found_code;
      return jsonb_build_object('code', found_code);
    exception when unique_violation then
      select code into found_code from private.invite_links
        where case when p_merchant_id is null then owner_id = u and merchant_id is null else merchant_id = p_merchant_id end;
      if found_code is not null then return jsonb_build_object('code', found_code); end if;
    end;
  end loop;
  raise exception 'INVITE_CODE_UNAVAILABLE';
end $$;

-- A new member links one invite within 7 days of joining, before any confirmed attendance.
create function public.claim_invite_code(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid(); link private.invite_links; joined timestamptz;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.enforce_rate_limit('invite_claim', 10, interval '1 day');
  select * into link from private.invite_links where code = upper(btrim(coalesce(p_code, '')));
  if link.id is null or not private.is_active_account(link.owner_id) then raise exception 'INVITE_NOT_FOUND'; end if;
  if exists (select 1 from private.invite_redemptions where invitee_id = u) then raise exception 'INVITE_ALREADY_LINKED'; end if;
  if link.owner_id = u or (link.merchant_id is not null and exists (select 1 from private.merchants m where m.id = link.merchant_id
    and (m.owner_id = u or exists (select 1 from private.merchant_operators o where o.merchant_id = m.id and o.user_id = u))))
    then raise exception 'INVITE_SELF'; end if;
  select created_at into joined from public.profiles where id = u;
  if joined < now() - interval '7 days'
    or exists (select 1 from private.meetup_attendance where user_id = u and confirmed_at is not null)
    or exists (select 1 from private.merchant_membership_usage g join private.merchants m on m.id = g.merchant_id
      where m.owner_id = u and g.action = 'post' and not g.managed)
    then raise exception 'INVITE_TOO_LATE'; end if;
  insert into private.invite_redemptions(invitee_id, link_id, inviter_id) values (u, link.id, link.owner_id);
  return jsonb_build_object('linked', true, 'business', link.merchant_id is not null);
end $$;

create function private.invite_summary(p_link uuid, p_rewards jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'joined', (select count(*) from private.invite_redemptions where link_id = p_link),
    'rewarded', (select count(*) from private.invite_redemptions where link_id = p_link and outcome = 'rewarded'),
    'waiting', (select count(*) from private.invite_redemptions where link_id = p_link and outcome is null),
    'rewards', coalesce(p_rewards, '[]'::jsonb), 'capDays', 56,
    'grantedDays', coalesce((select sum((r->>'days')::int) from jsonb_array_elements(p_rewards) r), 0),
    'activeUntil', (select max((r->>'endsAt')::timestamptz) from jsonb_array_elements(p_rewards) r where (r->>'endsAt')::timestamptz > now()));
$$;

create function public.get_my_invite() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid := auth.uid(); link private.invite_links; rewards jsonb; joined timestamptz;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select * into link from private.invite_links where owner_id = u and merchant_id is null;
  select jsonb_agg(jsonb_build_object('tier', tier, 'days', days, 'startsAt', starts_at, 'endsAt', ends_at) order by starts_at)
    into rewards from private.invite_rewards where user_id = u and kind = 'general';
  select created_at into joined from public.profiles where id = u;
  return private.invite_summary(link.id, rewards) || jsonb_build_object('code', link.code,
    'linked', exists (select 1 from private.invite_redemptions where invitee_id = u),
    'canEnterCode', joined >= now() - interval '7 days' and not exists (select 1 from private.invite_redemptions where invitee_id = u)
      and not exists (select 1 from private.meetup_attendance where user_id = u and confirmed_at is not null));
end $$;

create function public.get_business_invite(p_merchant_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare link private.invite_links; rewards jsonb;
begin
  perform private.assert_merchant_content_access(p_merchant_id);
  select * into link from private.invite_links where merchant_id = p_merchant_id;
  select jsonb_agg(jsonb_build_object('tier', tier, 'days', days, 'startsAt', starts_at, 'endsAt', ends_at) order by starts_at)
    into rewards from private.invite_rewards where merchant_id = p_merchant_id;
  return private.invite_summary(link.id, rewards) || jsonb_build_object('code', link.code);
end $$;

-- 10. Admin: per-link sign-ups, confirmed first meetups and first business posts.
create function public.get_admin_invite_links() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  return coalesce((select jsonb_agg(row order by (row->>'joined')::int desc, row->>'createdAt' desc) from (
    select jsonb_build_object('code', l.code, 'createdAt', l.created_at, 'ownerNickname', p.nickname, 'businessName', m.name,
      'joined', count(r.invitee_id),
      'attended', count(r.invitee_id) filter (where exists (select 1 from private.meetup_attendance a where a.user_id = r.invitee_id and a.confirmed_at is not null)),
      'businessPosted', count(r.invitee_id) filter (where exists (select 1 from private.merchant_membership_usage g join private.merchants o on o.id = g.merchant_id
        where o.owner_id = r.invitee_id and g.action = 'post' and not g.managed)),
      'rewarded', count(r.invitee_id) filter (where r.outcome = 'rewarded'),
      'notCounted', count(r.invitee_id) filter (where r.outcome in ('self','duplicate','inviter_inactive','cap'))) row
    from private.invite_links l join public.profiles p on p.id = l.owner_id left join private.merchants m on m.id = l.merchant_id
    left join private.invite_redemptions r on r.link_id = l.id
    group by l.id, p.nickname, m.name order by count(r.invitee_id) desc, l.created_at desc limit 300) s), '[]'::jsonb);
end $$;

do $$ declare signature text; begin
  foreach signature in array array[
    'private.store_membership_entitlement(uuid,text)', 'private.invite_reward_entitlement(uuid,text)', 'private.membership_entitlement(uuid,text)',
    'private.grant_invite_reward(uuid,uuid,text,uuid,text)', 'private.invite_marks(uuid)', 'private.invite_identity_problem(uuid,uuid[])',
    'private.record_invite_marks(uuid)', 'private.process_invite_attendance(uuid)', 'private.invite_attendance_trigger()',
    'private.process_invite_business_post(uuid)', 'private.invite_business_post_trigger()', 'private.invite_code()',
    'private.invite_summary(uuid,jsonb)', 'public.create_invite_link(uuid)', 'public.claim_invite_code(text)',
    'public.get_my_invite()', 'public.get_business_invite(uuid)', 'public.get_admin_invite_links()'
  ] loop
    execute 'alter function '||signature||' owner to postgres';
    execute 'revoke all on function '||signature||' from public, anon, authenticated, service_role';
  end loop;
end $$;
grant execute on function public.create_invite_link(uuid), public.claim_invite_code(text), public.get_my_invite(),
  public.get_business_invite(uuid), public.get_admin_invite_links() to authenticated;

insert into private.behavior_targets(id) values
 ('profile.invite'),('invite.scroll'),('invite.create'),('invite.share'),('invite.code.submit'),('invite.open_app'),
 ('business.invite.create'),('business.invite.share')
on conflict do nothing;

notify pgrst, 'reload schema';
