-- Public web install CTAs and the FAQ/Gling Visited pages report through the shared behavior batch.
insert into private.behavior_targets(id) values
('web.store.ios'),('web.store.android'),('web.store.ios.open'),('web.store.android.open'),
('web.install.ios'),('web.install.android'),('web.install.desktop'),('web.install.close')
on conflict do nothing;

-- Messenger, portal and share links can be tagged as their own entry channels.
alter table private.behavior_events drop constraint behavior_events_source_check;
alter table private.behavior_events add constraint behavior_events_source_check
  check(source in ('unknown','direct','instagram','threads','search','facebook','website','kakao','naver','share'));

do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.record_behavior_events(text,text,jsonb,text)'::regprocedure);
  if strpos(definition,'''facebook'',''website'')')=0 then raise exception 'BEHAVIOR_SOURCE_CHECK_CHANGED'; end if;
  execute replace(definition,'''facebook'',''website'')','''facebook'',''website'',''kakao'',''naver'',''share'')');
  definition:=pg_get_functiondef('public.record_behavior_events(text,text,jsonb)'::regprocedure);
  if strpos(definition,'''events'',''event-detail''')=0 then raise exception 'BEHAVIOR_SCREEN_CHECK_CHANGED'; end if;
  execute replace(definition,'''events'',''event-detail''','''events'',''event-detail'',''faq'',''visited''');
end;
$$;
notify pgrst,'reload schema';
