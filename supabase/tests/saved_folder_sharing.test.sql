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
insert into private.saved_places(user_id,city_id,place_key,created_at) values
 ('e5170000-0000-4000-8000-000000000001','sfs-test','osm:node:830001',now()),
 ('e5170000-0000-4000-8000-000000000001','sfs-test','osm:node:830002',now()-interval '1 hour'),
 ('e5170000-0000-4000-8000-000000000001','sfs-test','osm:node:830003',now()-interval '2 hours'),
 ('e5170000-0000-4000-8000-000000000005','sfs-test','osm:node:830001',now());
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
 ('e5170000-0000-4000-8000-000000000001','e5180000-0000-4000-8000-000000000002','sfs-test','osm:node:830002',null),
 ('e5170000-0000-4000-8000-000000000001','e5180000-0000-4000-8000-000000000002',null,null,'e5170000-0000-4000-8000-000000000003'),
 ('e5170000-0000-4000-8000-000000000001','e5180000-0000-4000-8000-000000000003',null,null,'e5170000-0000-4000-8000-000000000003'),
 ('e5170000-0000-4000-8000-000000000005','e5180000-0000-4000-8000-000000000005','sfs-test','osm:node:830001',null);

select is((select visibility from private.saved_folders where id='e5180000-0000-4000-8000-000000000001'),'private','a folder made before the change stays private');
select ok(not has_function_privilege('anon','public.get_saved_folder(uuid)','execute') and not has_function_privilege('anon','public.get_friend_saved_folders(uuid)','execute'),
 'visitors who are not signed in cannot read folders');
select ok(exists(select 1 from pg_class where oid='private.saved_folders'::regclass and relrowsecurity),'folders keep row level security');
select ok(exists(select 1 from pg_class where oid='private.saved_item_notes'::regclass and relrowsecurity)
 and not has_table_privilege('authenticated','private.saved_item_notes','select') and not has_table_privilege('anon','private.saved_item_notes','select'),
 'memos have row level security and no direct read grant');
select ok(not has_function_privilege('anon','public.set_saved_note(text,text,text,text)','execute'),'visitors cannot write memos');
select ok(not has_function_privilege('anon','public.get_place_friend_folders(text,text)','execute'),'visitors cannot list friend folders on a place');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select * from private.saved_folders$$,'42501',null,'members cannot read the folder table directly');
select is(public.create_saved_folder('옛 앱 폴더')->>'name','옛 앱 폴더','an old app can still create a folder');
select is((public.get_saved_folders()->-1)->>'visibility','private','and it is private, as the old app says');
select is(public.save_saved_folder(null,'새 폴더','friends',null)->>'visibility','friends','a new app creates a folder for friends');
select is((public.get_saved_folder('e5180000-0000-4000-8000-000000000002')->>'role'),'owner','the owner opens their own folder');
select is(public.save_saved_folder('e5180000-0000-4000-8000-000000000002','같이 볼 곳','friends','  주말에 걷기 좋은 곳  ')->>'description','주말에 걷기 좋은 곳','a description is saved trimmed');
select throws_ok($$select public.save_saved_folder(null,'긴 설명','friends',repeat('가',151))$$,'P0001','INVALID_SAVED_FOLDER','a description over 150 letters is refused');
select throws_ok($$select public.save_saved_folder(null,'줄바꿈','friends',E'첫 줄\n둘째 줄')$$,'P0001','INVALID_SAVED_FOLDER','a description with a line break is refused');
select is(public.save_saved_folder(null,'빈 설명','private','   ')->'description','null'::jsonb,'a blank description is stored as none');
select is(public.get_saved_folder('e5180000-0000-4000-8000-000000000002')->'cover'->>'placeKey','osm:node:830001','with no pick the newest place is the cover');
select is(public.set_saved_folder_cover('e5180000-0000-4000-8000-000000000002','sfs-test','osm:node:830002')->'cover'->>'placeKey','osm:node:830002','the owner picks a place in the folder as the cover');
select throws_ok($$select public.set_saved_folder_cover('e5180000-0000-4000-8000-000000000002','sfs-test','osm:node:830003')$$,'P0001','FOLDER_COVER_UNAVAILABLE','a saved place outside the folder cannot be the cover');
select throws_ok($$select public.set_saved_folder_cover('e5180000-0000-4000-8000-000000000002','sfs-test',null)$$,'P0001','INVALID_SAVED_FOLDER_COVER','a half cover is refused');
select is(public.set_saved_note('place','osm:node:830001','  창가 자리가 좋아요  ','sfs-test')->>'note','창가 자리가 좋아요','the owner writes a memo on a saved place');
-- This test city has no place catalog rows, so the list shows the saved person; a memo rides on any saved card the same way.
select is(public.set_saved_note('user','e5170000-0000-4000-8000-000000000003','동네 모임에서 만남',null)->>'note','동네 모임에서 만남','a memo on a saved person');
select is((select x->>'note' from jsonb_array_elements(public.get_saved_items()->'items') x where x->'target'->>'id'='e5170000-0000-4000-8000-000000000003'),'동네 모임에서 만남',
 'the memo comes back on the owner''s saved list');
