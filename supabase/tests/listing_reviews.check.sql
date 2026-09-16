insert into auth.users(id,email) values
  ('50000000-0000-0000-0000-000000000001','seller@example.test'),
  ('50000000-0000-0000-0000-000000000002','buyer@example.test'),
  ('50000000-0000-0000-0000-000000000003','stranger@example.test');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
  ('50000000-0000-0000-0000-000000000001','파는사람','vancouver',now(),now(),now(),'test'),
  ('50000000-0000-0000-0000-000000000002','사는사람','vancouver',now(),now(),now(),'test'),
  ('50000000-0000-0000-0000-000000000003','남남남','vancouver',now(),now(),now(),'test');

-- 판매자가 리스팅을 올린다
select set_config('request.jwt.claims','{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.create_post('vancouver',(select id from public.tags where slug='life'),'소파 팝니다','상태 좋아요','{}','{}',null,'listing',120);
reset role;
select set_config('test.post',(select id::text from public.posts where title='소파 팝니다'),true);

-- 구매자가 그 글에서 대화를 건다
select set_config('request.jwt.claims','{"sub":"50000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.conv', public.start_conversation('50000000-0000-0000-0000-000000000001'::uuid, current_setting('test.post')::uuid)::text, true);
reset role;
do $$ begin
  assert (select origin_post_id from public.conversations where id=current_setting('test.conv')::uuid)
    = current_setting('test.post')::uuid, 'the conversation remembers the listing it started from';
end $$;

-- 아직 수락 전이라 후기 자격이 없다
select set_config('request.jwt.claims','{"sub":"50000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  assert (public.get_listing_review_state(current_setting('test.conv')::uuid)->>'canWrite')::boolean = false,
    'no review before the request is accepted';
  begin perform public.write_listing_review(current_setting('test.conv')::uuid, true, '좋았어요');
    raise exception 'must be refused before acceptance';
  exception when sqlstate 'P0001' then if sqlerrm <> 'REVIEW_NOT_ALLOWED' then raise; end if; end;
end $$;
reset role;

-- 판매자가 수락하고 둘이 메시지를 주고받는다
select set_config('request.jwt.claims','{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.respond_direct_conversation(current_setting('test.conv')::uuid,'accepted');
reset role;
insert into public.messages(conversation_id,sender_id,body) values
  (current_setting('test.conv')::uuid,'50000000-0000-0000-0000-000000000002','아직 있나요?');

-- 한쪽만 말했으면 거래로 보지 않는다
select set_config('request.jwt.claims','{"sub":"50000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  assert (public.get_listing_review_state(current_setting('test.conv')::uuid)->>'canWrite')::boolean = false,
    'a one-sided conversation is not a deal';
end $$;
reset role;
insert into public.messages(conversation_id,sender_id,body) values
  (current_setting('test.conv')::uuid,'50000000-0000-0000-0000-000000000001','네 있습니다');

-- 이제 양쪽 다 쓸 수 있다
select set_config('request.jwt.claims','{"sub":"50000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$
declare state jsonb;
begin
  state := public.get_listing_review_state(current_setting('test.conv')::uuid);
  assert (state->>'canWrite')::boolean, 'both sides spoke, the review opens';
  assert state->>'subjectNickname' = '파는사람', 'the counterpart is the subject';
  assert state->'mine' = 'null'::jsonb, 'nothing written yet';
  perform public.write_listing_review(current_setting('test.conv')::uuid, true, '시간 잘 지키셨어요');
end $$;
do $$ begin
  assert (select count(*) from public.listing_reviews)=1,'one review stored';
  assert (select subject_id from public.listing_reviews)='50000000-0000-0000-0000-000000000001','written about the seller';
  -- 같은 대화에 두 번 쓰면 덮어쓴다
  perform public.write_listing_review(current_setting('test.conv')::uuid, false, '연락이 끊겼어요');
  assert (select count(*) from public.listing_reviews)=1,'a second write replaces the first';
  assert (select would_deal_again from public.listing_reviews)=false,'the newer answer wins';
end $$;
reset role;

-- 관계 없는 사람은 못 쓴다
select set_config('request.jwt.claims','{"sub":"50000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin perform public.write_listing_review(current_setting('test.conv')::uuid, true, '몰래쓰기');
    raise exception 'a stranger must be refused';
  exception when sqlstate 'P0001' then if sqlerrm <> 'REVIEW_NOT_ALLOWED' then raise; end if; end;
end $$;
reset role;

-- 클라이언트가 표를 직접 못 고친다
select set_config('request.jwt.claims','{"sub":"50000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin update public.listing_reviews set would_deal_again=true;
    raise exception 'direct writes must be refused';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 평판 집계
do $$
declare rep jsonb;
begin
  rep := public.get_listing_reputation('50000000-0000-0000-0000-000000000001'::uuid, 5);
  assert (rep->>'total')::int = 1, 'one review counted';
  assert (rep->>'wouldDealAgain')::int = 0, 'the negative answer is reflected';
  assert jsonb_array_length(rep->'recent') = 1, 'the comment is listed';
end $$;

-- 후기도 감시어 검사를 받는다
insert into private.watch_terms(term,category,severity,active) values ('후기감시어','fraud','high',true) on conflict do nothing;
select set_config('request.jwt.claims','{"sub":"50000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.write_listing_review(current_setting('test.conv')::uuid, false, '이 사람 후기감시어 조심하세요');
reset role;
do $$ begin
  assert exists (select 1 from public.safety_alerts where target_type='listing_review'),
    'a review containing a watch term raises an alert';
end $$;

select 'LISTING REVIEW CHECKS PASSED' as result;
