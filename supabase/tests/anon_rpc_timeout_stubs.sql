-- Stand-ins for what get_merchant_profile / post_catalog_place read; used only by scripts/check-anon-rpc-timeout.py.
create extension if not exists pgtap;
create schema private; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table private.city_place_catalog(id boolean primary key default true check(id), payload jsonb not null);
insert into private.city_place_catalog(payload) values (jsonb_build_object('cities', jsonb_build_object('vancouver', jsonb_build_object(
  'places', jsonb_build_array(
    jsonb_build_object('id','a','name','Alpha','cityId','vancouver','latitude',49.1,'longitude',-123.1),
    jsonb_build_object('id','bad','name','Bad coords','cityId','vancouver','latitude','49.5','longitude',-123.5),
    jsonb_build_object('id','other','name','Other city','cityId','toronto','latitude',49.6,'longitude',-123.6)),
  'regionalPlaces', jsonb_build_array(jsonb_build_object('id','r','name','Regional','cityId','vancouver','latitude',49.2,'longitude',-123.2)),
  'extraPlaces', jsonb_build_array(jsonb_build_object('id','d1','name','Twin 1','cityId','vancouver','latitude',49.3,'longitude',-123.3)),
  'morePlaces', jsonb_build_array(jsonb_build_object('id','d2','name','Twin 2','cityId','vancouver','latitude',49.3,'longitude',-123.3),
    jsonb_build_object('id','m','name','More','cityId','vancouver','latitude',49.4,'longitude',-123.4))))));
create table public.profiles(id uuid primary key);
create table public.posts(id uuid primary key, business_author_id uuid);
create table private.business_blocks(user_id uuid, business_id uuid);
create table private.merchants(id uuid primary key, name text, city_id text, owner_id uuid, record_kind text default 'business', deleted_at timestamptz,
  status text default 'trial', consent text, intro_vibe text, intro_order text, intro_tip text);
create function private.is_active_account(u uuid) returns boolean language sql stable as $$ select false $$;
create function private.saved_merchant_at(u uuid, m uuid) returns timestamptz language sql stable as $$ select null::timestamptz $$;
create function private.business_chat_can_use(u uuid, x uuid) returns boolean language sql stable as $$ select false $$;
create function private.business_chat_business_ready(m uuid) returns boolean language sql stable as $$ select false $$;
create function private.is_blocked_between(a uuid, b uuid) returns boolean language sql stable as $$ select false $$;
create function private.has_reported(v uuid, t text, i uuid) returns boolean language sql stable as $$ select false $$;
create function private.public_post_business_id(p uuid) returns uuid language sql stable security definer set search_path='' as $$
  select business_author_id from public.posts where id=p $$;
-- Same shape as production: SECURITY DEFINER so it is never inlined into the caller.
create function private.business_base_get_merchant_profile(m uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',x.id,'name',x.name,'city_id',x.city_id,'city_name','City','industry','Cafe','services','','address','',
    'public_phone','','business_hours','','notifications_enabled',false,'avatar_path',null,'banner_path',null,'review_post_id',null,'source_urls','[]'::jsonb)
  from private.merchants x where x.id=m $$;
insert into private.merchants(id,name,city_id,consent,intro_vibe) values
  ('11111111-0000-0000-0000-000000000001','Granted shop','vancouver','granted','cozy'),
  ('11111111-0000-0000-0000-000000000002','Pending shop','vancouver','pending',null);
insert into public.posts values ('22222222-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002');
