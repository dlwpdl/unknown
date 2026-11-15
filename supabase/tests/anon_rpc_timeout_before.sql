-- Run before the migration: answers of the old functions, kept to compare after.
create table public.rpc_before(k text primary key, v jsonb, base_calls bigint);
select set_config('track_functions','all',false);
create function pg_temp.pc(body text) returns text language sql as $$ select 'x'||E'\n'||'Google 지도: https://www.google.com/maps/search/?api=1&query='||body||E'\ny' $$;
insert into public.rpc_before(k,v) select k, private.post_catalog_place(b,c) from (values
  ('hit', pg_temp.pc('49.1%2C-123.1'),'vancouver'), ('regional', pg_temp.pc('49.2%2C-123.2'),'vancouver'),
  ('twins', pg_temp.pc('49.3%2C-123.3'),'vancouver'), ('more', pg_temp.pc('49.4%2C-123.4'),'vancouver'),
  ('textcoords', pg_temp.pc('49.5%2C-123.5'),'vancouver'), ('othercity', pg_temp.pc('49.6%2C-123.6'),'vancouver'),
  ('nopin','just a post',  'vancouver'), ('nullbody',null,'vancouver'), ('nullcity',pg_temp.pc('49.1%2C-123.1'),null),
  ('unknowncity',pg_temp.pc('49.1%2C-123.1'),'paris')) t(k,b,c);
-- Count how many times the base profile function runs per get_merchant_profile call (one transaction each).
begin; select public.get_merchant_profile('11111111-0000-0000-0000-000000000001');
  insert into public.rpc_before select 'granted_calls', null, (select calls from pg_stat_xact_user_functions where funcname='business_base_get_merchant_profile'); commit;
begin; select public.get_merchant_profile('11111111-0000-0000-0000-000000000002');
  insert into public.rpc_before select 'pending_calls', null, (select calls from pg_stat_xact_user_functions where funcname='business_base_get_merchant_profile'); commit;
insert into public.rpc_before(k,v) select 'granted', public.get_merchant_profile('11111111-0000-0000-0000-000000000001');
insert into public.rpc_before(k,v) select 'pending', public.get_merchant_profile('11111111-0000-0000-0000-000000000002');
insert into public.rpc_before(k,v) select 'missing', coalesce(public.get_merchant_profile(gen_random_uuid()),'null'::jsonb);
