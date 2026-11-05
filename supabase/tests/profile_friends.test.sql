begin;
set local search_path=public,extensions;
select no_plan();
insert into public.tags(id,slug,label,kind) values(1,'life','생활','post'),(5,'meetup','모임','post') on conflict do nothing;
insert into public.cities values('friend-test','Friend test','BC','America/Vancouver',true);
insert into auth.users(id,email) values
 ('e5100000-0000-4000-8000-000000000001','friend-a@example.test'),
 ('e5100000-0000-4000-8000-000000000002','friend-b@example.test'),
 ('e5100000-0000-4000-8000-000000000003','friend-c@example.test'),
 ('e5100000-0000-4000-8000-000000000004','friend-persona@example.test'),
 ('e5100000-0000-4000-8000-000000000005','friend-d@example.test'),
 ('e5100000-0000-4000-8000-000000000006','friend-owner@example.test');
update auth.users set raw_app_meta_data='{"gling_persona":true}' where id='e5100000-0000-4000-8000-000000000004';
update auth.users set raw_app_meta_data='{"merchant_enabled":true}' where id='e5100000-0000-4000-8000-000000000006';
insert into public.profiles(id,nickname,city_id) values
 ('e5100000-0000-4000-8000-000000000001','FriendA','friend-test'),
 ('e5100000-0000-4000-8000-000000000002','FriendB','friend-test'),
 ('e5100000-0000-4000-8000-000000000003','FriendC','friend-test'),
 ('e5100000-0000-4000-8000-000000000004','FriendPersona','friend-test'),
 ('e5100000-0000-4000-8000-000000000005','FriendD','friend-test'),
 ('e5100000-0000-4000-8000-000000000006','FriendOwner','friend-test');
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,owner_id,owner_verified_at) values
 ('e5110000-0000-4000-8000-000000000001','Friend cafe','friend-test','trial','granted','Synthetic rollback fixture','business','e5100000-0000-4000-8000-000000000006',now()),
 ('e5110000-0000-4000-8000-000000000002','Friend source listing','friend-test','trial','granted','Synthetic rollback fixture','source',null,null);
insert into private.city_place_catalog(id,payload,refreshed_on) values(true,'{"cities":{"friend-test":{"places":[{"id":"osm:node:810001","cityId":"friend-test","name":"Linked cafe","address":"Test address","category":"cafe","latitude":49.2,"longitude":-123.1,"sourceUrl":"https://www.openstreetmap.org/node/810001"},{"id":"osm:node:810002","cityId":"friend-test","name":"Plain park","address":"Park address","category":"park","latitude":49.3,"longitude":-123.2,"sourceUrl":"https://www.openstreetmap.org/node/810002"}]}},"collectedAt":"2026-11-03T00:00:00Z"}',current_date)
 on conflict(id) do update set payload=excluded.payload;
insert into private.webshop_place_links(place_key,merchant_id,city_id) values('osm:node:810001','e5110000-0000-4000-8000-000000000001','friend-test');
insert into public.posts(id,author_id,city_id,tag_id,title,body,kind,listing_status,expires_at) values
 ('e5130000-0000-4000-8000-000000000001','e5100000-0000-4000-8000-000000000003','friend-test',1,'Room for rent','Exact address 123 Test St','listing','open',now()+interval '7 days');
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
 ('e5130000-0000-4000-8000-000000000002','e5100000-0000-4000-8000-000000000002','friend-test',5,'Saturday walk','Meet at the park');
-- B saved a park, the cafe (as a business), a rent listing and a source record. Only the park and cafe may reach a map.
insert into private.saved_places(user_id,city_id,place_key) values('e5100000-0000-4000-8000-000000000002','friend-test','osm:node:810002');
insert into private.saved_merchants(user_id,merchant_id) values
 ('e5100000-0000-4000-8000-000000000002','e5110000-0000-4000-8000-000000000001'),
 ('e5100000-0000-4000-8000-000000000002','e5110000-0000-4000-8000-000000000002'),
 ('e5100000-0000-4000-8000-000000000004','e5110000-0000-4000-8000-000000000001');
insert into public.post_reactions(post_id,user_id,kind) values('e5130000-0000-4000-8000-000000000001','e5100000-0000-4000-8000-000000000002','save');

