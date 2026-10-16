begin;
insert into auth.users(id,email) values
 ('d1500000-0000-0000-0000-000000000001','map-author@example.test'),
 ('d1500000-0000-0000-0000-000000000002','map-viewer@example.test');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
 ('d1500000-0000-0000-0000-000000000001','지도검증작성자','vancouver',now(),now(),now(),'test'),
 ('d1500000-0000-0000-0000-000000000002','지도검증열람자','vancouver',now(),now(),now(),'test');
insert into public.posts(id,author_id,city_id,tag_id,title,body,kind,listing_status,price,expires_at) values
 ('d1500000-0000-0000-0000-000000000003','d1500000-0000-0000-0000-000000000001','vancouver',19,'지도검증 거래','Google 지도: https://www.google.com/maps/search/?api=1&query=49.28%2C-123.12'||chr(10)||'위치: 도서관 앞','listing','open',20,now()+interval '1 day');
set local role anon;
select public.record_behavior_events('qa-discovery-map-20261015','web',
 '[{"seq":1,"screen":"discovery","kind":"press","target":"discovery.mode","value":1},{"seq":2,"screen":"discovery","kind":"press","target":"discovery.map.retry","value":1}]');
do $$ begin
 if exists(select 1 from public.get_discovery_posts('vancouver') where id='d1500000-0000-0000-0000-000000000003') then raise exception 'Anonymous map leaked body coordinates'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"d1500000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.record_app_visit('web','discovery','1.1.4');
do $$ begin
 if (select count(*) from public.get_discovery_posts('vancouver',19::smallint,'지도검증') where id='d1500000-0000-0000-0000-000000000003') <> 1 then raise exception 'Published map listing missing'; end if;
 if exists(select 1 from public.get_discovery_posts('toronto',19::smallint,'지도검증')) then raise exception 'Map crossed city boundary'; end if;
 if exists(select 1 from public.get_discovery_posts('vancouver',14::smallint,'지도검증')) then raise exception 'Map crossed category boundary'; end if;
end $$;
reset role;
update public.posts set listing_status='closed' where id='d1500000-0000-0000-0000-000000000003';
do $$ begin if exists(select 1 from public.get_discovery_posts('vancouver',19::smallint,'지도검증')) then raise exception 'Closed listing visible'; end if; end $$;
update public.posts set listing_status='open',expires_at=now()-interval '1 second' where id='d1500000-0000-0000-0000-000000000003';
do $$ begin if exists(select 1 from public.get_discovery_posts('vancouver',19::smallint,'지도검증')) then raise exception 'Expired listing visible'; end if; end $$;
update public.posts set expires_at=now()+interval '1 day' where id='d1500000-0000-0000-0000-000000000003';
update public.profiles set account_status='suspended' where id='d1500000-0000-0000-0000-000000000001';
do $$ begin if exists(select 1 from public.get_discovery_posts('vancouver',19::smallint,'지도검증')) then raise exception 'Inactive author visible'; end if; end $$;
update public.profiles set account_status='active' where id='d1500000-0000-0000-0000-000000000001';
insert into public.blocks(blocker_id,blocked_id) values ('d1500000-0000-0000-0000-000000000002','d1500000-0000-0000-0000-000000000001');
do $$ begin if exists(select 1 from public.get_discovery_posts('vancouver',19::smallint,'지도검증')) then raise exception 'Blocked author visible'; end if; end $$;
delete from public.blocks where blocker_id='d1500000-0000-0000-0000-000000000002';
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code,details) values
 ('d1500000-0000-0000-0000-000000000002','d1500000-0000-0000-0000-000000000001','post','d1500000-0000-0000-0000-000000000003','other','Map QA rollback');
do $$ begin if exists(select 1 from public.get_discovery_posts('vancouver',19::smallint,'지도검증')) then raise exception 'Reported post visible'; end if; end $$;
delete from public.reports where target_id='d1500000-0000-0000-0000-000000000003';
update public.posts set status='removed' where id='d1500000-0000-0000-0000-000000000003';
do $$ begin if exists(select 1 from public.get_discovery_posts('vancouver',19::smallint,'지도검증')) then raise exception 'Removed post visible'; end if; end $$;
update public.posts set status='published',body='위치 없는 글' where id='d1500000-0000-0000-0000-000000000003';
do $$ begin if exists(select 1 from public.get_discovery_posts('vancouver',19::smallint,'지도검증')) then raise exception 'Removed location persisted'; end if; end $$;
rollback;
