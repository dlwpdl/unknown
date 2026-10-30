-- Owner 2026-10-30 "하루에 한번 인증하자 2차인증. 안한사람은 무조건 한번은 해야겟지": the operator's direct database path
-- (session user postgres, 20261030140000) counts as admin only if that admin completed a TOTP second factor in the last 24 hours.
do $migration$
declare
  definition text := pg_get_functiondef('private.is_admin()'::regprocedure);
  anchor text := 'session_user=''postgres'' and exists(';
begin
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'is_admin direct-db branch changed; review before adding the daily MFA check';
  end if;
  execute replace(definition, anchor, anchor || 'select 1 from auth.mfa_amr_claims c join auth.sessions s on s.id=c.session_id
        where s.user_id=auth.uid() and c.authentication_method=''totp''
          and greatest(c.created_at, c.updated_at) > now() - interval ''24 hours'') and exists(');
end $migration$;
