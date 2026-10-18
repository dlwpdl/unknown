begin;
set local search_path=public,extensions;
select no_plan();
-- business dm fixtures
insert into public.posts(id,author_id,city_id,tag_id,title,body,kind,business_author_id,listing_status,expires_at) values
 ('b19a0000-0000-4000-8000-000000000001','b1900000-0000-4000-8000-000000000003','vancouver',1,'Synthetic personal listing','Backend-only context','listing',null,'open',now()+interval '7 days'),
 ('b19a0000-0000-4000-8000-000000000002','b1900000-0000-4000-8000-000000000007','vancouver',1,'Other author','Backend-only context','story',null,null,null),
 ('b19a0000-0000-4000-8000-000000000003','b1900000-0000-4000-8000-000000000001','vancouver',1,'Synthetic hiring context','Backend-only context','story','b1910000-0000-4000-8000-000000000001',null,null);
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.start_business_conversation('b1910000-0000-4000-8000-000000000001',null,'b1900000-0000-4000-8000-000000000003','b19a0000-0000-4000-8000-000000000001')$$,'business can contact visible personal listing author with exact context');
select throws_ok($$select public.start_business_conversation('b1910000-0000-4000-8000-000000000001',null,'b1900000-0000-4000-8000-000000000003','b19a0000-0000-4000-8000-000000000002')$$,'P0001','INVALID_BUSINESS_POST','context cannot spoof another personal author');
select throws_ok($$select public.start_business_conversation('b1910000-0000-4000-8000-000000000001',null,'b1900000-0000-4000-8000-000000000001','b19a0000-0000-4000-8000-000000000003')$$,'P0001','INVALID_BUSINESS_POST','business post context cannot resolve to its private human owner');
reset role;
select is((select context_post_id from public.conversations where kind='business' and user_low_id='b1900000-0000-4000-8000-000000000003'),'b19a0000-0000-4000-8000-000000000001'::uuid,'valid personal context is saved without changing endpoints');
update public.posts set status='removed' where id='b19a0000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.start_business_conversation('b1910000-0000-4000-8000-000000000001',null,'b1900000-0000-4000-8000-000000000003','b19a0000-0000-4000-8000-000000000001')$$,'P0001','INVALID_BUSINESS_POST','hidden personal context cannot be used even for existing room');
reset role;
update public.posts set status='published' where id='b19a0000-0000-4000-8000-000000000001';
select is((select count(*) from private.behavior_targets where id in ('chat.identity.open','chat.identity.close','chat.identity.options','chat.identity.personal','chat.identity.business','chat.peer-profile','chat.sender-profile')),7::bigint,'all seven fixed business identity controls are accepted by server analytics');
select * from finish();
rollback;
