-- Extend the existing atomic flow, preserving its current quota, moderation and consent guards.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.create_chilling_event(text,text,text,jsonb,text)'::regprocedure);
  anchor:='p_event jsonb, p_question text)';
  if strpos(definition,anchor)=0 then raise exception 'cover signature anchor missing'; end if;
  definition:=replace(definition,anchor,'p_event jsonb, p_question text, p_image_paths text[])');
  anchor:='  perform private.assert_active_account(auth.uid());';
  if strpos(definition,anchor)=0 then raise exception 'cover guard anchor missing'; end if;
  definition:=replace(definition,anchor,anchor||E'\n  if coalesce(cardinality(p_image_paths),0)>1 then raise exception ''TOO_MANY_IMAGES''; end if;\n  if exists(select 1 from unnest(p_image_paths) path where path is null) then raise exception ''INVALID_IMAGE_PATH''; end if;');
  anchor:='post_id:=public.create_post(p_city_id,meetup_tag,p_title,p_body,p_room_preview=>''{}''::jsonb);';
  if strpos(definition,anchor)=0 then raise exception 'cover create anchor missing'; end if;
  execute replace(definition,anchor,'post_id:=public.create_post(p_city_id,meetup_tag,p_title,p_body,p_image_paths=>p_image_paths,p_room_preview=>''{}''::jsonb);');
end;
$$;
revoke all on function public.create_chilling_event(text,text,text,jsonb,text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.create_chilling_event(text,text,text,jsonb,text,text[]) to authenticated;

-- Old clients retain the five-argument call; both routes use the same implementation.
create or replace function public.create_chilling_event(p_city_id text,p_title text,p_body text,p_event jsonb,p_question text)
returns uuid language sql security invoker set search_path='' as $$
  select public.create_chilling_event(p_city_id,p_title,p_body,p_event,p_question,'{}'::text[]);
$$;
