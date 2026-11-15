-- A person or business in a business conversation can report the business on the other side as a whole,
-- not only one of its messages (business chat settings › 신고). The report reaches the same queue, evidence
-- capture and admin alert as every other report; nothing here narrows automated monitoring or admin review.

-- Extend the saved report and notification contracts instead of replacing their newer branches.
do $$
declare tbl text; definition text; anchor text;
begin
  foreach tbl in array array['reports','safety_review_queue','safety_alerts','notifications'] loop
    select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid=('public.'||tbl)::regclass and conname=tbl||'_target_type_check';
    if definition is null or left(definition,7)<>'CHECK (' then raise exception 'BUSINESS_TARGET_CONSTRAINT_CHANGED: %',tbl; end if;
    if definition like '%''business''::text%' then continue; end if;
    execute format('alter table public.%I drop constraint %I',tbl,tbl||'_target_type_check');
    execute format('alter table public.%I add constraint %I check ((%s) or target_type=''business'')',tbl,tbl||'_target_type_check',substring(definition from 8 for char_length(definition)-8));
  end loop;

  -- The evidence keeps the business as it was when reported; its private contact field stays out.
  definition:=pg_get_functiondef('private.capture_report_evidence()'::regprocedure); anchor:='case new.target_type';
  if strpos(definition,anchor)=0 then raise exception 'BUSINESS_REPORT_EVIDENCE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$branch$
    when 'business' then select jsonb_build_object('merchant_id',m.id,'merchant_name',m.name,'city_id',m.city_id,'owner_id',m.owner_id) into new.evidence
      from private.merchants m where m.id=new.target_id;
  $branch$);
  definition:=pg_get_functiondef('private.notification_target_visible(uuid,text,uuid)'::regprocedure); anchor:='case p_target_type';
  if strpos(definition,anchor)=0 then raise exception 'BUSINESS_NOTIFICATION_TARGET_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' when ''business'' then private.is_admin_id(p_user_id) ');
end $$;

create function public.report_business_conversation(p_conversation_id uuid,p_as_business_id uuid,p_reason_code text,p_details text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.conversations; peer_business uuid; owner uuid; saved uuid;
begin
  c:=private.lock_business_chat(p_conversation_id,p_as_business_id);
  if coalesce(p_as_business_id,auth.uid())=coalesce(c.user_low_id,c.business_low_id) then peer_business:=c.business_high_id;
  else peer_business:=c.business_low_id; end if;
  if peer_business is null then raise exception 'NOT_A_BUSINESS'; end if;
  select m.owner_id into owner from private.merchants m where m.id=peer_business;
  if owner is null then raise exception 'NOT_A_BUSINESS'; end if;
  if peer_business=p_as_business_id or owner=auth.uid() then raise exception 'CANNOT_REPORT_SELF'; end if;
  if p_reason_code is null or p_reason_code not in ('spam','harassment','hate','sexual','privacy','other') then raise exception 'INVALID_REASON'; end if;
  if char_length(coalesce(p_details,''))>1000 then raise exception 'INVALID_DETAILS'; end if;
  perform private.enforce_rate_limit('report',20,interval '1 day',interval '5 seconds');
  insert into public.reports(reporter_id,reporter_business_id,reported_user_id,target_type,target_id,reason_code,details)
    values(auth.uid(),p_as_business_id,owner,'business',peer_business,p_reason_code,nullif(btrim(p_details),'')) returning id into saved;
  return saved;
end;
$$;
alter function public.report_business_conversation(uuid,uuid,text,text) owner to postgres;
revoke all on function public.report_business_conversation(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.report_business_conversation(uuid,uuid,text,text) to authenticated;
notify pgrst,'reload schema';
