-- Clone the installed guarded DTO; preserve history, private projections and grants.
do $$
declare definition text; original_hash text; anchor text;
begin
 definition:=pg_get_functiondef('public.get_meetup_sessions(uuid)'::regprocedure);
 original_hash:=md5(definition);
 foreach anchor in array array['FUNCTION public.get_meetup_sessions(','order by starts_at desc','if event.id is null then raise exception ''MEETUP_NOT_FOUND''; end if;','where s.post_id=event.id and private.can_attend_session(s.id,u)','order by s.starts_at desc limit 12'] loop
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MEETUP_SESSION_VIEW_CHANGED'; end if;
 end loop;
 definition:=replace(definition,'FUNCTION public.get_meetup_sessions(','FUNCTION public.get_meetup_upcoming_sessions(');
 definition:=replace(definition,'order by starts_at desc','order by starts_at asc');
 definition:=replace(definition,'if event.id is null then raise exception ''MEETUP_NOT_FOUND''; end if;',
  'if event.id is null then raise exception ''MEETUP_NOT_FOUND''; end if; if not private.chilling_context_visible(event.id,u) then return jsonb_build_object(''isHost'',false,''member'',false,''kind'',coalesce(event.room_preview->>''eventKind'',''group''),''sessions'',''[]''::jsonb); end if;');
 definition:=replace(definition,'where s.post_id=event.id and private.can_attend_session(s.id,u)','where s.post_id=event.id and private.can_attend_session(s.id,u) and s.ends_at>now()');
 definition:=replace(definition,'order by s.starts_at desc limit 12','order by s.starts_at asc limit 12');
 execute definition;
 if md5(pg_get_functiondef('public.get_meetup_sessions(uuid)'::regprocedure))<>original_hash then raise exception 'MEETUP_HISTORY_CHANGED'; end if;
end $$;
alter function public.get_meetup_upcoming_sessions(uuid) owner to postgres;
revoke all on function public.get_meetup_upcoming_sessions(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_meetup_upcoming_sessions(uuid) to authenticated;
notify pgrst,'reload schema';