-- Streak: weeks start Monday 00:00 Vancouver; the current week falls back to last week until it ends without a save.
select is(private.saved_week_streak('{}'::timestamptz[],'2026-11-04 12:00 America/Vancouver'),0,'no saves, no streak');
select is(private.saved_week_streak(array['2026-11-03 10:00 America/Vancouver','2026-10-28 10:00 America/Vancouver','2026-10-21 10:00 America/Vancouver']::timestamptz[],
  '2026-11-04 12:00 America/Vancouver'),3,'three weeks in a row');
select is(private.saved_week_streak(array['2026-10-28 10:00 America/Vancouver','2026-10-21 10:00 America/Vancouver']::timestamptz[],
  '2026-11-04 12:00 America/Vancouver'),2,'this week without a save yet keeps last week''s run');
select is(private.saved_week_streak(array['2026-11-03 10:00 America/Vancouver','2026-10-21 10:00 America/Vancouver']::timestamptz[],
  '2026-11-04 12:00 America/Vancouver'),1,'a skipped week breaks the run');
select is(private.saved_week_streak(array['2026-10-21 10:00 America/Vancouver']::timestamptz[],'2026-11-04 12:00 America/Vancouver'),0,'two empty weeks end the run');
select is(private.saved_week_streak(array['2026-11-01 23:30 America/Vancouver']::timestamptz[],'2026-11-02 00:30 America/Vancouver'),1,
  'Sunday 23:30 Vancouver (already Monday in UTC) belongs to the week that just ended');
select is(private.saved_week_streak(array['2026-11-01 23:30 America/Vancouver','2026-11-02 00:10 America/Vancouver']::timestamptz[],'2026-11-02 00:30 America/Vancouver'),2,
  'Monday 00:10 Vancouver starts a new week');
select is(private.saved_week_streak(array['2026-10-26 00:30 America/Vancouver','2026-11-01 23:30 America/Vancouver']::timestamptz[],'2026-11-01 23:45 America/Vancouver'),1,
  'the daylight-saving week counts once');
select is(private.saved_week_streak(array['2026-11-03 10:00 America/Vancouver','2026-11-03 11:00 America/Vancouver','2026-11-04 09:00 America/Vancouver']::timestamptz[],
  '2026-11-04 12:00 America/Vancouver'),1,'several saves in one week count as one week');
select is(private.saved_week_streak(array['2026-11-10 10:00 America/Vancouver']::timestamptz[],'2026-11-04 12:00 America/Vancouver'),0,'future times are ignored');
select is(private.notification_category('friend_request','user'),'direct_requests','friend requests use the people-asking setting');
select is(private.notification_category('friend_accepted','user'),'direct_requests','accepted requests use the same setting');

-- Nobody reads the tables directly.
select ok(not has_table_privilege('authenticated','private.friendships','select'),'friendships are not directly readable');
select ok(not has_table_privilege('anon','private.profile_sharing','select'),'sharing settings are not directly readable');
select ok(not has_function_privilege('anon','public.set_friendship(uuid,text)','execute'),'anonymous visitors cannot send requests');
select ok(not has_function_privilege('anon','public.get_my_friends()','execute'),'anonymous visitors have no friend list');
select ok(has_function_privilege('anon','public.get_profile_overview(uuid)','execute'),'public counts are readable');

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->>'savedCount','2','anonymous visitors see the count of places and businesses only');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->'savedPlaces','null'::jsonb,'anonymous visitors never see saved places');
select ok(not public.get_profile_overview('e5100000-0000-4000-8000-000000000002') ? 'canRequestFriend','no field says whom a request would reach');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->>'meetupCount','1','meetup posts are counted');
select is(public.get_merchant_saves('e5110000-0000-4000-8000-000000000001')->>'saverCount','1','a persona save does not count as a member');
select is(public.get_merchant_saves('e5110000-0000-4000-8000-000000000001')->'friends','[]'::jsonb,'anonymous visitors see no friends');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(jsonb_array_length(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->'savedPlaces'),2,'the owner sees their own map');
select is((select string_agg(x->>'placeKey',',' order by x->>'placeKey') from jsonb_array_elements(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->'savedPlaces') x),
  'osm:node:810001,osm:node:810002','the map holds the park and the business place only; rent listing and source record stay off');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->>'sharesSavedPlaces','true','sharing starts on (owner 2026-11-04)');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->>'own','true','own profile');
select throws_ok($$select * from private.friendships$$,'42501',null,'members cannot select friendships directly');

