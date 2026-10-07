-- Owner decision (2026-09-22): admin accounts are not throttled by the meetup anti-abuse rules.
-- Removal/closure activity is still recorded, and paid membership slot limits still apply to admins.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('private.assert_meetup_hosting(uuid,boolean)'::regprocedure);
  if strpos(definition, 'if policy->>''hostBlockedUntil'' is not null then') = 0 then raise exception 'hosting guard anchor missing'; end if;
  definition := replace(definition, 'if policy->>''hostBlockedUntil'' is not null then',
    'if private.is_admin() then return; end if;' || chr(10) || '  if policy->>''hostBlockedUntil'' is not null then');
  execute definition;

  definition := pg_get_functiondef('private.assert_meetup_participation(uuid)'::regprocedure);
  if strpos(definition, 'release_at:=private.meetup_policy(p_user_id)->>''joinBlockedUntil'';') = 0 then raise exception 'participation guard anchor missing'; end if;
  definition := replace(definition, 'release_at:=private.meetup_policy(p_user_id)->>''joinBlockedUntil'';',
    'if private.is_admin() then return; end if;' || chr(10) || '  release_at:=private.meetup_policy(p_user_id)->>''joinBlockedUntil'';');
  execute definition;

  definition := pg_get_functiondef('private.request_meetup_join(uuid,text)'::regprocedure);
  if strpos(definition, 'perform private.enforce_rate_limit(''meetup_request'', 5, interval ''1 day'', interval ''60 seconds'');') = 0 then
    raise exception 'request pacing anchor missing'; end if;
  definition := replace(definition, 'perform private.enforce_rate_limit(''meetup_request'', 5, interval ''1 day'', interval ''60 seconds'');',
    'if not private.is_admin() then perform private.enforce_rate_limit(''meetup_request'', 5, interval ''1 day'', interval ''60 seconds''); end if;');
  execute definition;
end;
$$;
revoke all on function private.assert_meetup_hosting(uuid,boolean),private.assert_meetup_participation(uuid)
  from public, anon, authenticated, service_role;
