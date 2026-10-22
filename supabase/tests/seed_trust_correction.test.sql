begin;
select no_plan();

-- Known seed accounts have no earned trust; each protected path is made explicit.
update public.profiles set verification_level=3
where id between '10000000-0000-0000-0000-000000000134'::uuid and '10000000-0000-0000-0000-000000000141'::uuid;
update auth.users set email='claimed-seed@example.invalid' where id='10000000-0000-0000-0000-000000000135';
update auth.users set raw_app_meta_data='{"role":"admin"}' where id='10000000-0000-0000-0000-000000000136';
update auth.users set raw_app_meta_data='{"verified_trust":true}' where id='10000000-0000-0000-0000-000000000137';
update auth.users set phone='+16045550138',phone_confirmed_at=now() where id='10000000-0000-0000-0000-000000000138';
insert into auth.identities(provider_id,user_id,identity_data,provider)
values('seed-trust-real-identity','10000000-0000-0000-0000-000000000139','{"sub":"seed-trust-real-identity"}','google');
insert into private.personal_info(user_id,full_name,date_of_birth,consent_version)
values('10000000-0000-0000-0000-000000000140','Synthetic proof fixture','1990-01-01','test');

insert into auth.users(id,email,raw_app_meta_data) values
('15400000-0000-0000-0000-000000000001','seed-trust-admin@example.invalid','{"role":"admin"}'),
('15400000-0000-0000-0000-000000000002','seed-trust-real-member@example.invalid','{}'),
('10000000-0000-0000-0000-000000000143','u143@seed.gling.invalid','{}'),
('10000000-0000-0000-0000-00000000000a','u999@seed.gling.invalid','{}');
insert into public.profiles(id,nickname,city_id,verification_level) values
('15400000-0000-0000-0000-000000000001','정정관리자','vancouver',3),
('15400000-0000-0000-0000-000000000002','실회원검사','vancouver',3),
('10000000-0000-0000-0000-000000000143','미등록예시','vancouver',3),
('10000000-0000-0000-0000-00000000000a','미등록십육진수','vancouver',3);
insert into auth.sessions(id,user_id,aal)
values('15490000-0000-0000-0000-000000000001','15400000-0000-0000-0000-000000000001','aal2');
update public.profiles set verification_level=1 where id='10000000-0000-0000-0000-000000000141';
select set_config('request.jwt.claims','{"sub":"15400000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"role":"admin"},"aal":"aal2","session_id":"15490000-0000-0000-0000-000000000001"}',true);
set local role authenticated;
select lives_ok($$select public.set_admin_verification_level('10000000-0000-0000-0000-000000000141',3::smallint)$$,'trusted AAL2 admin grant uses the actual audited setter');
reset role;

create temporary table seed_trust_preserved as
select 'posts' as source,count(*) as total,md5(coalesce(string_agg(md5(row_to_json(p)::text),'' order by p.id),'')) as fingerprint from public.posts p
union all select 'reviews',count(*),md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),'')) from private.merchant_reviews r
union all select 'accounts',count(*),md5(coalesce(string_agg(md5(row_to_json(u)::text),'' order by u.id),'')) from auth.users u
union all select 'audit',count(*),md5(coalesce(string_agg(md5(row_to_json(l)::text),'' order by l.id),'')) from public.admin_access_logs l;

\ir ../migrations/0154_remove_unearned_synthetic_l3.sql

select is((select verification_level::int from public.profiles where id='10000000-0000-0000-0000-000000000134'),1,'unearned known synthetic L3 returns to social-login level');
select is((select verification_level::int from public.profiles where id='10000000-0000-0000-0000-000000000135'),3,'changed real-account email is preserved');
select is((select verification_level::int from public.profiles where id='10000000-0000-0000-0000-000000000136'),3,'administrator badge is preserved');
select is((select verification_level::int from public.profiles where id='10000000-0000-0000-0000-000000000137'),3,'trusted account metadata is preserved');
select is((select verification_level::int from public.profiles where id='10000000-0000-0000-0000-000000000138'),3,'confirmed phone identity is preserved');
select is((select verification_level::int from public.profiles where id='10000000-0000-0000-0000-000000000139'),3,'authenticated provider identity is preserved');
select is((select verification_level::int from public.profiles where id='10000000-0000-0000-0000-000000000140'),3,'account with personal information is preserved conservatively');
select is((select verification_level::int from public.profiles where id='10000000-0000-0000-0000-000000000141'),3,'actual audited admin trust grant is preserved');
select is((select verification_level::int from public.profiles where id='10000000-0000-0000-0000-000000000143'),3,'unknown future seed account is outside this correction');
select is((select verification_level::int from public.profiles where id='10000000-0000-0000-0000-00000000000a'),3,'unknown hexadecimal UUID inside the old interval remains L3 without an unsafe numeric cast');
select is((select verification_level::int from public.profiles where id='15400000-0000-0000-0000-000000000002'),3,'real member L3 is preserved');
select results_eq(
  $$select 'posts' as source,count(*) as total,md5(coalesce(string_agg(md5(row_to_json(p)::text),'' order by p.id),'')) as fingerprint from public.posts p
    union all select 'reviews',count(*),md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by r.id),'')) from private.merchant_reviews r
    union all select 'accounts',count(*),md5(coalesce(string_agg(md5(row_to_json(u)::text),'' order by u.id),'')) from auth.users u
    union all select 'audit',count(*),md5(coalesce(string_agg(md5(row_to_json(l)::text),'' order by l.id),'')) from public.admin_access_logs l order by source$$,
  $$select * from seed_trust_preserved order by source$$,'post/review/account/audit counts and full-row hashes remain identical');
create temporary table seed_trust_once as select id,verification_level,updated_at from public.profiles;
\ir ../migrations/0154_remove_unearned_synthetic_l3.sql
select results_eq($$select id,verification_level,updated_at from public.profiles order by id$$,
  $$select * from seed_trust_once order by id$$,'correction is idempotent, including profile timestamps');
select * from finish();
rollback;
