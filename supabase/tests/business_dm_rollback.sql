-- STOP rollback, reviewed separately from application. No history/schema/data deletion.
-- Apply only if 041 was installed; retain all raw safety/admin policies and evidence.
begin;
revoke execute on function
  public.start_business_conversation(uuid,uuid,uuid,uuid),
  public.get_identity_conversation_inbox(uuid,text,integer,text,timestamptz,uuid,uuid),
  public.get_business_chat_messages(uuid,uuid,integer,timestamptz,uuid,uuid[]),
  public.send_business_chat_message(uuid,uuid,uuid,text,text,text[],numeric,numeric,uuid,text),
  public.edit_business_chat_message(uuid,uuid,text,timestamptz),
  public.delete_business_chat_message(uuid,uuid,timestamptz),
  public.mark_business_chat_read(uuid,uuid,uuid),public.set_business_chat_reaction(uuid,uuid,boolean),
  public.report_business_chat_message(uuid,uuid,text,text),
  public.end_business_conversation(uuid,uuid),public.block_business_conversation(uuid,uuid)
from authenticated;
create policy "business chat rollback media hold" on storage.objects as restrictive for all to anon,authenticated
  using(bucket_id<>'chat-images' or not private.is_business_chat(private.business_chat_path_conversation(name)))
  with check(bucket_id<>'chat-images' or not private.is_business_chat(private.business_chat_path_conversation(name)));
do $$ declare definition text; anchor text; begin
  definition:=pg_get_functiondef('public.get_merchant_profile(uuid)'::regprocedure);
  anchor:=$anchor$'can_business_message',auth.uid() is not null and private.business_chat_can_use(auth.uid(),null)
      and private.business_chat_business_ready(m.id)
      and not private.is_blocked_between(auth.uid(),m.owner_id) and not private.has_reported(auth.uid(),'user',m.owner_id)$anchor$;
  if position(anchor in definition)=0 then raise exception 'BUSINESS_CHAT_STOP_PROFILE_ANCHOR'; end if;
  execute replace(definition,anchor,'''can_business_message'',false');
end $$;
notify pgrst,'reload schema';
commit;
