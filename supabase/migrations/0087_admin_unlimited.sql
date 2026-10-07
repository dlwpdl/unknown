-- 0087 (0084 collided with the admin_trust_level migration): the admin account is not limited anywhere in the app.
-- Posts, listings, 1:1 conversations, messages and meetup capacity all skip the quota checks.
-- Admin identity is the JWT app_metadata role. A session cannot read another user's claim, so the first
-- admin action records the account here and participant-side checks can skip that account too.
-- Content moderation, account status, blocking and reports stay in force for admins.
create table if not exists private.admin_ids (
  user_id uuid primary key references public.profiles(id) on delete cascade
);
revoke all on private.admin_ids from public, anon, authenticated, service_role;

create or replace function private.is_admin_id(p_user_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null then return false; end if;
  if auth.uid() = p_user_id and private.is_admin() then
    insert into private.admin_ids(user_id) values (p_user_id) on conflict (user_id) do nothing;
    return true;
  end if;
  return exists (select 1 from private.admin_ids where user_id = p_user_id);
end;
$$;
revoke all on function private.is_admin_id(uuid) from public, anon, authenticated, service_role;

do $$
declare definition text; anchor text;
begin
  -- Pacing: messages, comments, reports, share, conversation and meetup requests, reviews, AI draft sync.
  definition := pg_get_functiondef('private.enforce_rate_limit(text,integer,interval,interval)'::regprocedure);
  anchor := 'perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || '':'' || p_action, 0));';
  if strpos(definition, anchor) = 0 then raise exception 'rate limit anchor missing'; end if;
  definition := replace(definition, anchor,
    'if private.is_admin_id(current_user_id) then return; end if;' || chr(10) || '  ' || anchor);
  execute definition;

  -- Meetup capacity, including a host approving an admin applicant.
  definition := pg_get_functiondef('private.check_meetup_slot(uuid,text)'::regprocedure);
  anchor := 'if private.membership_meetup_count(p_user_id)>=(private.membership_details(p_user_id)->>''meetupLimit'')::integer then';
  if strpos(definition, anchor) = 0 then raise exception 'meetup slot anchor missing'; end if;
  execute replace(definition, anchor, 'if not private.is_admin_id(p_user_id) and ' || substr(anchor, 4));

  -- Daily story quota and live listing allowance, both owned and reopened.
  definition := pg_get_functiondef('public.create_post(text,smallint,text,text,text[],text[],jsonb,text,numeric)'::regprocedure);
  anchor := 'if private.active_listing_count(current_user_id) >= private.listing_limit(current_user_id) then';
  if strpos(definition, anchor) = 0 then raise exception 'listing limit anchor missing'; end if;
  definition := replace(definition, anchor, 'if not private.is_admin_id(current_user_id) and ' || substr(anchor, 4));
  anchor := 'if used_count >= daily_limit then raise exception ''DAILY_POST_LIMIT_REACHED''; end if;';
  if strpos(definition, anchor) = 0 then raise exception 'post quota anchor missing'; end if;
  execute replace(definition, anchor,
    'if not private.is_admin_id(current_user_id) and used_count >= daily_limit then raise exception ''DAILY_POST_LIMIT_REACHED''; end if;');

  definition := pg_get_functiondef('public.bump_post(uuid)'::regprocedure);
  anchor := 'if next_at > now() then raise exception ''BUMP_COOLDOWN''; end if;';
  if strpos(definition, anchor) = 0 then raise exception 'bump cooldown anchor missing'; end if;
  execute replace(definition, anchor,
    'if not private.is_admin_id(u) and next_at > now() then raise exception ''BUMP_COOLDOWN''; end if;');

  definition := pg_get_functiondef('public.set_listing_status(uuid,text)'::regprocedure);
  anchor := 'if private.active_listing_count(u, p.id) >= private.listing_limit(u) then raise exception ''LISTING_LIMIT_REACHED''; end if;';
  if strpos(definition, anchor) = 0 then raise exception 'reopen limit anchor missing'; end if;
  execute replace(definition, anchor,
    'if not private.is_admin_id(u) and private.active_listing_count(u, p.id) >= private.listing_limit(u) then raise exception ''LISTING_LIMIT_REACHED''; end if;');

  -- 1:1 requests: same-pair cooldown and the pending request ceiling.
  definition := pg_get_functiondef((select p.oid from pg_proc p
    where p.proname = 'start_conversation' and p.pronamespace = 'public'::regnamespace and p.pronargs = 2));
  anchor := 'if exists(select 1 from public.conversations where kind=''direct'' and user_low_id=low_id and user_high_id=high_id';
  if strpos(definition, anchor) = 0 then raise exception 'request cooldown anchor missing'; end if;
  definition := replace(definition, anchor, 'if not private.is_admin_id(u) and exists(select 1 from public.conversations where kind=''direct'' and user_low_id=low_id and user_high_id=high_id');
  anchor := 'if (select count(*) from public.conversations where requester_id=u and status=''pending'' and created_at>now()-interval ''7 days'')>=20 then';
  if strpos(definition, anchor) = 0 then raise exception 'pending ceiling anchor missing'; end if;
  execute replace(definition, anchor,
    'if not private.is_admin_id(u) and (select count(*) from public.conversations where requester_id=u and status=''pending'' and created_at>now()-interval ''7 days'')>=20 then');

  -- 1:1 acceptance checks both sides, so the admin account is skipped on either side.
  definition := pg_get_functiondef('public.respond_direct_conversation(uuid,text)'::regprocedure);
  anchor := 'if private.direct_slot_count(participant)+private.relationship_locked_count(participant,''direct'') >=';
  if strpos(definition, anchor) = 0 then raise exception 'direct capacity anchor missing'; end if;
  execute replace(definition, anchor,
    'if not private.is_admin_id(participant) and private.direct_slot_count(participant)+private.relationship_locked_count(participant,''direct'') >=');

  -- AI draft allowance.
  definition := pg_get_functiondef('public.reserve_ai_draft()'::regprocedure);
  anchor := 'select city.timezone into profile_timezone';
  if strpos(definition, anchor) = 0 then raise exception 'ai draft anchor missing'; end if;
  execute replace(definition, anchor,
    'if private.is_admin_id(current_user_id) then return 1; end if;' || chr(10) || '  ' || anchor);
end;
$$;
