begin;
set local search_path=public,extensions;
select no_plan();
insert into public.tags(id,slug,label,kind) values(1,'life','생활','post'),(18,'jobs','구인구직','post') on conflict do nothing;
insert into public.cities values('saved-test','Saved test','BC','America/Vancouver',true),('saved-other','Other','BC','America/Vancouver',true);
insert into auth.users(id,email) values
 ('e2300000-0000-4000-8000-000000000001','saved-owner@example.test'),
 ('e2300000-0000-4000-8000-000000000002','saved-person@example.test'),
 ('e2300000-0000-4000-8000-000000000003','saved-other@example.test');
update auth.users set raw_app_meta_data='{"merchant_enabled":true}' where id='e2300000-0000-4000-8000-000000000002';
insert into public.profiles(id,nickname,city_id) values
 ('e2300000-0000-4000-8000-000000000001','SavedOwner','saved-test'),
 ('e2300000-0000-4000-8000-000000000002','SavedPerson','saved-test'),
 ('e2300000-0000-4000-8000-000000000003','SavedOther','saved-test');
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,owner_id,owner_verified_at) values
 ('e2310000-0000-4000-8000-000000000001','Saved branch one','saved-test','trial','granted','Synthetic rollback fixture','business','e2300000-0000-4000-8000-000000000002',now()),
 ('e2310000-0000-4000-8000-000000000002','Saved branch two','saved-other','trial','granted','Synthetic rollback fixture','business','e2300000-0000-4000-8000-000000000002',now());
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
 ('e2330000-0000-4000-8000-000000000001','e2300000-0000-4000-8000-000000000002','saved-test',1,'Saved post','Visible saved body'),
 ('e2330000-0000-4000-8000-000000000002','e2300000-0000-4000-8000-000000000002','saved-test',(select id from public.tags where slug='jobs'),'Saved job','Hiring saved body');
update public.posts set body='Hiring '||repeat('x',3300)||' LateBodyNeedle',hashtags=array['LateTagNeedle'] where id='e2330000-0000-4000-8000-000000000002';
insert into private.city_place_catalog(id,payload,refreshed_on) values(true,'{"cities":{"saved-test":{"places":[{"id":"osm:node:700001","cityId":"saved-test","name":"Saved cafe","address":"Test address","category":"cafe","latitude":49.2,"longitude":-123.1,"sourceUrl":"https://www.openstreetmap.org/node/700001"},{"id":"osm:node:700002","cityId":"saved-test","name":"Second cafe","address":"Second address","category":"cafe","latitude":49.3,"longitude":-123.2,"sourceUrl":"https://www.openstreetmap.org/node/700002"}]}},"collectedAt":"2026-10-23T00:00:00Z"}',current_date)
 on conflict(id) do update set payload=excluded.payload;
update private.city_place_catalog set payload=jsonb_set(payload,'{cities,saved-test,places}',payload#>'{cities,saved-test,places}'||
 '[{"id":"osm:node:700004","cityId":"saved-test","name":"","address":"Invalid catalog entry","category":"cafe","latitude":49.2,"longitude":-123.1,"sourceUrl":"https://www.openstreetmap.org/node/700004"}]'::jsonb);
create function pg_temp.owned_rows() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('merchants',(select count(*) from private.saved_merchants where user_id='e2300000-0000-4000-8000-000000000001'),
 'places',(select count(*) from private.saved_places where user_id='e2300000-0000-4000-8000-000000000001'),
 'members',(select count(*) from private.saved_folder_items where user_id='e2300000-0000-4000-8000-000000000001'))