select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->'savedPlaces','null'::jsonb,'a stranger sees no saved places');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->>'mapHiddenReason','not_friends','a stranger is told to be friends first');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->>'friendship','none','a real member sees 친구 추가');
select is(public.set_friendship('e5100000-0000-4000-8000-000000000002','request')->>'friendship','outgoing','A asks B');
select is(public.set_friendship('e5100000-0000-4000-8000-000000000002','request')->>'friendship','outgoing','asking twice is harmless');
select throws_ok($$select public.set_friendship('e5100000-0000-4000-8000-000000000002','accept')$$,'P0001','FRIEND_REQUEST_NOT_FOUND','A cannot accept their own request');
select throws_ok($$select public.set_friendship('e5100000-0000-4000-8000-000000000001','request')$$,'P0001','FRIEND_UNAVAILABLE','nobody befriends themselves');
select throws_ok($$select public.set_friendship('e5100000-0000-4000-8000-000000000002','poke')$$,'P0001','INVALID_FRIEND_ACTION','unknown actions are refused');
select throws_ok($$select public.set_friendship('e5100000-0000-4000-8000-000000000004','request')$$,'P0001','FRIEND_UNAVAILABLE','a persona cannot be asked');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_profile_overview('e5100000-0000-4000-8000-000000000004')) k),
  (select array_agg(k order by k) from jsonb_object_keys(public.get_profile_overview('e5100000-0000-4000-8000-000000000003')) k),'a persona profile answers with the same fields as a member');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000004')->>'friendship','none','the persona profile shows 친구 추가 too, so nothing gives it away');
select is(jsonb_array_length(public.get_my_friends()->'outgoing'),1,'A sees the sent request');
reset role;
select is((select count(*)::integer from public.notifications where user_id='e5100000-0000-4000-8000-000000000002' and kind='friend_request' and category='direct_requests'
  and route='/user/e5100000-0000-4000-8000-000000000001'),1,'B gets one request alert that opens A');
set local role authenticated;

-- Someone else can neither see nor answer the request.
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is(public.get_my_friends(),'{"friends":[],"incoming":[],"outgoing":[]}'::jsonb,'C sees nothing of A and B');
select throws_ok($$select public.set_friendship('e5100000-0000-4000-8000-000000000001','accept')$$,'P0001','FRIEND_REQUEST_NOT_FOUND','C cannot accept for B');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->>'friendship','none','C sees no relation to B');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->>'friendCount','0','pending requests are not counted');

select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.set_friendship('e5100000-0000-4000-8000-000000000001','request')$$,'P0001','FRIEND_UNAVAILABLE','a persona cannot ask a member');

select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.get_my_friends()->'incoming'->0->>'nickname','FriendA','B sees the incoming request');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->>'friendRequestCount','1','B''s own profile counts the waiting request');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000001')->'friendRequestCount','null'::jsonb,'nobody sees another member''s request count');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000001')->>'friendship','incoming','A''s profile shows the request to B');
select is(public.set_friendship('e5100000-0000-4000-8000-000000000001','decline')->>'friendship','none','B declines');
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.set_friendship('e5100000-0000-4000-8000-000000000002','request')->>'friendship','outgoing','A asks again');
select is(public.set_friendship('e5100000-0000-4000-8000-000000000002','cancel')->>'friendship','none','A cancels');
select is(public.set_friendship('e5100000-0000-4000-8000-000000000002','request')->>'friendship','outgoing','A asks once more');
reset role;
select is((select count(*)::integer from public.notifications where user_id='e5100000-0000-4000-8000-000000000002' and kind='friend_request'),1,'asking again within a week sends no second alert');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.set_friendship('e5100000-0000-4000-8000-000000000001','request')->>'friendship','friends','asking back accepts');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->>'friendCount','1','B has one friend');
reset role;
select is((select count(*)::integer from public.notifications where user_id='e5100000-0000-4000-8000-000000000001' and kind='friend_accepted'),1,'A hears that B accepted');
set local role authenticated;

select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select string_agg(x->>'placeKey',',' order by x->>'placeKey') from jsonb_array_elements(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->'savedPlaces') x),
  'osm:node:810001,osm:node:810002','a friend sees the places by default and still no listing or source record');
select is((select x->>'merchantId' from jsonb_array_elements(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->'savedPlaces') x where x->>'placeKey'='osm:node:810001'),
  'e5110000-0000-4000-8000-000000000001','the business pin carries its business');
