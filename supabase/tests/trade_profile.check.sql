insert into auth.users(id,email) values
  ('51000000-0000-0000-0000-000000000001','tp-seller@example.test'),
  ('51000000-0000-0000-0000-000000000002','tp-buyer1@example.test'),
  ('51000000-0000-0000-0000-000000000003','tp-buyer2@example.test');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
  ('51000000-0000-0000-0000-000000000001','거래왕','vancouver',now(),now(),now(),'test'),
  ('51000000-0000-0000-0000-000000000002','손님하나','vancouver',now(),now(),now(),'test'),
  ('51000000-0000-0000-0000-000000000003','손님둘','vancouver',now(),now(),now(),'test');

select set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.create_post('vancouver',(select id from public.tags where slug='life'),'책상 팝니다','상태 좋음','{}','{}',null,'listing',50);
reset role;
select set_config('test.post',(select id::text from public.posts where title='책상 팝니다'),true);

-- 손님 둘이 각각 대화하고 양쪽이 말한다
do $$
declare conv uuid; buyer uuid;
begin
  foreach buyer in array array['51000000-0000-0000-0000-000000000002','51000000-0000-0000-0000-000000000003']::uuid[] loop
    perform set_config('request.jwt.claims', json_build_object('sub',buyer,'role','authenticated')::text, true);
    conv := public.start_conversation('51000000-0000-0000-0000-000000000001'::uuid, current_setting('test.post')::uuid);
    perform set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
    perform public.respond_direct_conversation(conv,'accepted');
    insert into public.messages(conversation_id,sender_id,body) values (conv,buyer,'있나요?'),(conv,'51000000-0000-0000-0000-000000000001','네');
    -- 한 손님만 후기를 남긴다
    if buyer = '51000000-0000-0000-0000-000000000002' then
      perform set_config('request.jwt.claims', json_build_object('sub',buyer,'role','authenticated')::text, true);
      perform public.write_listing_review(conv, true, '깔끔했어요');
    end if;
  end loop;
end $$;

-- 같은 사람과 대화를 더 해도 거래 상대 수는 늘지 않는다
select set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.create_post('vancouver',(select id from public.tags where slug='life'),'의자도 팝니다','상태 좋음','{}','{}',null,'listing',20);
reset role;

do $$
declare tp jsonb;
begin
  tp := public.get_trade_profile('51000000-0000-0000-0000-000000000001'::uuid);
  assert (tp->>'dealPartners')::int = 2, format('two distinct partners, got %s', tp->>'dealPartners');
  assert (tp->'reviews'->>'total')::int = 1, 'one review received';
  assert (tp->'reviews'->>'wouldDealAgain')::int = 1, 'the positive answer is counted';
  assert jsonb_array_length(tp->'openListings') = 2, 'both open listings are listed';
  assert (tp->>'closedListings')::int = 0, 'nothing closed yet';
  assert tp->>'nickname' = '거래왕', 'identity is included';
end $$;

-- 마감하면 열린 목록에서 빠지고 마감 수로 옮겨간다
select set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.set_listing_status(current_setting('test.post')::uuid,'closed');
reset role;
do $$
declare tp jsonb;
begin
  tp := public.get_trade_profile('51000000-0000-0000-0000-000000000001'::uuid);
  assert jsonb_array_length(tp->'openListings') = 1, 'the closed listing leaves the open list';
  assert (tp->>'closedListings')::int = 1, 'and is counted as closed';
end $$;

-- 비로그인도 볼 수 있다 (구매자가 로그인 전에 판단할 수 있어야 한다)
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
  assert (public.get_trade_profile('51000000-0000-0000-0000-000000000001'::uuid)->>'dealPartners')::int = 2,
    'a logged-out visitor can read the record';
end $$;
reset role;

select 'TRADE PROFILE CHECKS PASSED' as result;
