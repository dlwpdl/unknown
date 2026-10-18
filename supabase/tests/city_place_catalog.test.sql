begin;
do $$begin
  if public.get_city_place_catalog() is not null then raise exception 'expected isolated empty catalog'; end if;
end$$;
insert into private.city_place_catalog(id,payload,refreshed_on)
values(true,'{"collectedAt":"2026-10-17T12:00:00Z","cities":{"vancouver":{"places":[]}}}',current_date);
set local role anon;
do $$begin
  if public.get_city_place_catalog()->'cities'->'vancouver' is null then raise exception 'public facts missing'; end if;
  begin
    perform payload from private.city_place_catalog;
    raise exception 'private table must not be readable';
  exception when insufficient_privilege then null; end;
  begin
    insert into private.city_place_catalog(id,payload,refreshed_on) values(false,'{}',current_date);
    raise exception 'anonymous write must fail';
  exception when insufficient_privilege then null; end;
end$$;
reset role;
set local role authenticated;
do $$begin
  if public.get_city_place_catalog()->>'collectedAt' <> '2026-10-17T12:00:00Z' then raise exception 'read API must preserve dates'; end if;
  begin
    update private.city_place_catalog set payload='{}';
    raise exception 'member write must fail';
  exception when insufficient_privilege then null; end;
end$$;
reset role;
do $$begin
  begin
    update private.city_place_catalog set payload='{"cities":{}}';
    raise exception 'missing catalog date must fail';
  exception when check_violation then null; end;
end$$;
rollback;
