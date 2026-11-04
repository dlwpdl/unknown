begin;
select no_plan();

-- A hides, B is someone else, C writes the posts, D is an operated character.
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at) values
 ('b1400000-0000-4000-8000-000000000001','hide-viewer@test.gling.invalid','{}','{"nickname":"숨기는 이웃"}',now()),
 ('b1400000-0000-4000-8000-000000000002','hide-other@test.gling.invalid','{}','{"nickname":"다른 이웃"}',now()),
 ('b1400000-0000-4000-8000-000000000003','hide-author@test.gling.invalid','{}','{"nickname":"글쓴 이웃"}',now()),
 ('b1400000-0000-4000-8000-000000000004','hide-persona@test.gling.invalid','{"gling_persona":"test"}','{"nickname":"운영 캐릭터"}',now());
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,raw_user_meta_data->>'nickname','vancouver',now(),now(),now(),'test' from auth.users where id::text like 'b1400000-%'
on conflict(id) do update set nickname=excluded.nickname,city_id=excluded.city_id;

insert into public.posts(id,author_id,city_id,tag_id,title,body,status,posted_on) values
 ('b1420000-0000-4000-8000-000000000001','b1400000-0000-4000-8000-000000000003','vancouver',1,'숨김점검 첫 글',
  E'여기 좋아요\n\nGoogle 지도: https://www.google.com/maps/search/?api=1&query=49.28%2C-123.12','published',current_date),
 ('b1420000-0000-4000-8000-000000000002','b1400000-0000-4000-8000-000000000003','vancouver',1,'숨김점검 둘째 글','그대로 보여야 해요','published',current_date),
 ('b1420000-0000-4000-8000-000000000003','b1400000-0000-4000-8000-000000000001','vancouver',1,'숨김점검 내 글','내가 쓴 글','published',current_date),
 ('b1420000-0000-4000-8000-000000000004','b1400000-0000-4000-8000-000000000004','vancouver',1,'숨김점검 캐릭터 글','운영 캐릭터 글','published',current_date);
update public.posts set sort_at=created_at where id::text like 'b1420000-%';
insert into public.weekly_rankings(city_id,week_start,rank,post_id,score) values
 ('vancouver',current_date+7,1,'b1420000-0000-4000-8000-000000000001',10),
 ('vancouver',current_date+7,2,'b1420000-0000-4000-8000-000000000002',9);

create temp table hidden_check(name text, id text) on commit drop;
grant all on hidden_check to authenticated;
create function pg_temp.hidden_lists() returns setof hidden_check language sql as $$
  select 'latest', id::text from public.get_public_feed_page_v2('vancouver',null,null,null,null,50) where id::text like 'b1420000-%'
  union all select 'popular', id::text from public.get_public_popular_feed_page('vancouver',null,null,null,null,null,50) where id::text like 'b1420000-%'
  union all select 'map', id::text from public.get_discovery_posts('vancouver',null,null,null,null,50) where id::text like 'b1420000-%'
  union all select 'search', item->>'id' from jsonb_array_elements(public.search_public_directory('숨김점검','vancouver','post',0,'[]'::jsonb)->'items') item
  union all select 'weekly', entry->>'postId' from jsonb_array_elements(public.get_weekly_ranking('vancouver')->'entries') entry where entry->>'postId' like 'b1420000-%'
  union all select 'author', id::text from public.get_public_author_posts('b1400000-0000-4000-8000-000000000003',null,null,50)
$$;
create function pg_temp.lists_with(p_id text) returns text language sql as $$
  select coalesce(string_agg(name, ',' order by name), '') from pg_temp.hidden_lists() where id = p_id
$$;

select ok((select bool_and(pg_get_functiondef(signature::regprocedure) like '%private.hidden_posts hidden_post%') from unnest(array[
  'private.business_base_get_public_feed_page_v2(text,smallint,text,timestamptz,uuid,integer)',
  'private.business_base_get_public_popular_feed_page(text,smallint,bigint,timestamptz,uuid,timestamptz,integer)',
  'private.business_base_get_discovery_posts(text,smallint,text,timestamptz,uuid,integer)',
  'public.search_public_directory(text,text,text,integer,jsonb)','public.get_weekly_ranking(text)',
  'private.business_base_get_public_author_posts(uuid,timestamptz,uuid,integer)','public.get_merchant_profile_posts(uuid,text,integer)']) signature),
  'every post list the app reads leaves out hidden posts');
select ok(pg_get_functiondef('private.business_base_get_public_post(uuid)'::regprocedure) not like '%hidden_posts%', 'the post detail does not read hidden posts');