select throws_ok($$select public.set_saved_note('place','osm:node:830009','메모','sfs-test')$$,'P0001','SAVED_TARGET_UNAVAILABLE','an item that is not saved takes no memo');
select throws_ok($$select public.set_saved_note('place','osm:node:830001',repeat('가',201),'sfs-test')$$,'P0001','INVALID_SAVED_NOTE','a memo over 200 letters is refused');
select throws_ok($$select public.set_saved_note('place','osm:node:830001',E'첫 줄\n둘째 줄','sfs-test')$$,'P0001','INVALID_SAVED_NOTE','a memo with a line break is refused');
select throws_ok($$select * from private.saved_item_notes$$,'42501',null,'members cannot read the memo table directly');
select is(public.set_saved_note('place','osm:node:830003','지울 메모','sfs-test')->>'note','지울 메모','a memo on another saved place');

select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.get_saved_folder('e5180000-0000-4000-8000-000000000002')->>'role','viewer','a friend sees a folder for friends');
select is(jsonb_array_length(public.get_saved_folder('e5180000-0000-4000-8000-000000000002')->'places'),2,'only the places show, not the saved person');
select is(public.get_saved_folder('e5180000-0000-4000-8000-000000000002')->>'description','주말에 걷기 좋은 곳','a friend reads the description');
select is((select jsonb_agg(jsonb_build_array(x->>'name',x->'owner'->>'nickname')) from jsonb_array_elements(public.get_place_friend_folders('sfs-test','osm:node:830001')) x),
 '[["같이 볼 곳","폴더주인"]]'::jsonb,'the place screen lists only the friend folder shared with friends, not a private one or one whose owner hides saved places');
select is(public.get_place_friend_folders('sfs-test','osm:node:830003'),'[]'::jsonb,'a place in no friend folder lists none');
select throws_ok($$select public.get_place_friend_folders('sfs-test','../830001')$$,'P0001','INVALID_SAVED_TARGET','a malformed place key is refused');
select ok(strpos(public.get_saved_folder('e5180000-0000-4000-8000-000000000002')::text,'창가')=0
 and strpos(public.get_friend_saved_folders('e5170000-0000-4000-8000-000000000001')::text,'창가')=0
 and strpos(public.get_saved_folder('e5180000-0000-4000-8000-000000000002')::text,'동네 모임')=0,'a friend never sees the owner''s memo in a shared folder');
select throws_ok($$select public.set_saved_note('place','osm:node:830001','덮어쓰기','sfs-test')$$,'P0001','SAVED_TARGET_UNAVAILABLE',
 'a friend cannot write on the owner''s item');
