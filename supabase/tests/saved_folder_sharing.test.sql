begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('sfs-test','Folder test','BC','America/Vancouver',true);
-- The test city's places in the app catalog, so saved cards (and copies, which skip what the app cannot show) resolve.
insert into private.city_place_catalog(payload,refreshed_on) values(jsonb_build_object('collectedAt','2026-11-13','cities',jsonb_build_object('sfs-test',jsonb_build_object('places',
 (select jsonb_agg(jsonb_build_object('id','osm:node:'||n,'cityId','sfs-test','category','cafe','name','시험 카페 '||n,'address','1 Test St',
   'latitude',49.28,'longitude',-123.12,'sourceUrl','https://www.openstreetmap.org/node/'||n)) from unnest(array[830001,830002,830003]) n)))),current_date)
on conflict(id) do update set payload=jsonb_set(private.city_place_catalog.payload,'{cities,sfs-test}',excluded.payload->'cities'->'sfs-test');
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
select ok((select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('private.saved_folder_members'::regclass,'private.saved_folder_shared_places'::regclass))
 and not has_table_privilege('authenticated','private.saved_folder_members','select') and not has_table_privilege('authenticated','private.saved_folder_shared_places','select'),
 'folder members and editors'' places have row level security and no direct read grant');
select ok(not has_function_privilege('anon','public.invite_saved_folder_member(uuid,uuid)','execute') and not has_function_privilege('anon','public.set_saved_folder_place(uuid,text,text,boolean,text)','execute'),
 'visitors cannot invite or edit');

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
select throws_ok($$select public.copy_saved_folder('e5180000-0000-4000-8000-000000000002')$$,'P0001','FOLDER_UNAVAILABLE','the owner does not copy their own folder');
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
select set_config('sfs.copy',public.copy_saved_folder('e5180000-0000-4000-8000-000000000002')::text,true) is not null;
select is((select jsonb_build_array(c->>'name',c->>'visibility',c->'copied',c->'total') from (select current_setting('sfs.copy')::jsonb c) x),
 '["같이 볼 곳 · 폴더주인","private",2,2]'::jsonb,'a friend copies the folder''s places into a private folder named after the owner');
select is(jsonb_array_length(public.get_saved_items('places')->'items'),2,'and the copied places are saved in the friend''s own list');
select throws_ok($$select public.copy_saved_folder('e5180000-0000-4000-8000-000000000001')$$,'P0001','FOLDER_UNAVAILABLE','a private folder cannot be copied');
select throws_ok($$select public.copy_saved_folder((current_setting('sfs.copy')::jsonb->>'id')::uuid)$$,'P0001','FOLDER_UNAVAILABLE','the copy is the friend''s own, not something to copy again');
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
select throws_ok($$select public.copy_saved_folder('e5180000-0000-4000-8000-000000000002')$$,'P0001','FOLDER_UNAVAILABLE','nor copy it');
select is(public.get_friend_saved_folders('e5170000-0000-4000-8000-000000000001'),'[]'::jsonb,'nor see the folder list');

select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.get_saved_folder('e5180000-0000-4000-8000-000000000002')$$,'P0001','FOLDER_UNAVAILABLE','a blocked pair cannot open it');
select is(public.get_place_friend_folders('sfs-test','osm:node:830001'),'[]'::jsonb,'nor find it from the place screen');
select throws_ok($$select public.copy_saved_folder('e5180000-0000-4000-8000-000000000002')$$,'P0001','FOLDER_UNAVAILABLE','nor copy it');
select is(public.get_friend_saved_folders('e5170000-0000-4000-8000-000000000001'),'[]'::jsonb,'nor see the folder list');

