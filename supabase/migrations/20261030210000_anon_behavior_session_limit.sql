-- Security audit 2026-10-30: every anonymous caller shared one 6,000 events/minute budget, so a single script could
-- fill it and starve or pollute web install metrics. Each anonymous session now gets 200/minute of its own,
-- checked under the same lock, and the 6,000/minute ceiling for all anonymous traffic stays.
-- shortcut: session ids are client-made, so a script rotating them still meets only the global ceiling; add
-- per-IP throttling at the edge if that shows up in the anonymous event counts.
do $$
declare
  definition text:=pg_get_functiondef('public.record_behavior_events(text,text,jsonb)'::regprocedure);
  anchor text:='if (select count(*) from private.behavior_events where user_id is null and created_at>now()-interval ''1 minute'')+n>6000 then';
begin
  if strpos(definition,'perform pg_advisory_xact_lock(7373001);')=0
    or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'BEHAVIOR_ANON_LIMIT_CHANGED';
  end if;
  execute replace(definition,anchor,
    'if (select count(*) from private.behavior_events where session_id=p_session and user_id is null and created_at>now()-interval ''1 minute'')+n>200
      or (select count(*) from private.behavior_events where user_id is null and created_at>now()-interval ''1 minute'')+n>6000 then');
end;
$$;