$$;
select set_config('request.jwt.claims','{"sub":"e2300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_saved_items()->'items','[]'::jsonb,'new owner has no saved rows');
select is(public.set_saved_item('place','osm:node:700001',true,'saved-test')->>'saved','true','known exact catalog place can be saved');
select is(public.get_saved_item_state('place','osm:node:700001','saved-test')->'target'->>'kind','place','unlinked catalog place stays a place');
select throws_ok($$select public.set_saved_item('place','osm:node:999999',true,'saved-test')$$,'P0001','SAVED_TARGET_UNAVAILABLE','OSM grammar alone is insufficient');
select throws_ok($$select public.set_saved_item('place','partner:invented',true,'saved-test')$$,'P0001','SAVED_TARGET_UNAVAILABLE','arbitrary partner rejected');
select throws_ok($$select public.set_saved_item('place','osm:node:700001',true,'saved-other')$$,'P0001','SAVED_TARGET_UNAVAILABLE','wrong catalog city rejected');
select is(public.get_saved_item_state('place','partner:on-and-off-coquitlam','vancouver')->>'available','true','known static partner is server registered');
select is(public.get_saved_item_state('place','osm:node:700004','saved-test')->>'available','false','malformed catalog entry cannot become a saved target');
select ok(not has_table_privilege('authenticated','private.saved_users','select'),'saved people are not directly readable');
select ok(not has_function_privilege('anon','public.get_saved_items(text,text,uuid,timestamptz,text)','execute'),'anonymous library read is not granted');
select set_config('test.saved_folder',(public.create_saved_folder('Food')->>'id'),true);
select set_config('request.jwt.claims','{"sub":"e2300000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok(format('select public.rename_saved_folder(%L::uuid,%L)',current_setting('test.saved_folder'),'Stolen'),'P0001','FOLDER_UNAVAILABLE','live foreign folder cannot be renamed');
select set_config('test.foreign_folder',(public.create_saved_folder('Other owner')->>'id'),true);
select set_config('request.jwt.claims','{"sub":"e2300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.set_saved_item_folders('place','osm:node:700001',array[current_setting('test.saved_folder')::uuid],'saved-test'),true,'place folder assigned');
select throws_ok(format('select public.set_saved_item_folders(%L,%L,array[%L::uuid,%L::uuid],%L)','place','osm:node:700001',current_setting('test.saved_folder'),current_setting('test.foreign_folder'),'saved-test'),'P0001','FOLDER_UNAVAILABLE','mixed owned/foreign folder replacement fails');
select is(pg_temp.owned_rows()->>'members','1','failed folder replacement preserves previous membership');
select is(jsonb_array_length(public.get_saved_items(p_folder_id=>current_setting('test.saved_folder')::uuid)->'items'),1,'folder filters owned saved place');
reset role;
insert into private.webshop_place_links(place_key,merchant_id,city_id) values('osm:node:700001','e2310000-0000-4000-8000-000000000001','saved-test');
set local role authenticated;
select is(public.get_saved_item_state('place','osm:node:700001','saved-test')->'target'->>'id','e2310000-0000-4000-8000-000000000001','future link resolves canonical branch');
select is(public.get_merchant_profile('e2310000-0000-4000-8000-000000000001')->>'saved','true','legacy profile flag includes pre-link place save');
select is(jsonb_array_length(public.get_saved_merchants()->'merchants'),1,'legacy saved merchants includes future link');
select is(pg_temp.owned_rows()->>'merchants','0','getters never materialize merchant bookmarks');
select is(jsonb_array_length(public.get_saved_item_state('merchant','e2310000-0000-4000-8000-000000000001')->'folderIds'),1,'folder follows canonical alias');
select set_config('test.saved_at',public.get_saved_item_state('merchant','e2310000-0000-4000-8000-000000000001')->>'savedAt',true);
select is(public.set_saved_merchant('e2310000-0000-4000-8000-000000000001',true),true,'legacy save true is idempotent across alias');
select is(public.get_saved_item_state('merchant','e2310000-0000-4000-8000-000000000001')->>'savedAt',current_setting('test.saved_at'),'idempotence does not reorder');
select is(public.get_merchant_profile('e2310000-0000-4000-8000-000000000001')->>'notifications_enabled','false','link never opts in to updates');
select is(public.set_saved_merchant_notifications('e2310000-0000-4000-8000-000000000001',true),true,'explicit opt-in works for alias-only bookmark');
select is(public.get_saved_item_state('merchant','e2310000-0000-4000-8000-000000000001')->>'savedAt',current_setting('test.saved_at'),'opt-in preserves save date');
select is(jsonb_array_length(public.get_saved_items()->'items'),1,'place and materialized notification row remain one card');
select is(public.get_merchant_profile('e2310000-0000-4000-8000-000000000001')->>'notifications_enabled','true','explicit opt-in remains separate');
select is(public.set_saved_item('place','osm:node:700002',true,'saved-test')->>'saved','true','second unlinked alias is saved independently');
select set_config('test.second_folder',(public.create_saved_folder('Second collection')->>'id'),true);
select is(public.set_saved_item_folders('place','osm:node:700002',array[current_setting('test.second_folder')::uuid],'saved-test'),true,'second alias gets its own collection before linking');
reset role;
insert into private.webshop_place_links(place_key,merchant_id,city_id) values('osm:node:700002','e2310000-0000-4000-8000-000000000001','saved-test'),
 ('osm:node:700003','e2310000-0000-4000-8000-000000000002','saved-other');
set local role authenticated;
select is(jsonb_array_length(public.get_saved_items(p_filter=>'places')->'items'),1,'two source places and company coalesce after link');
select is(jsonb_array_length(public.get_saved_item_state('merchant','e2310000-0000-4000-8000-000000000001')->'folderIds'),2,'independent folders union across future-linked aliases');
select is(public.get_saved_item_state('place','osm:node:700003','saved-other')->>'available','true','authoritative branch link validates its exact city without a map-list insertion');
select throws_ok($$select public.set_saved_item('place','osm:node:700003',true,'saved-test')$$,'P0001','SAVED_TARGET_UNAVAILABLE','conflicting cross-city branch link rejected');
select is(public.set_saved_merchant('e2310000-0000-4000-8000-000000000002',true),true,'separate branch saved independently');
select is(jsonb_array_length(public.get_saved_items(p_filter=>'places')->'items'),2,'different merchant branches never merge');
select is(public.set_saved_merchant('e2310000-0000-4000-8000-000000000002',false),false,'separate branch can be removed independently');
select is(public.get_saved_item_state('merchant','e2310000-0000-4000-8000-000000000001')->>'saved','true','other branch unsave retains first branch');
select is(public.set_saved_item_folders('merchant','e2310000-0000-4000-8000-000000000001','{}'),true,'folder replacement through merchant clears all aliases');
select is(pg_temp.owned_rows()->>'members','0','no hidden alias folder membership remains');
select is(public.set_saved_merchant('e2310000-0000-4000-8000-000000000001',false),false,'old unsave clears canonical branch');
select is(pg_temp.owned_rows()->>'places','0','old unsave removes pre-link place backing row');
select is(public.set_saved_item('user','e2300000-0000-4000-8000-000000000002',true)->>'saved','true','public person can be privately saved');
select is(public.set_saved_item('post','e2330000-0000-4000-8000-000000000001',true)->>'saved','true','post reuses existing save relation');
select is(public.set_saved_item('post','e2330000-0000-4000-8000-000000000002',true)->>'saved','true','job reuses existing post save');
select is(jsonb_array_length(public.get_saved_items(p_filter=>'jobs')->'items'),1,'jobs filter');
select is(jsonb_array_length(public.get_saved_items(p_filter=>'posts')->'items'),1,'posts exclude jobs');
select is(jsonb_array_length(public.get_saved_items(p_query=>'hiring')->'items'),1,'literal public body search');
select is(jsonb_array_length(public.get_saved_items(p_query=>'LateBodyNeedle')->'items'),1,'search includes visible body beyond compact preview');
select is(jsonb_array_length(public.get_saved_items(p_query=>'LateTagNeedle')->'items'),1,'search includes visible saved post hashtags');
reset role;
insert into public.blocks(blocker_id,blocked_id) values('e2300000-0000-4000-8000-000000000002','e2300000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.get_saved_item_state('user','e2300000-0000-4000-8000-000000000002')->>'available','false','reverse block hides saved person through public helper');
select is(jsonb_array_length(public.get_saved_items()->'items'),0,'reverse block hides saved author posts and person');
select throws_ok($$select public.set_saved_item('user','e2300000-0000-4000-8000-000000000002',true)$$,'P0001','SAVED_TARGET_UNAVAILABLE','hidden person cannot be saved again');
select throws_ok(format('select public.set_saved_item_folders(%L,%L,array[%L::uuid])','user','e2300000-0000-4000-8000-000000000002',current_setting('test.saved_folder')),'P0001','SAVED_TARGET_UNAVAILABLE','hidden person cannot be newly organized into a folder');
select throws_ok($$select public.set_saved_item('post','e2330000-0000-4000-8000-000000000001',true)$$,'P0001','SAVED_TARGET_UNAVAILABLE','hidden post cannot be saved again');
reset role;
delete from public.blocks where blocker_id='e2300000-0000-4000-8000-000000000002' and blocked_id='e2300000-0000-4000-8000-000000000001';
delete from public.reports where reporter_id='e2300000-0000-4000-8000-000000000002' and reported_user_id='e2300000-0000-4000-8000-000000000001';
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code,details) values
 ('e2300000-0000-4000-8000-000000000001','e2300000-0000-4000-8000-000000000002','user','e2300000-0000-4000-8000-000000000002','other','Synthetic private hide');
set local role authenticated;
select is(public.get_saved_item_state('user','e2300000-0000-4000-8000-000000000002')->>'available',(public.get_public_user_profile('e2300000-0000-4000-8000-000000000002') is not null)::text,'reported person matches current public helper visibility');
select is(jsonb_array_length(public.get_saved_items(p_filter=>'users')->'items'),0,'report-hidden person not resurrected by save list');
reset role;
delete from public.reports where reporter_id='e2300000-0000-4000-8000-000000000001' and target_type='user' and target_id='e2300000-0000-4000-8000-000000000002';
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at)
select ('e2340000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'e2300000-0000-4000-8000-000000000003','saved-test',1,'Paging '||g,'Synthetic page',now()-g*interval '1 day' from generate_series(1,33)g;
insert into public.post_reactions(post_id,user_id,kind,created_at)
select id,'e2300000-0000-4000-8000-000000000001','save','2020-01-01T00:00:00Z' from public.posts where title like 'Paging %';
set local role authenticated;
select set_config('test.page_one',public.get_saved_items(p_query=>'Paging')::text,true);
select set_config('test.page_two',public.get_saved_items(p_query=>'Paging',
 p_before_saved_at=>(current_setting('test.page_one')::jsonb->'nextCursor'->>'savedAt')::timestamptz,
 p_before_key=>current_setting('test.page_one')::jsonb->'nextCursor'->>'key')::text,true);
select is(jsonb_array_length(current_setting('test.page_one')::jsonb->'items'),30,'keyset first page bounded');
select is(jsonb_array_length(current_setting('test.page_two')::jsonb->'items'),3,'equal-timestamp remainder reached');
select is(current_setting('test.page_one')::jsonb->'items'->0->>'title','Paging 33','save-date tie orders by key, not post creation');
select is((select count(*) from jsonb_array_elements(current_setting('test.page_one')::jsonb->'items')a
 join jsonb_array_elements(current_setting('test.page_two')::jsonb->'items')b on a->>'key'=b->>'key'),0::bigint,'equal savedAt pages do not overlap');
reset role;
delete from public.post_reactions where user_id='e2300000-0000-4000-8000-000000000001' and post_id in(select id from public.posts where title like 'Paging %');
set local role authenticated;
select is(public.set_saved_item_folders('post','e2330000-0000-4000-8000-000000000001',array[current_setting('test.saved_folder')::uuid]),true,'post folder uses actual save FK');
delete from public.post_reactions where post_id='e2330000-0000-4000-8000-000000000001' and user_id=auth.uid() and kind='save';
select is(pg_temp.owned_rows()->>'members','0','old direct post unsave cascades folder membership');
select is(public.delete_saved_folder(current_setting('test.saved_folder')::uuid),true,'folder can be deleted');
select is(public.get_saved_item_state('user','e2300000-0000-4000-8000-000000000002')->>'saved','true','folder deletion preserves saved people');
select set_config('request.jwt.claims','{"sub":"e2300000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is(public.get_saved_items()->'items','[]'::jsonb,'owner isolation');
select throws_ok(format('select public.rename_saved_folder(%L::uuid,%L)',current_setting('test.saved_folder'),'Mine'),'P0001','FOLDER_UNAVAILABLE','foreign or removed folder cannot mutate');
select set_config('request.jwt.claims','{"sub":"e2300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
reset role;
update public.profiles set account_status='suspended' where id='e2300000-0000-4000-8000-000000000002';
set local role authenticated;
select is(jsonb_array_length(public.get_saved_items()->'items'),0,'inactive person and their posts are hidden');
select is(public.set_saved_item('user','e2300000-0000-4000-8000-000000000002',false)->>'saved','false','unavailable person can still be unsaved');
select * from finish();
rollback;
