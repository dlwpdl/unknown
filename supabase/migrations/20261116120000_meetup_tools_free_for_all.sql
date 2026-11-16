-- Every meetup host tool is free for every member tier (owner 2026-11-16). Only numeric caps stay tiered:
-- seats, meetup slots, co-hosts (free now gets 1), listings, bump hours, business limits.
-- The gate helpers are redefined once so every caller, including published clients, passes for all tiers.

create or replace function private.require_meetup_tool_tier(p_user_id uuid,p_minimum text) returns void
language plpgsql security definer set search_path='' as $$
begin
  return;
end;
$$;

-- Used only as a tool gate (auto-approve, waitlist promotion, RSVP counts, no-show rule, title drafts).
create or replace function private.meetup_tier_rank(p_user uuid) returns integer
language sql stable security definer set search_path='' as $$
  select 3;
$$;

create or replace function private.host_tier_at_least(p_user_id uuid,p_minimum text) returns boolean
language sql stable security definer set search_path='' as $$
  select true;
$$;

-- Co-host cap: free 0 -> 1; plus 1, pro 3, premium 5 unchanged.
create or replace function private.meetup_cohost_limit(p_user_id uuid) returns integer
language sql stable security definer set search_path='' as $$
  select case when not private.is_active_account(p_user_id) then 0
    else case private.meetup_tool_tier(p_user_id) when 'admin' then 1000 when 'premium' then 5 when 'pro' then 3 else 1 end end;
$$;

-- The participant join cap exempts only real paid tiers, so it reads the real tier instead of the tool rank.
create or replace function private.guard_meetup_free_join_cap() returns trigger
language plpgsql security definer set search_path='' as $$
declare cap private.meetup_join_cap;
begin
  if new.status not in ('pending','approved') or (tg_op='UPDATE' and old.status=new.status) then return new; end if;
  select * into cap from private.meetup_join_cap where id;
  if not coalesce(cap.enabled,false) or coalesce(private.meetup_tool_tier(new.requester_id),'free')<>'free' then return new; end if;
  if (select count(*) from public.meetup_requests r join public.posts p on p.id=r.post_id
      where r.requester_id=new.requester_id and r.status='approved' and r.post_id<>new.post_id
        and private.meetup_is_open(p.status,p.room_preview))>=cap.free_limit then
    raise exception '%',case when new.status='approved' then 'REQUESTER_MEETUP_LIMIT_REACHED' else 'MEETUP_LIMIT_REACHED' end;
  end if;
  return new;
end $$;

-- Two read functions compare the real tier directly; flip those flags for everyone.
do $$
declare d text;
begin
  d:=pg_get_functiondef('public.get_meetup_templates()'::regprocedure);
  if strpos(d,'''canUse'',private.meetup_tool_tier(u)<>''free''')=0 then raise exception 'templates anchor missing'; end if;
  execute replace(d,'''canUse'',private.meetup_tool_tier(u)<>''free''','''canUse'',true');

  d:=pg_get_functiondef('public.get_meetup_host_tools(uuid)'::regprocedure);
  if strpos(d,'pro:=private.meetup_tool_tier(event.author_id) in(''pro'',''premium'',''admin'');')=0 then raise exception 'host tools anchor missing'; end if;
  execute replace(d,'pro:=private.meetup_tool_tier(event.author_id) in(''pro'',''premium'',''admin'');','pro:=true;');
end;
$$;
