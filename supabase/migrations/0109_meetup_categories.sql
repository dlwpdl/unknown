-- Keep the existing atomic create flow and its moderation, consent, and quota checks.
do $$
declare definition text; old_categories text := '''casual'',''hobby'',''travel''';
begin
  definition := pg_get_functiondef('public.create_chilling_event(text,text,text,jsonb,text,text[])'::regprocedure);
  if strpos(definition, old_categories) = 0 then raise exception 'meetup category guard anchor missing'; end if;
  execute replace(definition, old_categories, '''casual'',''hobby'',''travel'',''party'',''festival'',''sports''');
end;
$$;
