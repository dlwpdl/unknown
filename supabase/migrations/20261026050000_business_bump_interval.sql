-- Business bumps: one bump per interval across all of the business's posts (premium 12h, pro 24h, plus 48h, free 120h).
-- Paid tiers are governed by the interval alone; free keeps its 2-per-month cap. bump_post's per-post check reads the same hours.
do $$
declare d text;
begin
  d:=pg_get_functiondef('private.business_membership_details_base(uuid)'::regprocedure);
  if strpos(d,'''bumpLimit'',case e->>''tier'' when ''premium'' then 24 when ''pro'' then 16 when ''plus'' then 8 else 2 end,')=0
    or strpos(d,'''bumpCooldownHours'',case e->>''tier'' when ''premium'' then 48 when ''pro'' then 60 when ''plus'' then 72 else 120 end,')=0
    or strpos(d,'(select max(created_at)+interval ''24 hours'' from private.merchant_membership_usage where merchant_id=p_merchant_id and action=''bump'')')=0
    then raise exception 'business bump anchors missing'; end if;
  d:=replace(d,'''bumpLimit'',case e->>''tier'' when ''premium'' then 24 when ''pro'' then 16 when ''plus'' then 8 else 2 end,',
    '''bumpLimit'',case when e->>''tier'' in(''plus'',''pro'',''premium'') then null else 2 end,');
  d:=replace(d,'''bumpCooldownHours'',case e->>''tier'' when ''premium'' then 48 when ''pro'' then 60 when ''plus'' then 72 else 120 end,',
    '''bumpCooldownHours'',case e->>''tier'' when ''premium'' then 12 when ''pro'' then 24 when ''plus'' then 48 else 120 end,');
  d:=replace(d,'(select max(created_at)+interval ''24 hours'' from private.merchant_membership_usage where merchant_id=p_merchant_id and action=''bump'')',
    '(select max(created_at)+make_interval(hours=>case e->>''tier'' when ''premium'' then 12 when ''pro'' then 24 when ''plus'' then 48 else 120 end) from private.merchant_membership_usage where merchant_id=p_merchant_id and action=''bump'')');
  execute d;
end;
$$;
