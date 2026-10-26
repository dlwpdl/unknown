-- Business new posts per month: free 1, plus 2, pro 5, premium 10 (owner 2026-10-26). Paid-workspace merchants without a membership stay unlimited.
-- Premium's reserved operator-managed share (4 posts, 8 bumps, 1 report) is retired: managed work is the separate "글링 관리" inquiry tier,
-- so premium businesses get all 10 posts themselves.
do $$
declare d text;
begin
  d:=pg_get_functiondef('private.business_membership_details_base(uuid)'::regprocedure);
  if strpos(d,'when ''premium'' then 10 when ''pro'' then 5 when ''plus'' then 2 else 1 end end,')=0 then
    if strpos(d,'else case e->>''tier'' when ''premium'' then 30 when ''pro'' then 30 when ''plus'' then 12 else 1 end end,')=0
      then raise exception 'business post limit anchor missing'; end if;
    d:=replace(d,'else case e->>''tier'' when ''premium'' then 30 when ''pro'' then 30 when ''plus'' then 12 else 1 end end,',
      'else case e->>''tier'' when ''premium'' then 10 when ''pro'' then 5 when ''plus'' then 2 else 1 end end,');
  end if;
  if strpos(d,'''managedPostLimit'',case e->>''tier'' when ''premium'' then 4 else 0 end,')=0
    or strpos(d,'''managedBumpLimit'',case e->>''tier'' when ''premium'' then 8 else 0 end,')=0
    or strpos(d,'''reportLimit'',case e->>''tier'' when ''premium'' then 1 else 0 end,')=0
    then raise exception 'business managed limit anchors missing'; end if;
  d:=replace(d,'''managedPostLimit'',case e->>''tier'' when ''premium'' then 4 else 0 end,','''managedPostLimit'',0,');
  d:=replace(d,'''managedBumpLimit'',case e->>''tier'' when ''premium'' then 8 else 0 end,','''managedBumpLimit'',0,');
  d:=replace(d,'''reportLimit'',case e->>''tier'' when ''premium'' then 1 else 0 end,','''reportLimit'',0,');
  execute d;
end;
$$;
