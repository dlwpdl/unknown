-- Preserve existing companies; unidentified new promotions have no public company profile.
alter table private.merchants add column record_kind text not null default 'business'
  check(record_kind in ('business','source'));
alter table private.merchants alter column record_kind set default 'source';

create function public.save_admin_merchant_record(p_record_kind text,p_id uuid,p_name text,p_city_id text,p_contact text,
  p_status text,p_consent text,p_consent_note text,p_trial_ends_at date default null,
  p_industry text default null,p_services text default null,p_address text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid:=coalesce(p_id,gen_random_uuid());
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_record_kind is null or p_record_kind not in ('business','source') then raise exception 'INVALID_MERCHANT_KIND'; end if;
  perform public.save_admin_merchant(mid,p_name,p_city_id,p_contact,p_status,p_consent,p_consent_note,
    p_trial_ends_at,p_industry,p_services,p_address);
  if p_record_kind='source' and (exists(select 1 from private.merchant_reviews where merchant_id=mid)
    or exists(select 1 from private.merchants where id=mid and owner_id is not null)) then
    raise exception 'MERCHANT_KIND_HAS_HISTORY';
  end if;
  update private.merchants set record_kind=p_record_kind where id=mid;
  return mid;
end;
$$;
revoke all on function public.save_admin_merchant_record(text,uuid,text,text,text,text,text,text,date,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.save_admin_merchant_record(text,uuid,text,text,text,text,text,text,date,text,text,text) to authenticated;

-- The existing canonical review visibility also controls public company profiles and their posts.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('private.merchant_review_merchant(uuid,uuid)'::regprocedure);
  anchor:='p.id=p_post_id and p.status=''published''';
  if strpos(definition,anchor)=0 then raise exception 'merchant visibility anchor changed'; end if;
  execute replace(definition,anchor,anchor||' and m.record_kind=''business''');
  definition:=pg_get_functiondef('public.get_merchant_post_source(uuid)'::regprocedure);
  anchor:='''merchant_name'',m.name,''original_url'',mp.original_url';
  if strpos(definition,anchor)=0 then raise exception 'merchant source fields changed'; end if;
  execute replace(definition,anchor,anchor||',''record_kind'',m.record_kind');
end;
$$;

-- Serialize review insertion with reclassification so existing review assets stay protected.
create function private.assert_merchant_review_business() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;
begin
  select record_kind into kind from private.merchants where id=new.merchant_id for share;
  if kind is distinct from 'business' then raise exception 'MERCHANT_REVIEWS_UNAVAILABLE'; end if;
  return new;
end;
$$;
revoke all on function private.assert_merchant_review_business() from public,anon,authenticated,service_role;
create trigger merchant_reviews_business before insert or update of merchant_id on private.merchant_reviews
  for each row execute function private.assert_merchant_review_business();

update public.tags set label='부동산' where slug='housing';
notify pgrst,'reload schema';
