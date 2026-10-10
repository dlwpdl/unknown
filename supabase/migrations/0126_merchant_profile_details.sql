alter table private.merchants
  add column industry text not null default '' check(length(industry)<=80),
  add column services text not null default '' check(length(services)<=1500),
  add column address text not null default '' check(length(address)<=300);

-- One signature keeps PostgREST unambiguous; legacy calls use the new defaults.
drop function public.save_admin_merchant(uuid,text,text,text,text,text,text,date);
create function public.save_admin_merchant(p_id uuid,p_name text,p_city_id text,p_contact text,
  p_status text,p_consent text,p_consent_note text,p_trial_ends_at date default null,
  p_industry text default null,p_services text default null,p_address text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid:=coalesce(p_id,gen_random_uuid());
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  if p_name is null or length(btrim(p_name)) not between 1 and 120
    or not exists(select 1 from public.cities where id=p_city_id)
    or p_contact is null or length(p_contact)>1000 or p_status is null or p_status not in ('lead','trial','paid','paused')
    or p_consent is null or p_consent not in ('pending','granted','revoked')
    or p_consent_note is null or length(p_consent_note)>3000
    or length(coalesce(p_industry,''))>80 or length(coalesce(p_services,''))>1500
    or length(coalesce(p_address,''))>300 then raise exception 'INVALID_MERCHANT'; end if;
  if p_consent='granted' and length(btrim(p_consent_note))=0 then raise exception 'MERCHANT_CONSENT_REQUIRED'; end if;
  if exists(select 1 from private.merchants m where m.id=mid and m.city_id<>p_city_id)
    and exists(select 1 from private.merchant_posts where merchant_id=mid) then raise exception 'MERCHANT_CITY_LOCKED'; end if;
  insert into private.merchants as m(id,name,city_id,contact,status,consent,consent_note,trial_ends_at,industry,services,address)
  values(mid,btrim(p_name),p_city_id,btrim(p_contact),p_status,p_consent,btrim(p_consent_note),p_trial_ends_at,
    btrim(coalesce(p_industry,'')),btrim(coalesce(p_services,'')),btrim(coalesce(p_address,'')))
  on conflict(id) do update set name=excluded.name,city_id=excluded.city_id,contact=excluded.contact,
    status=excluded.status,consent=excluded.consent,consent_note=excluded.consent_note,
    trial_ends_at=excluded.trial_ends_at,industry=coalesce(btrim(p_industry),m.industry),
    services=coalesce(btrim(p_services),m.services),address=coalesce(btrim(p_address),m.address),updated_at=now();
  return mid;
end;
$$;
revoke all on function public.save_admin_merchant(uuid,text,text,text,text,text,text,date,text,text,text) from public,anon,authenticated;
grant execute on function public.save_admin_merchant(uuid,text,text,text,text,text,text,date,text,text,text) to authenticated;
notify pgrst,'reload schema';
