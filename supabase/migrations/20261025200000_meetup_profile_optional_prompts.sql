-- Meetup profiles only require name, city and a one-line intro; prompts and interests can be filled in later.
-- Patch the existing implementation in place so its auth, photo and v1/v2 guards stay intact.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.save_chilling_profile(jsonb)'::regprocedure);
  foreach anchor in array array[
    'char_length(trim(p_profile->>''promptOne'')) not between 1 and 300',
    'char_length(trim(p_profile->>''promptTwo'')) not between 1 and 300',
    'jsonb_array_length(p_profile->''interests'') not between 1 and 8',
    '(select jsonb_agg(trim(x#>>''{}'')) from jsonb_array_elements(p_profile->''interests'') x)'] loop
    if strpos(definition,anchor)=0 then raise exception 'CHILLING_OPTIONAL_PROMPTS_ANCHOR_CHANGED: %',anchor; end if;
  end loop;
  definition:=replace(definition,'char_length(trim(p_profile->>''promptOne'')) not between 1 and 300','char_length(trim(p_profile->>''promptOne''))>300');
  definition:=replace(definition,'char_length(trim(p_profile->>''promptTwo'')) not between 1 and 300','char_length(trim(p_profile->>''promptTwo''))>300');
  definition:=replace(definition,'jsonb_array_length(p_profile->''interests'') not between 1 and 8','jsonb_array_length(p_profile->''interests'')>8');
  -- jsonb_agg over zero interests is null; keep the stored shape an array.
  definition:=replace(definition,'(select jsonb_agg(trim(x#>>''{}'')) from jsonb_array_elements(p_profile->''interests'') x)',
    'coalesce((select jsonb_agg(trim(x#>>''{}'')) from jsonb_array_elements(p_profile->''interests'') x),''[]''::jsonb)');
  execute definition;
end $$;