-- 5) Folders made together.
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.invite_saved_folder_member('e5180000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000003')$$,'P0001','FOLDER_MEMBER_NOT_FRIEND','only a friend can be invited');
select throws_ok($$select public.invite_saved_folder_member('e5180000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000004')$$,'P0001','FOLDER_MEMBER_NOT_FRIEND','not a friend in a blocked pair');
select throws_ok($$select public.invite_saved_folder_member('e5180000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000001')$$,'P0001','FOLDER_MEMBER_NOT_FRIEND','not the owner themselves');
select is(public.invite_saved_folder_member('e5180000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000002'),'[{"id":"e5170000-0000-4000-8000-000000000002","accepted":false,"nickname":"친구"}]'::jsonb,'the owner invites a friend to a private folder');
select lives_ok($$select public.invite_saved_folder_member('e5180000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000002')$$,'inviting again is harmless');
reset role;
select is((select count(*)::integer from public.notifications where user_id='e5170000-0000-4000-8000-000000000002' and kind='saved_folder_invite' and actor_id='e5170000-0000-4000-8000-000000000001'),1,'the friend gets one invite in the bell');
select is(private.notification_category('saved_folder_invite','user'),'direct_requests','under the same setting as friend requests');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.get_saved_folder('e5180000-0000-4000-8000-000000000001')$$,'P0001','FOLDER_UNAVAILABLE','an invite alone does not open a private folder');
select throws_ok($$select public.set_saved_folder_place('e5180000-0000-4000-8000-000000000001','place','osm:node:830002',true,'sfs-test')$$,'P0001','FOLDER_UNAVAILABLE','nor lets the invitee add places');
select is((public.get_shared_saved_folders()->'invites'->0)->>'name','예전 폴더','the invite shows in the friend''s saved list');
select is(public.accept_saved_folder_invite('e5180000-0000-4000-8000-000000000001')->>'id','e5180000-0000-4000-8000-000000000001','the friend accepts');
select is(public.get_saved_folder('e5180000-0000-4000-8000-000000000001')->>'role','editor','and now edits the folder');
select ok(not (public.get_saved_folder('e5180000-0000-4000-8000-000000000001') ? 'members'),'an editor does not get the member list');
select is((public.get_shared_saved_folders()->'folders'->0)->>'name','예전 폴더','it shows as a folder made together');
select ok(public.set_saved_folder_place('e5180000-0000-4000-8000-000000000001','place','osm:node:830002',true,'sfs-test'),'the editor puts in a place they saved');
select throws_ok($$select public.set_saved_folder_place('e5180000-0000-4000-8000-000000000001','place','osm:node:830003',true,'sfs-test')$$,'P0001','SAVED_TARGET_UNAVAILABLE','but not a place they have not saved');
select throws_ok($$select public.set_saved_folder_place('e5180000-0000-4000-8000-000000000001','post','e5170000-0000-4000-8000-000000000003',true,null)$$,'P0001','INVALID_SAVED_TARGET','and only places or businesses');
select is(jsonb_array_length(public.get_saved_folder('e5180000-0000-4000-8000-000000000001')->'places'),2,'the folder shows the owner''s place and the editor''s');
select throws_ok($$select public.save_saved_folder('e5180000-0000-4000-8000-000000000001','바꿈','friends',null)$$,'P0001','FOLDER_UNAVAILABLE','an editor cannot rename or change who sees it');
select throws_ok($$select public.set_saved_folder_cover('e5180000-0000-4000-8000-000000000001','sfs-test','osm:node:830002')$$,'P0001','FOLDER_UNAVAILABLE','nor pick the cover');
select throws_ok($$select public.delete_saved_folder('e5180000-0000-4000-8000-000000000001')$$,'P0001','FOLDER_UNAVAILABLE','nor delete it');
select throws_ok($$select public.invite_saved_folder_member('e5180000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000002')$$,'P0001','FOLDER_UNAVAILABLE','nor invite others');
select ok(public.set_saved_folder_place('e5180000-0000-4000-8000-000000000001','place','osm:node:830001',false,'sfs-test'),'an editor takes out a place the owner put in');
select is((select jsonb_agg(x->>'placeKey') from jsonb_array_elements(public.get_saved_folder('e5180000-0000-4000-8000-000000000001')->'places') x),'["osm:node:830002"]'::jsonb,'only the editor''s place is left');
reset role;
select ok(exists(select 1 from private.saved_places where user_id='e5170000-0000-4000-8000-000000000001' and place_key='osm:node:830001'),'the owner''s saved place itself stays saved');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.get_saved_folder('e5180000-0000-4000-8000-000000000001')->'members','[{"id":"e5170000-0000-4000-8000-000000000002","accepted":true,"nickname":"친구"}]'::jsonb,'the owner sees who edits');
select is((select jsonb_agg(x->>'placeKey') from jsonb_array_elements(public.get_saved_folder('e5180000-0000-4000-8000-000000000001')->'places') x),'["osm:node:830002"]'::jsonb,'and the place the editor put in');
select throws_ok($$select public.set_saved_folder_place('e5180000-0000-4000-8000-000000000001','place','osm:node:830003',true,'sfs-test')$$,'P0001','FOLDER_OWNER_USES_LIBRARY','the owner adds through the saved list instead');
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.set_saved_folder_place('e5180000-0000-4000-8000-000000000001','place','osm:node:830002',false,'sfs-test')$$,'P0001','FOLDER_UNAVAILABLE','a stranger cannot take places out');
select throws_ok($$select public.remove_saved_folder_member('e5180000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000002')$$,'P0001','FOLDER_UNAVAILABLE','nor remove an editor');
select throws_ok($$select public.accept_saved_folder_invite('e5180000-0000-4000-8000-000000000001')$$,'P0001','FOLDER_UNAVAILABLE','nor accept an invite they never got');
select is(public.get_shared_saved_folders(),'{"invites":[],"folders":[]}'::jsonb,'and has no folders made together');
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.set_saved_folder_place('e5180000-0000-4000-8000-000000000002','place','osm:node:830002',true,'sfs-test')$$,'P0001','FOLDER_UNAVAILABLE','a friend who only views a folder cannot add to it');
select ok(public.remove_saved_folder_member('e5180000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000002'),'the editor leaves');
select throws_ok($$select public.get_saved_folder('e5180000-0000-4000-8000-000000000001')$$,'P0001','FOLDER_UNAVAILABLE','and can no longer open the private folder');