-- Guests and signed-out calls are refused; the table is never readable directly.
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select throws_ok($$select public.set_post_hidden('b1420000-0000-4000-8000-000000000001',true)$$,'42501',null,'guests cannot call it');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.set_post_hidden('b1420000-0000-4000-8000-000000000001',true)$$,'P0001','AUTH_REQUIRED','a call without a signed-in member is refused');
reset role;

select set_config('request.jwt.claims','{"sub":"b1400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select * from private.hidden_posts$$,'42501',null,'members cannot read the table directly');
select is(pg_temp.lists_with('b1420000-0000-4000-8000-000000000001'),'author,latest,map,popular,search,weekly','before hiding, the post is in every list');
select throws_ok($$select public.set_post_hidden('b1420000-0000-4000-8000-000000000003',true)$$,'P0001','OWN_POST_NOT_HIDDEN','my own post cannot be hidden');
select throws_ok($$select public.set_post_hidden('b1420000-0000-4000-8000-0000000000ff',true)$$,'P0001','POST_NOT_FOUND','a post that does not exist is refused');
select throws_ok($$select public.set_post_hidden('b1420000-0000-4000-8000-000000000001',null)$$,'P0001','INVALID_POST_HIDDEN','a missing choice is refused');

select lives_ok($$select public.set_post_hidden('b1420000-0000-4000-8000-000000000001',true)$$,'hiding succeeds');
select lives_ok($$select public.set_post_hidden('b1420000-0000-4000-8000-000000000001',true)$$,'hiding twice is fine');
select is(pg_temp.lists_with('b1420000-0000-4000-8000-000000000001'),'','the hidden post leaves every list of the member who hid it');
select is(pg_temp.lists_with('b1420000-0000-4000-8000-000000000002'),'author,latest,popular,search,weekly','the other post by the same author stays');
select is((select count(*)::integer from public.get_public_post('b1420000-0000-4000-8000-000000000001')),1,'the post still opens from a link');
select lives_ok($$select public.set_post_hidden('b1420000-0000-4000-8000-000000000004',true)$$,'an operated character post can be hidden too');
select is(pg_temp.lists_with('b1420000-0000-4000-8000-000000000004'),'','the character post leaves the lists');
reset role;
select is((select count(*)::integer from public.reports where reporter_id='b1400000-0000-4000-8000-000000000001'),0,'hiding files no report');
select is((select count(*)::integer from private.hidden_posts where user_id='b1400000-0000-4000-8000-000000000001'),2,'one row per hidden post');

select set_config('request.jwt.claims','{"sub":"b1400000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(pg_temp.lists_with('b1420000-0000-4000-8000-000000000001'),'author,latest,map,popular,search,weekly','someone else still sees the post everywhere');
reset role;

select set_config('request.jwt.claims','{"sub":"b1400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.set_post_hidden('b1420000-0000-4000-8000-000000000001',false)$$,'undo succeeds');
select is(pg_temp.lists_with('b1420000-0000-4000-8000-000000000001'),'author,latest,map,popular,search,weekly','after undo the post is back in every list');
select lives_ok($$select public.set_post_hidden('b1420000-0000-4000-8000-000000000001',false)$$,'undo on a post that is not hidden is fine');
reset role;

-- The cap: 5,000 hidden posts per member. Re-hiding one already hidden still works at the cap.
insert into public.posts(author_id,city_id,tag_id,title,body,status,posted_on)
select 'b1400000-0000-4000-8000-000000000003','vancouver',1,'상한 점검 '||n,'본문','published',current_date from generate_series(1,5001) n;
insert into private.hidden_posts(user_id,post_id)
select 'b1400000-0000-4000-8000-000000000002',id from public.posts where title like '상한 점검 %' and title<>'상한 점검 5001';
select set_config('request.jwt.claims','{"sub":"b1400000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.set_post_hidden(%L,true)',(select id from public.posts where title='상한 점검 5001')),'P0001','HIDDEN_POST_LIMIT','the 5,001st hidden post is refused');
select lives_ok(format('select public.set_post_hidden(%L,true)',(select id from public.posts where title='상한 점검 1')),'re-hiding at the cap is fine');
reset role;

-- An inactive account cannot hide.
update public.profiles set account_status='suspended' where id='b1400000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"b1400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.set_post_hidden('b1420000-0000-4000-8000-000000000002',true)$$,'P0001','ACCOUNT_LOCKED','a suspended account cannot hide');
reset role;

-- Deleting the post removes its rows.
delete from public.posts where id='b1420000-0000-4000-8000-000000000004';
select is((select count(*)::integer from private.hidden_posts where post_id='b1420000-0000-4000-8000-000000000004'),0,'deleting the post removes its hidden rows');

select * from finish();
rollback;
