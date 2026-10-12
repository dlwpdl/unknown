-- Metadata only: no message/history/photo reads, queue claims or mutating RPC calls.
select jsonb_build_object(
  'columns', (select jsonb_agg(column_name order by column_name) from information_schema.columns where table_schema='public' and table_name='messages' and column_name in ('reply_to_id','location_label','edited_at','deleted_at')),
  'historyTable', to_regclass('private.message_history'),
  'progressTable', to_regclass('private.message_safety_progress'),
  'progressColumns', (select jsonb_agg(jsonb_build_object('name',column_name,'type',data_type) order by ordinal_position) from information_schema.columns where table_schema='private' and table_name='message_safety_progress'),
  'riskSignalColumn', (select data_type from information_schema.columns where table_schema='public' and table_name='safety_review_queue' and column_name='risk_signal_at'),
  'oldSafetySignature', to_regprocedure('public.get_message_safety_content(uuid)'),
  'safetyAcl', (select jsonb_agg(jsonb_build_object('role',r,'signature',s,'execute',has_function_privilege(r,s,'execute')) order by r,s)
    from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[
      'public.get_message_safety_content(uuid,bigint,text,timestamptz)','public.claim_safety_reviews_v2(integer)',
      'public.complete_message_safety_review(bigint,text,timestamptz,bigint,integer,numeric,text,jsonb,text)',
      'private.can_read_retained_chat_image(text,text)','private.can_remove_unsent_chat_image(text)']) s),
  'privateTableAcl', (select jsonb_agg(jsonb_build_object('role',r,'table',t,'privilege',p,'allowed',has_table_privilege(r,t,p)) order by r,t,p)
    from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['private.message_history','private.message_safety_progress']) t
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p),
  'functions', (select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),'acl',p.proacl) order by p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
    (n.nspname='public' and p.proname in ('send_message_v2','edit_chat_message','delete_chat_message','get_admin_message_history','get_message_safety_content','get_message_safety_context','get_trust_safety_content','claim_safety_reviews_v2','complete_message_safety_review','raise_safety_alert','send_chat_attachment','get_admin_conversation'))
    or (n.nspname='private' and p.proname in ('message_safety_content','enqueue_safety_review','admin_conversation_signals','can_read_retained_chat_image','can_remove_unsent_chat_image','is_admin'))),
  'storagePolicies', (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='storage' and tablename='objects'),
  'evidenceIndexes', (select jsonb_agg(to_jsonb(i) order by indexname) from pg_indexes i where indexname in ('messages_image_path_idx','message_history_image_path_idx')),
  'evidenceConstraints', (select jsonb_agg(pg_get_constraintdef(oid)) from pg_constraint where conrelid='private.message_history'::regclass),
  'migrations', (select jsonb_agg(jsonb_build_object('version',version,'name',name,'statementsMd5',md5(statements::text)) order by version) from supabase_migrations.schema_migrations where version in ('20261012113000','20261012183500','20261012194500','20261012210000')),
  'triggers', (select jsonb_agg(pg_get_triggerdef(oid)) from pg_trigger where tgrelid='public.messages'::regclass and not tgisinternal)
);