reset role;
delete from private.saved_folder_items where folder_id='e5180000-0000-4000-8000-000000000002' and place_key='osm:node:830002';
select is((select private.saved_folder_json(f)->'cover'->>'placeKey' from private.saved_folders f where id='e5180000-0000-4000-8000-000000000002'),'osm:node:830001',
 'once the picked place leaves the folder, the newest place is the cover again');
select is((select count(*)::integer from private.saved_folder_items where folder_id=(current_setting('sfs.copy')::jsonb->>'id')::uuid),2,
 'the friend''s copy keeps both places after the owner takes one out');
insert into private.saved_folders(user_id,name) select 'e5170000-0000-4000-8000-000000000002','채우기 '||n from generate_series(1,99) n;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.copy_saved_folder('e5180000-0000-4000-8000-000000000002')$$,'P0001','SAVED_FOLDER_LIMIT','a copy past 100 folders is refused');
reset role;


-- An unsaved item's memo goes away the next time the owner writes one.
delete from private.saved_places where user_id='e5170000-0000-4000-8000-000000000001' and place_key='osm:node:830003';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.set_saved_note('place','osm:node:830002','두 번째 메모','sfs-test')->>'note','두 번째 메모','the owner writes another memo');
select is(public.set_saved_note('place','osm:node:830002','  ','sfs-test')->'note','null'::jsonb,'a blank memo deletes it');
reset role;
select is((select array_agg(saved_key order by saved_key) from private.saved_item_notes where user_id='e5170000-0000-4000-8000-000000000001'),
 array['place:sfs-test:osm:node:830001','user:sfs-test:e5170000-0000-4000-8000-000000000003'],'only memos on still-saved items are left');
