-- Synthetic data only; injected into a transaction or a disposable schema-only database.
insert into auth.users(id,email,raw_app_meta_data)
  select ('b1900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'business-dm-'||n||'@example.test',
    case when n=4 then '{"role":"admin"}'::jsonb else '{"merchant_enabled":true}'::jsonb end from generate_series(1,7)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
  select ('b1900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'업무대화합성검사'||n,'vancouver',now(),now(),now(),'test' from generate_series(1,7)n;
insert into auth.sessions(id,user_id,aal) values('b1990000-0000-4000-8000-000000000004','b1900000-0000-4000-8000-000000000004','aal2');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,record_kind,owner_id,owner_verified_at,trial_ends_at)
  select ('b1910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'합성 비즈니스 '||n,'vancouver','','trial','granted','synthetic backend fixture','business',
    ('b1900000-0000-4000-8000-'||lpad((case n when 1 then 1 else 5 end)::text,12,'0'))::uuid,now(),current_date+2 from generate_series(1,2)n;
insert into private.merchant_operators(merchant_id,user_id) values
  ('b1910000-0000-4000-8000-000000000001','b1900000-0000-4000-8000-000000000002'),
  ('b1910000-0000-4000-8000-000000000002','b1900000-0000-4000-8000-000000000006');
