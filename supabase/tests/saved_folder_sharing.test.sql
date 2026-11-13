begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('sfs-test','Folder test','BC','America/Vancouver',true);
insert into auth.users(id,email) values
 ('e5170000-0000-4000-8000-000000000001','sfs-owner@example.test'),
 ('e5170000-0000-4000-8000-000000000002','sfs-friend@example.test'),
 ('e5170000-0000-4000-8000-000000000003','sfs-stranger@example.test'),
 ('e5170000-0000-4000-8000-000000000004','sfs-blocker@example.test'),
 ('e5170000-0000-4000-8000-000000000005','sfs-hidden-owner@example.test');
insert into public.profiles(id,nickname,city_id) values
 ('e5170000-0000-4000-8000-000000000001','폴더주인','sfs-test'),
 ('e5170000-0000-4000-8000-000000000002','친구','sfs-test'),
 ('e5170000-0000-4000-8000-000000000003','모르는사람','sfs-test'),
 ('e5170000-0000-4000-8000-000000000004','차단한친구','sfs-test'),
 ('e5170000-0000-4000-8000-000000000005','숨김주인','sfs-test');
-- The friend is friends with both owners; the blocker blocked the owner, then the friendship row is put back to prove the pair check.
insert into private.friendships(user_low_id,user_high_id,requester_id,created_at,accepted_at) values
 ('e5170000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000002','e5170000-0000-4000-8000-000000000001',now()-interval '1 day',now()),
 ('e5170000-0000-4000-8000-000000000002','e5170000-0000-4000-8000-000000000005','e5170000-0000-4000-8000-000000000002',now()-interval '1 day',now());
insert into public.blocks(blocker_id,blocked_id) values('e5170000-0000-4000-8000-000000000004','e5170000-0000-4000-8000-000000000001');
insert into private.friendships(user_low_id,user_high_id,requester_id,created_at,accepted_at) values
 ('e5170000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000004','e5170000-0000-4000-8000-000000000001',now()-interval '1 day',now());
insert into private.profile_sharing(user_id,saved_places_to_friends) values('e5170000-0000-4000-8000-000000000005',false);
insert into private.saved_places(user_id,city_id,place_key) values
 ('e5170000-0000-4000-8000-000000000001','sfs-test','osm:node:830001'),
 ('e5170000-0000-4000-8000-000000000005','sfs-test','osm:node:830001');
insert into private.saved_users(user_id,target_user_id) values('e5170000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000003');
-- A folder made before this change: no visibility given.
insert into private.saved_folders(id,user_id,name) values
 ('e5180000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000001','예전 폴더'),
 ('e5180000-0000-4000-8000-000000000002','e5170000-0000-4000-8000-000000000001','같이 볼 곳'),
 ('e5180000-0000-4000-8000-000000000003','e5170000-0000-4000-8000-000000000001','사람만'),
 ('e5180000-0000-4000-8000-000000000005','e5170000-0000-4000-8000-000000000005','숨김 주인 폴더');
update private.saved_folders set visibility='friends' where id in ('e5180000-0000-4000-8000-000000000002','e5180000-0000-4000-8000-000000000003','e5180000-0000-4000-8000-000000000005');
insert into private.saved_folder_items(user_id,folder_id,place_city_id,place_key,person_id) values
 ('e5170000-0000-4000-8000-000000000001','e5180000-0000-4000-8000-000000000001','sfs-test','osm:node:830001',null),
 ('e5170000-0000-4000-8000-000000000001','e5180000-0000-4000-8000-000000000002','sfs-test','osm:node:830001',null),
 ('e5170000-0000-4000-8000-000000000001','e5180000-0000-4000-8000-000000000002',null,null,'e5170000-0000-4000-8000-000000000003'),
 ('e5170000-0000-4000-8000-000000000001','e5180000-0000-4000-8000-000000000003',null,null,'e5170000-0000-4000-8000-000000000003'),
 ('e5170000-0000-4000-8000-000000000005','e5180000-0000-4000-8000-000000000005','sfs-test','osm:node:830001',null);

select is((select visibility from private.saved_folders where id='e5180000-0000-4000-8000-000000000001'),'private','a folder made before the change stays private');
select ok(not has_function_privilege('anon','public.get_saved_folder(uuid)','execute') and not has_function_privilege('anon','public.get_friend_saved_folders(uuid)','execute'),
 'visitors who are not signed in cannot read folders');
select ok(exists(select 1 from pg_class where oid='private.saved_folders'::regclass and relrowsecurity),'folders keep row level security');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select * from private.saved_folders$$,'42501',null,'members cannot read the folder table directly');
select is(public.create_saved_folder('옛 앱 폴더')->>'name','옛 앱 폴더','an old app can still create a folder');
select is((public.get_saved_folders()->-1)->>'visibility','private','and it is private, as the old app says');
select is(public.save_saved_folder(null,'새 폴더','friends')->>'visibility','friends','a new app creates a folder for friends');
select is((public.get_saved_folder('e5180000-0000-4000-8000-000000000002')->>'role'),'owner','the owner opens their own folder');

select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.get_saved_folder('e5180000-0000-4000-8000-000000000002')->>'role','viewer','a friend sees a folder for friends');
select is(jsonb_array_length(public.get_saved_folder('e5180000-0000-4000-8000-000000000002')->'places'),1,'only the place shows, not the saved person');
select throws_ok($$select public.get_saved_folder('e5180000-0000-4000-8000-000000000001')$$,'P0001','FOLDER_UNAVAILABLE','a friend cannot open a private folder');
select throws_ok($$select public.get_saved_folder('e5180000-0000-4000-8000-000000000005')$$,'P0001','FOLDER_UNAVAILABLE','a folder of someone who hides saved places stays hidden');
select is((select jsonb_agg(x->>'name') from jsonb_array_elements(public.get_friend_saved_folders('e5170000-0000-4000-8000-000000000001')) x),'["같이 볼 곳"]'::jsonb,
 'the profile lists only folders for friends that have a place to show');
select is(public.get_friend_saved_folders('e5170000-0000-4000-8000-000000000005'),'[]'::jsonb,'nothing from an owner who hides saved places');
select throws_ok($$select public.save_saved_folder('e5180000-0000-4000-8000-000000000002','바꿈','private')$$,'P0001','FOLDER_UNAVAILABLE','a friend cannot change someone else''s folder');
select throws_ok($$select public.save_saved_folder(null,' ','friends')$$,'P0001','INVALID_SAVED_FOLDER','a blank name is refused');

select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.get_saved_folder('e5180000-0000-4000-8000-000000000002')$$,'P0001','FOLDER_UNAVAILABLE','someone who is not a friend cannot open it');
select is(public.get_friend_saved_folders('e5170000-0000-4000-8000-000000000001'),'[]'::jsonb,'nor see the folder list');

select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.get_saved_folder('e5180000-0000-4000-8000-000000000002')$$,'P0001','FOLDER_UNAVAILABLE','a blocked pair cannot open it');
select is(public.get_friend_saved_folders('e5170000-0000-4000-8000-000000000001'),'[]'::jsonb,'nor see the folder list');

select * from finish();
rollback;
