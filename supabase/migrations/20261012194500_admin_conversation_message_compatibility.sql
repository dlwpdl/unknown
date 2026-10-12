-- Reply metadata is optional; the production messages table does not have this column.
do $compatibility$
declare
  definition text;
  original text := '''reply_to_id'',m.reply_to_id';
  compatible text := '''reply_to_id'',to_jsonb(m)->''reply_to_id''';
begin
  select pg_get_functiondef('public.get_admin_conversation(uuid,timestamptz,uuid,uuid)'::regprocedure)
    into definition;
  if (length(definition)-length(replace(definition,original,'')))/length(original) <> 1 then
    raise exception 'CONVERSATION_MESSAGE_PROJECTION_CHANGED';
  end if;
  execute replace(definition,original,compatible);
end;
$compatibility$;
notify pgrst,'reload schema';

-- Rollback keeps the compatible read path and all review history; no raw data was changed.