select is(public.get_merchant_saves('e5110000-0000-4000-8000-000000000001')->'friends'->0->>'nickname','FriendB','the business names the friend by default');
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.set_profile_sharing(false)->>'savedPlacesToFriends','false','B turns sharing off');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->>'sharesSavedPlaces','false','B''s own profile shows it off');
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->'savedPlaces','null'::jsonb,'a friend sees nothing once B turns it off');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->>'mapHiddenReason','not_shared','a friend is told B does not share');
select is(public.get_merchant_saves('e5110000-0000-4000-8000-000000000001')->'friends','[]'::jsonb,'a friend who turned it off is not named on the business');
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.set_profile_sharing(true)->>'savedPlacesToFriends','true','B turns sharing back on');
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(jsonb_array_length(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->'savedPlaces'),2,'the map comes back');
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->'savedPlaces','null'::jsonb,'sharing reaches friends only');
select is(public.get_merchant_saves('e5110000-0000-4000-8000-000000000001')->'friends','[]'::jsonb,'a non-friend sees no names');

-- Unfriending, blocking and reporting end it.
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.set_friendship('e5100000-0000-4000-8000-000000000002','remove')->>'friendship','none','A unfriends B');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000002')->'savedPlaces','null'::jsonb,'an old friend loses the map');
select is(public.set_friendship('e5100000-0000-4000-8000-000000000005','request')->>'friendship','outgoing','A asks D');
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is(public.set_friendship('e5100000-0000-4000-8000-000000000001','accept')->>'friendship','friends','D accepts');
reset role;
insert into public.blocks(blocker_id,blocked_id) values('e5100000-0000-4000-8000-000000000005','e5100000-0000-4000-8000-000000000001');
select is((select count(*)::integer from private.friendships where user_low_id='e5100000-0000-4000-8000-000000000001' and user_high_id='e5100000-0000-4000-8000-000000000005'),0,'a block ends the friendship');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.set_friendship('e5100000-0000-4000-8000-000000000005','request')$$,'P0001','FRIEND_UNAVAILABLE','a blocked pair cannot ask');
select is(public.set_friendship('e5100000-0000-4000-8000-000000000003','request')->>'friendship','outgoing','A asks C');
reset role;
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code) values
 ('e5100000-0000-4000-8000-000000000003','e5100000-0000-4000-8000-000000000001','user','e5100000-0000-4000-8000-000000000001','spam');
select is((select count(*)::integer from private.friendships where user_low_id='e5100000-0000-4000-8000-000000000001' and user_high_id='e5100000-0000-4000-8000-000000000003'),0,'a report ends the pending request');
set local role authenticated;
select throws_ok($$select public.set_friendship('e5100000-0000-4000-8000-000000000003','request')$$,'P0001','FRIEND_UNAVAILABLE','a reported pair cannot ask');
reset role;
select ok(exists(select 1 from private.action_rate_events where user_id='e5100000-0000-4000-8000-000000000001' and action='friend_request'),'friend requests count toward a daily cap');
set local role authenticated;
-- Reporting a friend's message ends it too, so they lose your map.
select is(public.set_friendship('e5100000-0000-4000-8000-000000000002','request')->>'friendship','outgoing','A asks B again');
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.set_friendship('e5100000-0000-4000-8000-000000000001','accept')->>'friendship','friends','B accepts again');
reset role;
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code) values('e5100000-0000-4000-8000-000000000002','e5100000-0000-4000-8000-000000000001','message',gen_random_uuid(),'harassment');
select is((select count(*)::integer from private.friendships where user_low_id='e5100000-0000-4000-8000-000000000001' and user_high_id='e5100000-0000-4000-8000-000000000002'),0,'reporting a message ends the friendship');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.set_friendship('e5100000-0000-4000-8000-000000000002','request')$$,'P0001','FRIEND_UNAVAILABLE','a message report blocks asking again');

-- Even if a row with an operated character reached the table some other way, it never shows or counts.
reset role;
insert into private.friendships(user_low_id,user_high_id,requester_id,created_at,accepted_at) values('e5100000-0000-4000-8000-000000000001','e5100000-0000-4000-8000-000000000004','e5100000-0000-4000-8000-000000000001',now()-interval '1 minute',now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(jsonb_array_length(public.get_my_friends()->'friends'),0,'an operated character never shows in the friend list');
select is(public.get_profile_overview('e5100000-0000-4000-8000-000000000001')->>'friendCount','0','an operated character is not counted as a friend');
select * from finish();
rollback;
