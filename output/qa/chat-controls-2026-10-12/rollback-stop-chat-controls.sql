-- Freeze the three new writes before reverting web source. Retain evidence,
-- progress, risk signals, Storage guards and the new worker; do not restore the truncating worker.
begin;
revoke execute on function public.send_message_v2(uuid,text,text,text,numeric,numeric,uuid,text),
  public.edit_chat_message(uuid,text,timestamptz),
  public.delete_chat_message(uuid,timestamptz) from authenticated;
notify pgrst, 'reload schema';
commit;
