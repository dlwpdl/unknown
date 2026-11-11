-- One target missing from private.behavior_targets rejected the whole batch (INVALID_BEHAVIOR), and the app retries
-- that same batch, so a single unregistered control stopped a session's analytics. 1.5.1 already ships such ids
-- (chat bubbles, template ids), so the server now stores that event under the fixed target 'unregistered' instead.
-- The text the client sent is never stored, and every other check still rejects the batch: fields, seq/value ranges,
-- screen and kind lists, view/dwell = 'screen', the success list, 25 events, 16000 bytes and the rate limits.
-- Count them with: select screen, kind, count(*) from private.behavior_events where target='unregistered' group by 1,2;
-- company.post and merchant.reply.edit replace row-id targets in the app from 1.5.2; 1.5.1 rows land as 'unregistered'.
insert into private.behavior_targets(id) values
  ('unregistered'),
  ('company.post'),
  ('merchant.reply.edit')
on conflict do nothing;

do $$
declare
  definition text:=pg_get_functiondef('public.record_behavior_events(text,text,jsonb)'::regprocedure);
  anchor text:='or not exists(select 1 from private.behavior_targets where id=e->>''target'') then raise exception ''INVALID_BEHAVIOR''; end if;';
begin
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'BEHAVIOR_TARGET_CHECK_CHANGED';
  end if;
  execute replace(definition,anchor,'then raise exception ''INVALID_BEHAVIOR''; end if;
    if not exists(select 1 from private.behavior_targets where id=e->>''target'') then e:=jsonb_set(e,''{target}'',''"unregistered"''); end if;');
end;
$$;
notify pgrst,'reload schema';
