-- Recommendations are public event metadata, never an admission or identity check.
create function private.guard_meetup_recommended_age() returns trigger
language plpgsql set search_path='' as $$
declare minimum jsonb:=new.room_preview->'recommendedAgeMin'; maximum jsonb:=new.room_preview->'recommendedAgeMax'; lo numeric; hi numeric;
begin
  if coalesce(minimum,'null'::jsonb)='null'::jsonb and coalesce(maximum,'null'::jsonb)='null'::jsonb then return new; end if;
  if jsonb_typeof(minimum) is distinct from 'number' or jsonb_typeof(maximum) is distinct from 'number' then raise exception 'INVALID_RECOMMENDED_AGE'; end if;
  lo:=(minimum::text)::numeric; hi:=(maximum::text)::numeric;
  if lo<>trunc(lo) or hi<>trunc(hi) or lo<0 or hi>120 or lo>hi then raise exception 'INVALID_RECOMMENDED_AGE'; end if;
  return new;
end;
$$;
revoke all on function private.guard_meetup_recommended_age() from public,anon,authenticated,service_role;
create trigger posts_recommended_age before insert or update of room_preview on public.posts
for each row execute function private.guard_meetup_recommended_age();

do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.create_chilling_event(text,text,text,jsonb,text,text[])'::regprocedure);
  anchor:='''capacity'',''category'']';
  if strpos(definition,anchor)=0 then raise exception 'event age whitelist anchor missing'; end if;
  definition:=replace(definition,anchor,'''capacity'',''category'',''recommendedAgeMin'',''recommendedAgeMax'']');
  anchor:='jsonb_build_object(''applicationQuestion'',trim(p_question),''category'',category)';
  if strpos(definition,anchor)=0 then raise exception 'event age metadata anchor missing'; end if;
  execute replace(definition,anchor,'jsonb_build_object(''applicationQuestion'',trim(p_question),''category'',category,''recommendedAgeMin'',p_event->''recommendedAgeMin'',''recommendedAgeMax'',p_event->''recommendedAgeMax'')');
end;
$$;

-- Preserve the old seven-argument schedule API and its existing metadata.
create function public.configure_chilling_event(p_post_id uuid,p_kind text,p_starts_at timestamptz,p_ends_at timestamptz,
  p_timezone text,p_cadence text,p_capacity integer,p_recommended_age_min integer,p_recommended_age_max integer)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.configure_chilling_event(p_post_id,p_kind,p_starts_at,p_ends_at,p_timezone,p_cadence,p_capacity);
  update public.posts set room_preview=room_preview||jsonb_build_object('recommendedAgeMin',p_recommended_age_min,'recommendedAgeMax',p_recommended_age_max)
    where id=p_post_id and author_id=auth.uid();
end;
$$;
revoke all on function public.configure_chilling_event(uuid,text,timestamptz,timestamptz,text,text,integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.configure_chilling_event(uuid,text,timestamptz,timestamptz,text,text,integer,integer,integer) to authenticated;

-- Old clients may still save their original-purpose consent. Never upgrade existing receipts.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.save_my_personal_info(text,date,text,uuid)'::regprocedure);
  anchor:='if p_version is distinct from ''2026-09-12'' then';
  if strpos(definition,anchor)=0 then raise exception 'personal purpose version anchor missing'; end if;
  execute replace(definition,anchor,'if p_version is null or p_version not in (''2026-09-12'',''2026-09-19'') then');
  definition:=pg_get_functiondef('public.get_my_personal_info()'::regprocedure);
  anchor:='''consented_at'',i.consented_at';
  if strpos(definition,anchor)=0 then raise exception 'owner consent version anchor missing'; end if;
  execute replace(definition,anchor,'''consent_version'',i.consent_version,'||anchor);
end;
$$;
notify pgrst,'reload schema';
