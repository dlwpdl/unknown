-- Business intro (owner 2026-11-04, P6): the business writes three short lines itself — the feel of the place, what to
-- order, and a tip. No AI writes or fills them; an empty line is hidden on the profile.
do $$ declare c text; begin
 foreach c in array array['intro_vibe','intro_order','intro_tip'] loop
  execute format('alter table private.merchants add column %I text not null default '''' constraint %I check(char_length(%I)<=160 and %I !~ ''[[:cntrl:]]'')',
    c,'merchants_'||c||'_check',c,c);
 end loop;
end $$;

do $$
declare definition text; anchor text;
begin
  -- Only consented businesses show the intro; a pending one keeps its stripped profile.
  definition:=pg_get_functiondef('public.get_merchant_profile(uuid)'::regprocedure);
  anchor:='profile||jsonb_build_object(';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_INTRO_PROFILE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||'''intro_vibe'',m.intro_vibe,''intro_order'',m.intro_order,''intro_tip'',m.intro_tip,');

  definition:=pg_get_functiondef('public.get_my_merchant_profile(uuid)'::regprocedure);
  anchor:='''map_photo_path'',m.map_photo_path,';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MY_MERCHANT_INTRO_FIELDS_CHANGED'; end if;
  execute replace(definition,anchor,anchor||'''intro_vibe'',m.intro_vibe,''intro_order'',m.intro_order,''intro_tip'',m.intro_tip,');

  definition:=pg_get_functiondef('private.erase_deleted_merchant_workspace()'::regprocedure);
  anchor:='set map_photo_path=null,avatar_path=null,banner_path=null,';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_INTRO_ERASURE_CHANGED'; end if;
  execute replace(definition,anchor,'set intro_vibe='''',intro_order='''',intro_tip='''',map_photo_path=null,avatar_path=null,banner_path=null,');
end $$;

create function public.save_merchant_intro(p_merchant_id uuid,p_vibe text,p_order text,p_tip text,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants;
  trim_chars text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  vibe text:=btrim(p_vibe,trim_chars); order_text text:=btrim(p_order,trim_chars); tip text:=btrim(p_tip,trim_chars);
begin
  m:=private.lock_merchant_profile_owner(p_merchant_id,true);
  -- One line each; links belong in the profile's link fields, not here.
  if vibe is null or order_text is null or tip is null
    or char_length(vibe)>160 or char_length(order_text)>160 or char_length(tip)>160
    or concat(vibe,order_text,tip) ~ '[[:cntrl:]]' or concat_ws(' ',vibe,order_text,tip) ~* '(https?://|www\.)'
    then raise exception 'INVALID_MERCHANT_INTRO'; end if;
  if m.intro_vibe=vibe and m.intro_order=order_text and m.intro_tip=tip then return public.get_my_merchant_profile(m.id); end if;
  if p_expected_updated_at is distinct from m.updated_at then raise exception 'MERCHANT_PROFILE_CHANGED'; end if;
  update private.merchants set intro_vibe=vibe,intro_order=order_text,intro_tip=tip,updated_at=clock_timestamp() where id=m.id;
  return public.get_my_merchant_profile(m.id);
end $$;
alter function public.save_merchant_intro(uuid,text,text,text,timestamptz) owner to postgres;
revoke all on function public.save_merchant_intro(uuid,text,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.save_merchant_intro(uuid,text,text,text,timestamptz) to authenticated;
notify pgrst,'reload schema';