select ok(strpos(public.get_saved_items()::text,'창가')=0,'and the friend''s own list has no memo of the owner''s');
select is((public.get_friend_saved_folders('e5170000-0000-4000-8000-000000000001')->0)->'cover'->>'placeKey','osm:node:830002','and sees the picked cover on the profile');
select throws_ok($$select public.set_saved_folder_cover('e5180000-0000-4000-8000-000000000002',null,null)$$,'P0001','FOLDER_UNAVAILABLE','a friend cannot change the cover');
select throws_ok($$select public.get_saved_folder('e5180000-0000-4000-8000-000000000001')$$,'P0001','FOLDER_UNAVAILABLE','a friend cannot open a private folder');
select throws_ok($$select public.get_saved_folder('e5180000-0000-4000-8000-000000000005')$$,'P0001','FOLDER_UNAVAILABLE','a folder of someone who hides saved places stays hidden');
select is((select jsonb_agg(x->>'name') from jsonb_array_elements(public.get_friend_saved_folders('e5170000-0000-4000-8000-000000000001')) x),'["같이 볼 곳"]'::jsonb,
 'the profile lists only folders for friends that have a place to show');
select is(public.get_friend_saved_folders('e5170000-0000-4000-8000-000000000005'),'[]'::jsonb,'nothing from an owner who hides saved places');
select throws_ok($$select public.save_saved_folder('e5180000-0000-4000-8000-000000000002','바꿈','private',null)$$,'P0001','FOLDER_UNAVAILABLE','a friend cannot change someone else''s folder');
select throws_ok($$select public.save_saved_folder(null,' ','friends',null)$$,'P0001','INVALID_SAVED_FOLDER','a blank name is refused');

select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.get_saved_folder('e5180000-0000-4000-8000-000000000002')$$,'P0001','FOLDER_UNAVAILABLE','someone who is not a friend cannot open it');
select is(public.get_place_friend_folders('sfs-test','osm:node:830001'),'[]'::jsonb,'nor find it from the place screen');
select is(public.get_friend_saved_folders('e5170000-0000-4000-8000-000000000001'),'[]'::jsonb,'nor see the folder list');

select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.get_saved_folder('e5180000-0000-4000-8000-000000000002')$$,'P0001','FOLDER_UNAVAILABLE','a blocked pair cannot open it');
select is(public.get_place_friend_folders('sfs-test','osm:node:830001'),'[]'::jsonb,'nor find it from the place screen');
select is(public.get_friend_saved_folders('e5170000-0000-4000-8000-000000000001'),'[]'::jsonb,'nor see the folder list');

reset role;
delete from private.saved_folder_items where folder_id='e5180000-0000-4000-8000-000000000002' and place_key='osm:node:830002';
select is((select private.saved_folder_json(f)->'cover'->>'placeKey' from private.saved_folders f where id='e5180000-0000-4000-8000-000000000002'),'osm:node:830001',
 'once the picked place leaves the folder, the newest place is the cover again');


-- An unsaved item's memo goes away the next time the owner writes one.
delete from private.saved_places where user_id='e5170000-0000-4000-8000-000000000001' and place_key='osm:node:830003';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.set_saved_note('place','osm:node:830002','두 번째 메모','sfs-test')->>'note','두 번째 메모','the owner writes another memo');
select is(public.set_saved_note('place','osm:node:830002','  ','sfs-test')->'note','null'::jsonb,'a blank memo deletes it');
reset role;
select is((select array_agg(saved_key order by saved_key) from private.saved_item_notes where user_id='e5170000-0000-4000-8000-000000000001'),
 array['place:sfs-test:osm:node:830001','user:sfs-test:e5170000-0000-4000-8000-000000000003'],'only memos on still-saved items are left');
update public.profiles set account_status='deleted' where id='e5170000-0000-4000-8000-000000000001';
select is((select count(*)::integer from private.saved_item_notes where user_id='e5170000-0000-4000-8000-000000000001'),0,'deleting the account erases its memos');

select * from finish();
rollback;
