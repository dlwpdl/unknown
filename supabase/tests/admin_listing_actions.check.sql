-- Run through the existing SQL connection; every fixture and action rolls back.
begin;
set local plpgsql.check_asserts = on;
insert into auth.users(id,email,raw_app_meta_data) values
('a1210000-0000-0000-0000-000000000001','listing-admin@example.test','{"role":"admin"}'),
('a1210000-0000-0000-0000-000000000002','listing-author@example.test','{}'),
('a1210000-0000-0000-0000-000000000003','listing-stranger@example.test','{}');
insert into auth.sessions(id,user_id,aal) values
('a1216000-0000-0000-0000-000000000001','a1210000-0000-0000-0000-000000000001','aal2');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
('a1210000-0000-0000-0000-000000000001','끌올관리검사','vancouver',now(),now(),now(),'test'),
('a1210000-0000-0000-0000-000000000002','끌올작성검사','vancouver',now(),now(),now(),'test'),
('a1210000-0000-0000-0000-000000000003','끌올타인검사','vancouver',now(),now(),now(),'test');
insert into public.posts(id,author_id,city_id,tag_id,title,body,kind,listing_status,expires_at) values
('a1212000-0000-0000-0000-000000000001','a1210000-0000-0000-0000-000000000002','vancouver',(select id from public.tags where slug='life'),'관리자 거래 검사','검사용 판매글','listing','open',now()+interval '14 days'),
('a1212000-0000-0000-0000-000000000002','a1210000-0000-0000-0000-000000000001','vancouver',(select id from public.tags where slug='life'),'관리자 본인 검사','검사용 판매글','listing','open',now()+interval '14 days');
insert into private.personal_bump_state(user_id,last_bumped_at) values('a1210000-0000-0000-0000-000000000001',now());
create function pg_temp.expect_listing_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when raise_exception then
    if sqlerrm = expected then return; end if;
    raise;
  end;
  raise exception 'Expected %, but the action succeeded', expected;
end;
$$;

select set_config('request.jwt.claims','{"sub":"a1210000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect_listing_error($$select public.bump_post('a1212000-0000-0000-0000-000000000001')$$,'POST_NOT_FOUND');
select pg_temp.expect_listing_error($$select public.set_listing_status('a1212000-0000-0000-0000-000000000001','closed')$$,'POST_NOT_FOUND');
reset role;
select set_config('request.jwt.claims','{"sub":"a1210000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","session_id":"a1216000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select pg_temp.expect_listing_error($$select public.bump_post('a1212000-0000-0000-0000-000000000001')$$,'POST_NOT_FOUND');
select pg_temp.expect_listing_error($$select public.set_listing_status('a1212000-0000-0000-0000-000000000001','partial')$$,'POST_NOT_FOUND');
reset role;
select set_config('request.jwt.claims','{"sub":"a1210000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"a1216000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select public.set_listing_status('a1212000-0000-0000-0000-000000000001','partial');
do $$begin
  assert (select listing_status='partial' from public.posts where id='a1212000-0000-0000-0000-000000000001'), 'admin marks another author listing partially sold';
end$$;
select public.set_listing_status('a1212000-0000-0000-0000-000000000001','closed');
do $$begin
  assert (select listing_status='closed' from public.posts where id='a1212000-0000-0000-0000-000000000001'), 'admin closes another author listing';
end$$;
select public.set_listing_status('a1212000-0000-0000-0000-000000000001','open');
select public.bump_post('a1212000-0000-0000-0000-000000000001');
select public.bump_post('a1212000-0000-0000-0000-000000000002');
select public.bump_post('a1212000-0000-0000-0000-000000000002');
select pg_temp.expect_listing_error($$select public.set_listing_status('a1212000-0000-0000-0000-000000000001','invalid')$$,'INVALID_LISTING_STATUS');
select pg_temp.expect_listing_error($$select public.bump_post('a1212000-0000-0000-0000-000000000099')$$,'POST_NOT_FOUND');
reset role;
do $$begin
  assert (select listing_status='open' and bump_count=1 and sort_at=now() and author_id='a1210000-0000-0000-0000-000000000002' from public.posts where id='a1212000-0000-0000-0000-000000000001'), 'bump preserves the author and updates ordering';
  assert (select bump_count=2 from public.posts where id='a1212000-0000-0000-0000-000000000002'), 'admin bypasses per-post and account bump cooldowns';
  assert (select count(*)=6 from public.admin_access_logs where actor_id='a1210000-0000-0000-0000-000000000001' and scope='posts'), 'every successful admin action is audited';
  assert (select count(*)=4 from public.admin_access_logs where actor_id='a1210000-0000-0000-0000-000000000001' and subject_user_id='a1210000-0000-0000-0000-000000000002' and resource_id='a1212000-0000-0000-0000-000000000001'), 'audit identifies the author and listing';
end$$;
select set_config('request.jwt.claims','{"sub":"a1210000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect_listing_error($$select public.bump_post('a1212000-0000-0000-0000-000000000001')$$,'BUMP_COOLDOWN');
select public.set_listing_status('a1212000-0000-0000-0000-000000000001','closed');
reset role;
delete from auth.sessions where id='a1216000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"a1210000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"a1216000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select pg_temp.expect_listing_error($$select public.set_listing_status('a1212000-0000-0000-0000-000000000001','open')$$,'POST_NOT_FOUND');
reset role;
select 'admin listing actions passed' as result;
rollback;
