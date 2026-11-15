-- Run by scripts/check-anon-rpc-timeout.py after migration 20261116000000 on top of the old definitions.
begin;
select plan(18);
select set_config('track_functions','all',false);
create function pg_temp.pc(body text) returns text language sql as $$ select 'x'||E'\n'||'Google 지도: https://www.google.com/maps/search/?api=1&query='||body||E'\ny' $$;

select is(private.post_catalog_place(pg_temp.pc('49.1%2C-123.1'),'vancouver'), '{"id":"a","name":"Alpha"}'::jsonb, 'a place on the map pin is found');
select is(private.post_catalog_place(pg_temp.pc('49.2%2C-123.2'),'vancouver'), (select v from public.rpc_before where k='regional'), 'regional list same');
select is(private.post_catalog_place(pg_temp.pc('49.3%2C-123.3'),'vancouver'), null, 'two places on one spot: none');
select is(private.post_catalog_place(pg_temp.pc('49.4%2C-123.4'),'vancouver'), (select v from public.rpc_before where k='more'), 'morePlaces same');
select is(private.post_catalog_place(pg_temp.pc('49.5%2C-123.5'),'vancouver'), null, 'non-number coordinates ignored');
select is(private.post_catalog_place(pg_temp.pc('49.6%2C-123.6'),'vancouver'), null, 'place of another city ignored');
select is(private.post_catalog_place('just a post','vancouver'), null, 'no pin: none');
select is(private.post_catalog_place(null,'vancouver'), null, 'null body: none');
select is(private.post_catalog_place(pg_temp.pc('49.1%2C-123.1'),null), null, 'null city: none');
select is(private.post_catalog_place(pg_temp.pc('49.1%2C-123.1'),'paris'), null, 'unknown city: none');
select is((select count(*) from public.rpc_before where k in ('hit','regional','twins','more','textcoords','othercity','nopin','nullbody','nullcity','unknowncity')
  and v is distinct from case k when 'hit' then '{"id":"a","name":"Alpha"}'::jsonb when 'regional' then '{"id":"r","name":"Regional"}'::jsonb
    when 'more' then '{"id":"m","name":"More"}'::jsonb end), 0::bigint, 'old function gave the same answers for all ten cases');

-- get_merchant_profile: same answers, one base call instead of several.
select is(public.get_merchant_profile('11111111-0000-0000-0000-000000000001'), (select v from public.rpc_before where k='granted'), 'granted profile unchanged');
select is(public.get_merchant_profile('11111111-0000-0000-0000-000000000002'), (select v from public.rpc_before where k='pending'), 'pending profile unchanged');
select is(coalesce(public.get_merchant_profile(gen_random_uuid()),'null'::jsonb), 'null'::jsonb, 'unknown merchant still null');
select cmp_ok((select base_calls from public.rpc_before where k='granted_calls'), '>', 1::bigint, 'before: profile read ran the base function several times');
select is((select calls from (select calls from pg_stat_xact_user_functions where funcname='business_base_get_merchant_profile') x), 3::bigint, 'after: one base call per profile read (3 reads above)');

-- Same access as before: not callable by anon/authenticated, owner unchanged; the migration refuses a changed shape.
select is((select count(*) from unnest(array['anon','authenticated','service_role']) r where has_function_privilege(r,'private.post_catalog_place(text,text)','execute')), 0::bigint, 'post_catalog_place still closed to API roles');
select throws_ok($t$@MIGRATION@$t$, 'P0001', 'merchant profile projection changed; review before adding offset 0', 'a second run stops instead of changing anything');
select * from finish();
rollback;