-- ADR-0001: words friends can read go to the safety review and the watch-term scan; private folders and memos do not.
select ok(not has_function_privilege('anon','public.get_saved_folder_safety_content(uuid)','execute')
 and not has_function_privilege('authenticated','public.get_saved_folder_safety_content(uuid)','execute')
 and not has_function_privilege('authenticated','private.saved_folder_safety_content(uuid)','execute')
 and has_function_privilege('service_role','public.get_saved_folder_safety_content(uuid)','execute'),'only the safety monitor reads a folder''s words');
select ok(not has_function_privilege('anon','public.get_admin_saved_folder_content(uuid)','execute'),'visitors cannot open the admin copy');
select ok((select bool_and(pg_get_constraintdef(oid) like '%saved_folder%') from pg_constraint
 where conname in ('safety_review_queue_target_type_check','safety_alerts_target_type_check','notifications_target_type_check'))
 and pg_get_functiondef('public.export_admin_safety_evidence(bigint)'::regprocedure) like '%saved_folder_safety_content(a.target_id)%','the queue, alerts, admin bell and evidence export know folders');
select is((select count(*)::integer from pg_trigger where tgrelid='private.saved_item_notes'::regclass and not tgisinternal),0,'memos are never sent: nobody else reads them');
insert into private.watch_terms(term,category,severity) values('폴더감시시험어','fraud','high') on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('sfs.watch_friends',public.save_saved_folder(null,'안전 검사 폴더','friends','주말 산책')->>'id',true);
select set_config('sfs.watch_private',public.save_saved_folder(null,'나만 보는 안전 폴더','private','폴더감시시험어')->>'id',true);
reset role;
select is((select count(*)::integer from public.safety_review_queue where target_type='saved_folder' and target_id=current_setting('sfs.watch_friends')::uuid),1,'a new folder friends can see enters the safety review queue');
select is((select count(*)::integer from public.safety_review_queue where target_type='saved_folder' and target_id=current_setting('sfs.watch_private')::uuid),0,'a private folder stays out of the queue');
select is((select count(*)::integer from public.safety_alerts where target_type='saved_folder' and target_id=current_setting('sfs.watch_private')::uuid),0,'and out of the watch-term scan');
update public.safety_review_queue set status='reviewed',reviewed_at=now() where target_type='saved_folder' and target_id=current_setting('sfs.watch_friends')::uuid;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.save_saved_folder(current_setting('sfs.watch_friends')::uuid,'안전 검사 폴더','friends','주말 산책')$$,'the owner saves the same words again');
reset role;
select is((select count(*)||':'||min(status) from public.safety_review_queue where target_type='saved_folder' and target_id=current_setting('sfs.watch_friends')::uuid),'1:reviewed','the same words are not sent again');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.save_saved_folder(current_setting('sfs.watch_private')::uuid,'나만 보는 안전 폴더','friends','폴더감시시험어')$$,'the owner shows the private folder to friends');
select lives_ok($$select public.save_saved_folder(current_setting('sfs.watch_friends')::uuid,'새 이름','friends','주말 산책')$$,'and renames the friends folder');
reset role;
select is((select count(*)::integer from public.safety_review_queue where target_type='saved_folder' and target_id=current_setting('sfs.watch_private')::uuid),1,'turning a folder to friends sends the words written while it was private');
select is((select status from public.safety_review_queue where target_type='saved_folder' and target_id=current_setting('sfs.watch_friends')::uuid),'pending','new words go back to review');
select is((select author_id from public.safety_alerts where target_type='saved_folder' and target_id=current_setting('sfs.watch_private')::uuid),'e5170000-0000-4000-8000-000000000001'::uuid,
 'a watch term in a folder friends can see raises an alert on its owner');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(public.get_saved_folder_safety_content(current_setting('sfs.watch_friends')::uuid)->>'text',E'저장 폴더 · 보는 사람: 친구\n새 이름\n주말 산책','the safety monitor reads the name and description');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.get_saved_folder_safety_content(current_setting('sfs.watch_friends')::uuid)$$,'42501',null,'a member cannot call the safety read');
