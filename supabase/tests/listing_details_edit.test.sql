begin;
select no_plan();
insert into auth.users(id,email) values
 ('46100000-0000-0000-0000-000000000001','listing-edit-author@example.test'),
 ('46100000-0000-0000-0000-000000000002','listing-edit-other@example.test');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
 ('46100000-0000-0000-0000-000000000001','렌트수정','vancouver',now(),now(),now(),'test'),
 ('46100000-0000-0000-0000-000000000002','남의글','vancouver',now(),now(),now(),'test');
select set_config('request.jwt.claims','{"sub":"46100000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.create_post('vancouver',(select id from public.tags where slug='housing'),'메트로타운 1베드','렌트 내놓음 · 1베드 · $2,000/월'||E'\n\n'||'연락 주세요','{}','{}',null,'listing',2000)$$,'a rent listing publishes');
select lives_ok($$update public.posts set listing_details='{"type":"housing","deal":"rent_offer","rooms":"1b","lead":"렌트 내놓음 · 1베드 · $2,000/월"}' where title='메트로타운 1베드'$$,'the card is saved after publishing');

-- 글 수정: title, body with a new first line, card and price in one update.
select lives_ok($$update public.posts set title='메트로타운 1베드 (세탁기)', body='렌트 내놓음 · 1베드 · $2,100/월 · 인스위트 세탁기'||E'\n\n'||'연락 주세요',
  listing_details='{"type":"housing","deal":"rent_offer","rooms":"1b","includes":["parking","laundry"],"lead":"렌트 내놓음 · 1베드 · $2,100/월 · 인스위트 세탁기"}', price=2100
  where title='메트로타운 1베드'$$,'the author edits the card, the body and the price together');
select is((select price from public.posts where title='메트로타운 1베드 (세탁기)'),2100::numeric(12,2),'the edited price is saved');
select is((select listing_details->'includes' from public.posts where title='메트로타운 1베드 (세탁기)'),'["parking","laundry"]'::jsonb,'인스위트 세탁기 is an accepted include');
select throws_ok($$update public.posts set listing_details=listing_details||'{"includes":["sauna"]}' where title='메트로타운 1베드 (세탁기)'$$,'P0001','INVALID_LISTING_DETAILS','an unknown include is still refused');
select throws_ok($$update public.posts set price=100000000 where title='메트로타운 1베드 (세탁기)'$$,'23514',null,'a price above the create_post bound is refused');
select lives_ok($$select public.create_post('vancouver',(select id from public.tags where slug='life'),'그냥 이야기','본문','{}','{}',null,'story',null)$$,'a story publishes');
select throws_ok($$update public.posts set price=10 where title='그냥 이야기'$$,'23514',null,'a story still cannot carry a price');

select set_config('request.jwt.claims','{"sub":"46100000-0000-0000-0000-000000000002","role":"authenticated"}',true);
update public.posts set price=1 where title='메트로타운 1베드 (세탁기)';
reset role;
select is((select price from public.posts where title='메트로타운 1베드 (세탁기)'),2100::numeric(12,2),'another account cannot change the price');
select * from finish();
rollback;
