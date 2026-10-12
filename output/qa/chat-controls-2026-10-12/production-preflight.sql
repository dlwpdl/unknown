-- Before apply: catalog/migration metadata only; new RPCs may not exist yet.
select jsonb_build_object(
  'columns', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='messages'),
  'historyTable', to_regclass('private.message_history'),
  'progressTable', to_regclass('private.message_safety_progress'),
  'riskSignalColumn', (select data_type from information_schema.columns where table_schema='public' and table_name='safety_review_queue' and column_name='risk_signal_at'),
  'migrations', (select jsonb_agg(jsonb_build_object('version',version,'name',name,'statementsMd5',md5(statements::text)) order by version) from supabase_migrations.schema_migrations where version in ('20261012113000','20261012183500','20261012194500','20261012210000')),
  'functions', (select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),'acl',p.proacl) order by p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
    (n.nspname='public' and p.proname in ('get_admin_conversation','send_chat_attachment','get_message_safety_content','get_message_safety_context','get_trust_safety_content','claim_safety_reviews','claim_safety_reviews_v2','complete_safety_review','complete_message_safety_review','raise_safety_alert'))
    or (n.nspname='private' and p.proname in ('is_admin','enqueue_safety_review','scan_watch_terms','admin_conversation_signals'))),
  'storagePolicies', (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='storage' and tablename='objects'),
  'triggers', (select jsonb_agg(pg_get_triggerdef(oid)) from pg_trigger where tgrelid='public.messages'::regclass and not tgisinternal),
  'messagePrivileges', (select jsonb_agg(to_jsonb(g)) from information_schema.role_table_grants g where table_schema='public' and table_name='messages'),
  'participantReviewRead',has_table_privilege('authenticated','public.admin_conversation_reviews','select')
);