select throws_ok($$select public.get_admin_saved_folder_content(current_setting('sfs.watch_friends')::uuid)$$,'P0001','ADMIN_REQUIRED','a member cannot open the admin copy');
reset role;
-- A folder made together: the invite carries its name and the friend sees its words, whatever its visibility.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('sfs.together',public.save_saved_folder(null,'같이 고르는 곳','private','둘이 갈 곳')->>'id',true);
reset role;
select is((select count(*)::integer from public.safety_review_queue where target_type='saved_folder' and target_id=current_setting('sfs.together')::uuid),0,'a private folder nobody is invited to stays out of the queue');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.invite_saved_folder_member(current_setting('sfs.together')::uuid,'e5170000-0000-4000-8000-000000000002')$$,'the owner invites a friend to the private folder');
reset role;
select is((select count(*)::integer from public.safety_review_queue where target_type='saved_folder' and target_id=current_setting('sfs.together')::uuid),1,'sending an invite puts the folder words in the safety review queue');
update public.safety_review_queue set status='reviewed',reviewed_at=now() where target_type='saved_folder' and target_id=current_setting('sfs.together')::uuid;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.invite_saved_folder_member(current_setting('sfs.together')::uuid,'e5170000-0000-4000-8000-000000000002')$$,'the owner invites the same friend again');
reset role;
insert into private.saved_folder_members(folder_id,user_id) values(current_setting('sfs.together')::uuid,'e5170000-0000-4000-8000-000000000005');
select is((select count(*)||':'||min(status) from public.safety_review_queue where target_type='saved_folder' and target_id=current_setting('sfs.together')::uuid),'1:reviewed','another invite with the same words is not sent again');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select lives_ok($$select public.accept_saved_folder_invite(current_setting('sfs.together')::uuid)$$,'the friend accepts');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.save_saved_folder(current_setting('sfs.together')::uuid,'같이 고르는 곳','private','둘이 갈 맛집')$$,'the owner changes the description while they make it together');
reset role;
select is((select count(*)||':'||min(status) from public.safety_review_queue where target_type='saved_folder' and target_id=current_setting('sfs.together')::uuid),'1:pending','the new description goes back to review on the same row');
-- Unfriending ends a folder made together; deleting the account takes the places the member put in.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.invite_saved_folder_member('e5180000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000002')$$,'the owner invites the friend again');
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select lives_ok($$select public.accept_saved_folder_invite('e5180000-0000-4000-8000-000000000001')$$,'the friend accepts again');
select ok(public.set_saved_folder_place('e5180000-0000-4000-8000-000000000001','place','osm:node:830001',true,'sfs-test'),'and puts a place in');
reset role;
delete from private.friendships where user_low_id='e5170000-0000-4000-8000-000000000001' and user_high_id='e5170000-0000-4000-8000-000000000002';
select is((select count(*)::integer from private.saved_folder_members where folder_id='e5180000-0000-4000-8000-000000000001'),0,'unfriending ends the editing');
insert into private.saved_folder_members(folder_id,user_id,accepted_at) values('e5180000-0000-4000-8000-000000000002','e5170000-0000-4000-8000-000000000002',now());
update public.profiles set account_status='deleted' where id='e5170000-0000-4000-8000-000000000002';
select is((select count(*)::integer from private.saved_folder_members where user_id='e5170000-0000-4000-8000-000000000002')+(select count(*)::integer from private.saved_folder_shared_places where added_by='e5170000-0000-4000-8000-000000000002'),0,
 'deleting the account erases its memberships and the places it put in friends'' folders');
update public.profiles set account_status='deleted' where id='e5170000-0000-4000-8000-000000000001';
select is((select count(*)::integer from private.saved_item_notes where user_id='e5170000-0000-4000-8000-000000000001'),0,'deleting the account erases its memos');

select * from finish();
rollback;
