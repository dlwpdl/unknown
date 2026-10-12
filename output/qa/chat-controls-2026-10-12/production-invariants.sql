-- Catalog assertions only; safe while chat writes are frozen or enabled.
do $$ declare signature text; role_name text; evidence_table_name text;
begin
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='messages'
      and column_name in ('reply_to_id','location_label','edited_at','deleted_at'))<>4
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='safety_review_queue'
      and column_name='risk_signal_at' and data_type='timestamp with time zone') then raise exception 'CHAT_COLUMNS_MISSING'; end if;
  if to_regprocedure('public.get_message_safety_content(uuid)') is not null then raise exception 'OLD_SAFETY_SIGNATURE_REMAINS'; end if;
  foreach signature in array array['public.get_message_safety_content(uuid,bigint,text,timestamptz)',
    'public.claim_safety_reviews_v2(integer)',
    'public.complete_message_safety_review(bigint,text,timestamptz,bigint,integer,numeric,text,jsonb,text)'] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
      or not has_function_privilege('service_role',signature,'execute') then raise exception 'SAFETY_RPC_ACL_CHANGED: %',signature; end if;
  end loop;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach evidence_table_name in array array['private.message_history','private.message_safety_progress'] loop
      if has_table_privilege(role_name,evidence_table_name,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'PRIVATE_EVIDENCE_ACL_CHANGED: %, %',role_name,evidence_table_name; end if;
    end loop;
  end loop;
  foreach signature in array array['private.can_read_retained_chat_image(text,text)','private.can_remove_unsent_chat_image(text)'] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('service_role',signature,'execute')
      or not has_function_privilege('authenticated',signature,'execute') then raise exception 'STORAGE_GUARD_ACL_CHANGED: %',signature; end if;
  end loop;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='admins read retained chat photos'
      and cmd='SELECT' and roles=array['authenticated']::name[] and qual like '%can_read_retained_chat_image(bucket_id, name)%')
    or not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='owners remove unsent chat photos'
      and cmd='DELETE' and roles=array['authenticated']::name[] and qual like '%can_remove_unsent_chat_image(name)%'
      and qual like '%chat-images%' and qual like '%owner_id%') then raise exception 'STORAGE_EVIDENCE_POLICY_CHANGED'; end if;
  if has_table_privilege('authenticated','public.messages','UPDATE,DELETE')
    or md5(pg_get_functiondef('public.get_admin_conversation(uuid,timestamptz,uuid,uuid)'::regprocedure))<>'b293cad6d08f8eebcdfe7473a252fbcf'
    or md5(pg_get_functiondef('private.is_admin()'::regprocedure))<>'38ab4a1efe686cb19002563ef6b4293a'
    or has_table_privilege('authenticated','public.admin_conversation_reviews','select') then raise exception 'ADMIN_BOUNDARY_CHANGED'; end if;
  if position('coalesce(q.risk_signal_at,q.reviewed_at,q.created_at)' in pg_get_functiondef('private.admin_conversation_signals(uuid)'::regprocedure))=0
    then raise exception 'STABLE_RISK_SIGNAL_MISSING'; end if;
end $$;
