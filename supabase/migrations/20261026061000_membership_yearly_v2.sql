-- v2 yearly products (2 months free, owner 2026-10-26) are accepted alongside monthly: com.dlwpdl.gling.<kind>.<tier>.yearly.v2 and gling_<kind>_<tier>_v2:yearly.
do $$
declare d text;
begin
  d:=pg_get_functiondef('public.apply_membership_snapshot(uuid,jsonb,timestamptz)'::regprocedure);
  if strpos(d,'e->>''product_id''=''com.dlwpdl.gling.''||(e->>''kind'')||''.''||(e->>''tier'')||''.monthly.v2''')=0
    or strpos(d,'e->>''product_id''=''gling_''||(e->>''kind'')||''_''||(e->>''tier'')||''_v2:monthly''')=0
    then raise exception 'membership product anchors missing'; end if;
  d:=replace(d,'e->>''product_id''=''com.dlwpdl.gling.''||(e->>''kind'')||''.''||(e->>''tier'')||''.monthly.v2''',
    'e->>''product_id'' in(''com.dlwpdl.gling.''||(e->>''kind'')||''.''||(e->>''tier'')||''.monthly.v2'',''com.dlwpdl.gling.''||(e->>''kind'')||''.''||(e->>''tier'')||''.yearly.v2'')');
  d:=replace(d,'e->>''product_id''=''gling_''||(e->>''kind'')||''_''||(e->>''tier'')||''_v2:monthly''',
    'e->>''product_id'' in(''gling_''||(e->>''kind'')||''_''||(e->>''tier'')||''_v2:monthly'',''gling_''||(e->>''kind'')||''_''||(e->>''tier'')||''_v2:yearly'')');
  execute d;

  -- Admin revenue counts the same general receipt families.
  d:=pg_get_functiondef('public.get_admin_performance(integer,text,text,boolean,text)'::regprocedure);
  if strpos(d,'general[.](plus|pro|premium)[.]monthly[.]v2)$')=0 or strpos(d,'general_(plus|pro|premium)_v2:monthly)$')=0
    then raise exception 'admin revenue anchors missing'; end if;
  d:=replace(d,'general[.](plus|pro|premium)[.]monthly[.]v2)$','general[.](plus|pro|premium)[.](monthly|yearly)[.]v2)$');
  d:=replace(d,'general_(plus|pro|premium)_v2:monthly)$','general_(plus|pro|premium)_v2:(monthly|yearly))$');
  execute d;
end;
$$;
