begin;
set local search_path=public,extensions;
select no_plan();
select ok(has_function_privilege('authenticated','public.get_my_business_chat_profiles()','EXECUTE')
 and not has_function_privilege('anon','public.get_my_business_chat_profiles()','EXECUTE')
 and not has_function_privilege('service_role','public.get_my_business_chat_profiles()','EXECUTE'),'account sheet RPC keeps authenticated-only execution grants');
insert into public.cities values ('map-photo-test','Map Photo','BC','America/Vancouver',true),('map-photo-other','Other City','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
 ('d2500000-0000-4000-8000-000000000001','map-owner@example.test','{"merchant_enabled":true}'),
 ('d2500000-0000-4000-8000-000000000002','map-operator@example.test','{"merchant_enabled":true}'),
 ('d2500000-0000-4000-8000-000000000003','map-stranger@example.test','{"merchant_enabled":true}'),
 ('d2500000-0000-4000-8000-000000000004','map-admin@example.test','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id) values
 ('d2500000-0000-4000-8000-000000000001','MapOwner','map-photo-test'),
 ('d2500000-0000-4000-8000-000000000002','MapOperator','map-photo-test'),
 ('d2500000-0000-4000-8000-000000000003','MapStranger','map-photo-test'),
 ('d2500000-0000-4000-8000-000000000004','MapAdmin','map-photo-test');
update public.profiles set terms_accepted_at=now(),privacy_accepted_at=now(),ai_safety_consent_at=now()
 where city_id='map-photo-test';
update auth.users set raw_app_meta_data='{"role":"admin","merchant_enabled":true}' where id='d2500000-0000-4000-8000-000000000004';
insert into auth.sessions(id,user_id,aal) values ('d2590000-0000-4000-8000-000000000004','d2500000-0000-4000-8000-000000000004','aal2');
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,owner_id,owner_verified_at) values
 ('d2510000-0000-4000-8000-000000000001','Map Branch','map-photo-test','trial','granted','Fixture','business','d2500000-0000-4000-8000-000000000001',now()),
 ('d2510000-0000-4000-8000-000000000002','Private Branch','map-photo-test','paused','granted','Fixture','business','d2500000-0000-4000-8000-000000000001',now()),
 ('d2510000-0000-4000-8000-000000000003','Other Branch','map-photo-test','trial','granted','Fixture','business','d2500000-0000-4000-8000-000000000003',now()),
 ('d2510000-0000-4000-8000-000000000004','Other City','map-photo-other','trial','granted','Fixture','business','d2500000-0000-4000-8000-000000000001',now());
insert into private.merchant_operators(merchant_id,user_id) values ('d2510000-0000-4000-8000-000000000001','d2500000-0000-4000-8000-000000000002');
insert into private.webshop_place_links(place_key,merchant_id,city_id) values
 ('osm:node:25001','d2510000-0000-4000-8000-000000000001','map-photo-test'),
 ('partner:map-photo-branch','d2510000-0000-4000-8000-000000000001','map-photo-test'),
 ('osm:node:25002','d2510000-0000-4000-8000-000000000002','map-photo-test'),
 ('osm:node:25004','d2510000-0000-4000-8000-000000000004','map-photo-other');
insert into storage.buckets(id,name,public) values ('merchant-profile-images','merchant-profile-images',false) on conflict(id) do nothing;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 select 'merchant-profile-images','d2500000-0000-4000-8000-000000000001/d2510000-0000-4000-8000-000000000001_'||id||'.webp','d2500000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":24}'::jsonb
 from unnest(array['d2520000-0000-4000-8000-000000000001','d2520000-0000-4000-8000-000000000002','d2520000-0000-4000-8000-000000000003']) id;

select set_config('request.jwt.claims','{"sub":"d2500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_my_merchant_profile('d2510000-0000-4000-8000-000000000001')->'map_photo_path','null'::jsonb,'existing profile starts without a map photo');
select is(public.save_my_merchant_profile_photos('d2510000-0000-4000-8000-000000000001',null,null,
 'd2500000-0000-4000-8000-000000000001/d2510000-0000-4000-8000-000000000001_d2520000-0000-4000-8000-000000000001.webp',
 (public.get_my_merchant_profile('d2510000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)->>'can_edit','true','verified owner saves an uploaded map photo');
select is(public.save_my_merchant_profile('d2510000-0000-4000-8000-000000000001',
 'd2500000-0000-4000-8000-000000000001/d2510000-0000-4000-8000-000000000001_d2520000-0000-4000-8000-000000000002.webp',
 'd2500000-0000-4000-8000-000000000001/d2510000-0000-4000-8000-000000000001_d2520000-0000-4000-8000-000000000003.webp',
 (public.get_my_merchant_profile('d2510000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)->>'map_photo_path',
 'd2500000-0000-4000-8000-000000000001/d2510000-0000-4000-8000-000000000001_d2520000-0000-4000-8000-000000000001.webp','older save signature preserves map photo');
select is((select x->>'avatar_path' from jsonb_array_elements(public.get_my_business_chat_profiles()->'merchants') x where x->>'id'='d2510000-0000-4000-8000-000000000001'),
 'business-profile/d2510000-0000-4000-8000-000000000001/avatar/'||md5('d2500000-0000-4000-8000-000000000001/d2510000-0000-4000-8000-000000000001_d2520000-0000-4000-8000-000000000002.webp'),'account sheet owner gets opaque saved logo without uploader path');
select is((select x->'avatar_path' from jsonb_array_elements(public.get_my_business_chat_profiles()->'merchants') x where x->>'id'='d2510000-0000-4000-8000-000000000004'),'null'::jsonb,'account sheet business without logo returns null');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_my_business_chat_profiles()->'merchants'->0) k),
 array['avatar_path','city_name','id','name','role']::text[],'account sheet rows retain original fields with only optional avatar metadata');
select throws_ok($$select public.save_my_merchant_profile_photos('d2510000-0000-4000-8000-000000000001',null,null,null,'2000-01-01')$$,'P0001','MERCHANT_PROFILE_CHANGED','stale revision cannot overwrite photos');
select throws_ok($$select public.save_my_merchant_profile_photos('d2510000-0000-4000-8000-000000000001',null,null,'https://evil.test/photo.webp',
 (public.get_my_merchant_profile('d2510000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)$$,'P0001','INVALID_MERCHANT_PROFILE_IMAGE','arbitrary photo URL is rejected');
select throws_ok($$select public.save_my_merchant_profile_photos('d2510000-0000-4000-8000-000000000003',null,null,
 'd2500000-0000-4000-8000-000000000001/d2510000-0000-4000-8000-000000000001_d2520000-0000-4000-8000-000000000001.webp',now())$$,'P0001','MERCHANT_ACCESS_REQUIRED','one business owner cannot write another business');
select ok(not private.can_delete_merchant_profile_image('d2500000-0000-4000-8000-000000000001/d2510000-0000-4000-8000-000000000001_'||id||'.webp'),'bound image cannot be deleted: '||id)
 from unnest(array['d2520000-0000-4000-8000-000000000001','d2520000-0000-4000-8000-000000000002','d2520000-0000-4000-8000-000000000003']) id;
reset role;

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(jsonb_array_length(public.get_city_business_map_photos('map-photo-test')),2,'one public photo binds only the two exact registry place keys');
select is(public.get_city_business_map_photos('map-photo-test')->0->>'photoPath',
 'business-profile/d2510000-0000-4000-8000-000000000001/map/'||md5('d2500000-0000-4000-8000-000000000001/d2510000-0000-4000-8000-000000000001_d2520000-0000-4000-8000-000000000001.webp'),'public batch returns opaque business identity, never uploader path');
select is(public.get_city_business_map_photos('map-photo-other'),'[]'::jsonb,'other city does not inherit a branch photo');
select throws_ok($$select public.save_my_merchant_profile_photos('d2510000-0000-4000-8000-000000000001',null,null,null,now())$$,'42501',null,'anonymous has no save permission');
reset role;
update private.merchants set consent='revoked' where id='d2510000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_city_business_map_photos('map-photo-test'),'[]'::jsonb,'revoked/nonpublic business images never reach public map');
reset role;
select is(public.get_business_public_media('d2510000-0000-4000-8000-000000000001','map',0,null),null::jsonb,'media delivery also rechecks revoked public visibility');
update private.merchants set consent='granted' where id='d2510000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims','{"sub":"d2500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_my_business_chat_profiles()->'merchants'->0->>'avatar_path',
 'business-profile/d2510000-0000-4000-8000-000000000001/avatar/'||md5('d2500000-0000-4000-8000-000000000001/d2510000-0000-4000-8000-000000000001_d2520000-0000-4000-8000-000000000002.webp'),'connected operator gets same opaque business logo');
select is(jsonb_array_length(public.get_my_business_chat_profiles()->'merchants'),1,'operator account sheet excludes unrelated businesses');
select is(public.save_my_merchant_profile_photos('d2510000-0000-4000-8000-000000000001',null,null,null,
 (public.get_my_merchant_profile('d2510000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)->'map_photo_path','null'::jsonb,'connected verified operator can remove photo under current can_edit policy');
reset role;
select is(public.get_city_business_map_photos('map-photo-test'),'[]'::jsonb,'removed representative photo returns place fallback');
select set_config('request.jwt.claims','{"sub":"d2500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.save_my_merchant_profile_photos('d2510000-0000-4000-8000-000000000001',null,null,null,now())$$,'P0001','MERCHANT_ACCESS_REQUIRED','unconnected enabled account cannot use idempotent save');
select ok(not exists(select 1 from jsonb_array_elements(public.get_my_business_chat_profiles()->'merchants') x where x->>'id'='d2510000-0000-4000-8000-000000000001'),'unconnected account cannot read another business account-sheet logo');
reset role;
select set_config('request.jwt.claims','{"sub":"d2500000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"role":"admin"},"aal":"aal1"}',true);
set local role authenticated;
select throws_ok($$select public.save_my_merchant_profile_photos('d2510000-0000-4000-8000-000000000001',null,null,null,now())$$,'P0001','ADMIN_REQUIRED','admin review role without verified MFA cannot impersonate editor');
reset role;
select set_config('request.jwt.claims','{"sub":"d2500000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"role":"admin"},"aal":"aal2","session_id":"d2590000-0000-4000-8000-000000000004"}',true);
set local role authenticated;
select is(public.get_my_business_chat_profiles()->'merchants','[]'::jsonb,'verified admin review access alone reveals no account-sheet business identities or logos');
reset role;
-- A deleted operator's uploaded photo belongs to the business, not the operator account.
insert into storage.objects(bucket_id,name,owner_id,metadata) values ('merchant-profile-images',
 'd2500000-0000-4000-8000-000000000002/d2510000-0000-4000-8000-000000000001_d2520000-0000-4000-8000-000000000004.webp',
 'd2500000-0000-4000-8000-000000000002','{"mimetype":"image/webp","size":24}');
select set_config('request.jwt.claims','{"sub":"d2500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.save_my_merchant_profile_photos('d2510000-0000-4000-8000-000000000001',null,null,
 'd2500000-0000-4000-8000-000000000002/d2510000-0000-4000-8000-000000000001_d2520000-0000-4000-8000-000000000004.webp',
 (public.get_my_merchant_profile('d2510000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)$$,'operator can bind their own uploaded map image');
reset role;
select is(public.account_image_cleanup_paths('d2500000-0000-4000-8000-000000000002','merchant-profile-images',array[
 'd2500000-0000-4000-8000-000000000002/d2510000-0000-4000-8000-000000000001_d2520000-0000-4000-8000-000000000004.webp']),array[]::text[],'account cleanup retains an operator-uploaded image bound to another owner');
select is((select owner_id from storage.objects where name='d2500000-0000-4000-8000-000000000002/d2510000-0000-4000-8000-000000000001_d2520000-0000-4000-8000-000000000004.webp'),null::text,'cleanup detaches private uploader identity');
update public.profiles set account_status='deleted' where id='d2500000-0000-4000-8000-000000000002';
select ok((select map_photo_path is not null from private.merchants where id='d2510000-0000-4000-8000-000000000001'),'operator deletion preserves the business map photo');
update public.profiles set account_status='deleted' where id='d2500000-0000-4000-8000-000000000001';
select ok((select map_photo_path is null and avatar_path is null and banner_path is null from private.merchants where id='d2510000-0000-4000-8000-000000000001'),'owner erasure clears all three photo roles');
select * from finish();
rollback;
