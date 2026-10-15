begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('partnership-test','제휴 검사 도시','BC','America/Vancouver',true);

insert into auth.users(id,email,raw_app_meta_data) values
 ('a1500000-0000-0000-0000-000000000001','partnership-admin@example.test','{"role":"admin"}'),
 ('a1500000-0000-0000-0000-000000000002','partnership-member@example.test','{}'),
 ('a1500000-0000-0000-0000-000000000003','partnership-member2@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
 ('a1500000-0000-0000-0000-000000000001','제휴관리검사','partnership-test'),
 ('a1500000-0000-0000-0000-000000000002','제휴회원검사','partnership-test'),
 ('a1500000-0000-0000-0000-000000000003','제휴회원검사2','partnership-test');
insert into auth.sessions(id,user_id,aal) values
 ('a1560000-0000-0000-0000-000000000001','a1500000-0000-0000-0000-000000000001','aal2');

select set_config('request.jwt.claims','{"sub":"a1500000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_partnerships('creators')$$,'P0001','ADMIN_REQUIRED','forged admin claim cannot read partnerships');
select throws_ok($$select public.save_admin_partnership('creator','{}')$$,'P0001','ADMIN_REQUIRED','ordinary member cannot mutate partnerships');
select throws_ok($$select public.issue_admin_benefit_coupon(gen_random_uuid(),gen_random_uuid())$$,'P0001','ADMIN_REQUIRED','ordinary member cannot issue coupons');
select throws_ok($$select public.act_admin_benefit_coupon(gen_random_uuid(),now(),'redeem','test')$$,'P0001','ADMIN_REQUIRED','ordinary member cannot redeem coupons');
reset role;
select set_config('request.jwt.claims','{"sub":"a1500000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","session_id":"a1560000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_partnerships('creators')$$,'P0001','ADMIN_REQUIRED','AAL1 administrator cannot read partnerships');
select throws_ok($$select public.save_admin_partnership('creator','{}')$$,'P0001','ADMIN_REQUIRED','AAL1 administrator cannot save partnerships');
select throws_ok($$select public.issue_admin_benefit_coupon(gen_random_uuid(),gen_random_uuid())$$,'P0001','ADMIN_REQUIRED','AAL1 administrator cannot issue coupons');
select throws_ok($$select public.act_admin_benefit_coupon(gen_random_uuid(),now(),'revoke','test')$$,'P0001','ADMIN_REQUIRED','AAL1 administrator cannot revoke coupons');
reset role;
-- A missing authorization check, terms lock or atomic quota makes these real-RPC checks fail.
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind) values
 ('a1520000-0000-0000-0000-000000000001','제휴 검사 업체','partnership-test','trial','granted','동의 확인','business'),
 ('a1520000-0000-0000-0000-000000000002','제휴 검사 출처','partnership-test','lead','pending','','source'),
 ('a1520000-0000-0000-0000-000000000003','다른 검사 업체','partnership-test','trial','granted','동의 확인','business');
create function pg_temp.doc(kind text, rid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  case kind
    when 'creator' then return (select to_jsonb(r) from private.partnership_creators r where id=rid);
    when 'campaign' then return (select to_jsonb(r) from private.partnership_campaigns r where id=rid);
    when 'benefit' then return (select to_jsonb(r) from private.partnership_benefits r where id=rid);
    when 'participation' then return (select to_jsonb(r) from private.partnership_participations r where id=rid);
    when 'coupon' then return (select to_jsonb(r) from private.partnership_coupons r where id=rid);
  end case;
end $$;
create function pg_temp.save(kind text,rid uuid,patch jsonb) returns uuid language sql as $$
 select public.save_admin_partnership(kind,patch||jsonb_build_object('id',rid),(pg_temp.doc(kind,rid)->>'updated_at')::timestamptz)
$$;
select set_config('request.jwt.claims','{"sub":"a1500000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"a1560000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_partnerships('oops')$$,'P0001','INVALID_PARTNERSHIP','unknown list kind refused');
select throws_ok($$select public.get_admin_partnerships('creators','',-1)$$,'P0001','INVALID_PARTNERSHIP','negative list offset refused');
select throws_ok($$select public.get_admin_partnerships('creators','',0,gen_random_uuid())$$,'P0001','PARTNERSHIP_NOT_FOUND','missing detail is explicit');
select throws_ok($$select public.save_admin_partnership('oops','{}')$$,'P0001','INVALID_PARTNERSHIP','unknown save kind refused');
select throws_ok($$select public.save_admin_partnership('creator','[]')$$,'P0001','INVALID_PARTNERSHIP','record must be an object');
select throws_ok($$select public.save_admin_partnership('creator','{"id":"bad"}')$$,'P0001','INVALID_PARTNERSHIP','bad UUID maps to bounded error');
select throws_ok($$select public.save_admin_partnership('creator','{"id":"a1510000-0000-0000-0000-000000000001","code":"override"}')$$,'P0001','INVALID_PARTNERSHIP','unknown server-owned fields refused');
select throws_ok($$select public.save_admin_partnership('creator','{"id":"a1510000-0000-0000-0000-000000000001","display_name":123}')$$,'P0001','INVALID_PARTNERSHIP','typed fields refuse coercion');
select throws_ok($$select pg_temp.save('creator','a1510000-0000-0000-0000-000000000001','{"display_name":"Creator","city_id":"partnership-test","profile_url":"http://example.com/c"}')$$,'P0001','INVALID_PARTNERSHIP','creator requires public HTTPS profile');
select throws_ok($$select pg_temp.save('creator','a1510000-0000-0000-0000-000000000001','{"display_name":"Creator","city_id":"missing","profile_url":"https://example.com/c"}')$$,'P0001','INVALID_PARTNERSHIP','creator city must exist');
select throws_ok($$select pg_temp.save('creator','a1510000-0000-0000-0000-000000000001','{"display_name":"Creator","city_id":"partnership-test","profile_url":"https://example.com/c","reference_views":5000}')$$,'P0001','INVALID_PARTNERSHIP','reference view count needs source URL');
select lives_ok($$select pg_temp.save('creator','a1510000-0000-0000-0000-000000000001','{"display_name":"Creator Alpha","city_id":"partnership-test","profile_url":"https://example.com/alpha","member_id":"a1500000-0000-0000-0000-000000000002"}')$$,'creator can link an active member');
select lives_ok($$select pg_temp.save('creator','a1510000-0000-0000-0000-000000000002','{"display_name":"Creator Beta","city_id":"partnership-test","profile_url":"https://example.com/beta"}')$$,'creator can precede membership');
select lives_ok($$select pg_temp.save('creator','a1510000-0000-0000-0000-000000000001','{"category":"Dining Reference"}')$$,'creator category saved');
select is(jsonb_array_length(public.get_admin_partnerships('creators','EXAMPLE.COM/ALPHA')->'rows'),1,'creator search matches social profile case-insensitively');
select is(jsonb_array_length(public.get_admin_partnerships('creators','제휴 검사 도시')->'rows'),2,'creator search matches city name');
select is(jsonb_array_length(public.get_admin_partnerships('creators','partnership-test')->'rows'),2,'creator search matches city id');
select is(jsonb_array_length(public.get_admin_partnerships('creators','dining reference')->'rows'),1,'creator search matches category');
select is(jsonb_array_length(public.get_admin_partnerships('creators','제휴회원검사')->'rows'),1,'creator search retains linked member name');
select throws_ok($$select pg_temp.save('creator','a1510000-0000-0000-0000-000000000003','{"display_name":"duplicate","city_id":"partnership-test","profile_url":"https://EXAMPLE.com/alpha/?utm_source=x"}')$$,'P0001','PARTNERSHIP_DUPLICATE','canonical profiles cannot duplicate');
select throws_ok($$select pg_temp.save('creator','a1510000-0000-0000-0000-000000000003','{"display_name":"www duplicate","city_id":"partnership-test","profile_url":"https://www.example.com/alpha"}')$$,'P0001','PARTNERSHIP_DUPLICATE','canonical profile treats www alias as the same recipient');
select throws_ok($$select pg_temp.save('creator','a1510000-0000-0000-0000-000000000003','{"display_name":"duplicate member","city_id":"partnership-test","profile_url":"https://example.com/third","member_id":"a1500000-0000-0000-0000-000000000002"}')$$,'P0001','PARTNERSHIP_DUPLICATE','member link is unique');
-- Alias spellings must not manufacture a second coupon recipient.
select throws_ok(format('select pg_temp.save(''creator'',%L::uuid,%L::jsonb)',gen_random_uuid(),
  jsonb_build_object('display_name','Rejected profile alias','city_id','partnership-test','profile_url',url)::text),
  'P0001','INVALID_PARTNERSHIP',label)
from (values
  ('https://www.instagram.com/%61lpha/','encoded unreserved ASCII profile is refused'),
  ('https://example.com/creator%2fother','encoded slash is refused'),
  ('https://example.com/%2E/creator','encoded dot is refused'),
  ('https://example.com/creator%3Fother','encoded query marker is refused'),
  ('https://example.com/creator%23other','encoded hash is refused'),
  ('https://example.com/creator%5Cother','encoded backslash is refused'),
  ('https://example.com/creator'||chr(92)||'other','literal backslash alias is refused'),
  ('https://example.com/creator%25other','encoded percent cannot hide a second encoding'),
  ('https://example.com/creator%00','encoded ASCII control is refused'),
  ('https://example.com/creator%7f','encoded ASCII DEL is refused'),
  ('https://example.com/./creator','literal current-directory segment is refused'),
  ('https://example.com/a/../creator','literal parent-directory segment is refused'),
  ('https://example.com/creator/.','terminal dot segment is refused'),
  ('https://example.com/creator/..','terminal parent segment is refused'),
  ('https://example.com//creator','duplicate path slash is refused'),
  ('https://example.com/creator//','duplicate trailing path slash is refused'),
  ('https://example.com/creator%','incomplete percent escape is refused'),
  ('https://example.com/creator%8G','malformed percent escape is refused'),
  ('https://example.com/%E9','truncated UTF8 sequence is refused'),
  ('https://example.com/%C0%AF','overlong UTF8 cannot conceal an ASCII slash'),
  ('https://example.com/%ED%A0%80','UTF8 surrogate is refused'),
  ('https://example.com/%F4%90%80%80','UTF8 above the Unicode maximum is refused')
) aliases(url,label);
select lives_ok(format('select pg_temp.save(''creator'',%L::uuid,%L::jsonb)',gen_random_uuid(),
  jsonb_build_object('display_name','Canonical profile test','city_id','partnership-test','profile_url',url)::text),label)
from (values
  ('https://www.youtube.com/channel/UCProfileCASE','first case-sensitive YouTube channel is saved'),
  ('https://www.youtube.com/channel/UCProfileCase','distinct case-sensitive YouTube channel is saved'),
  ('https://Example.com/CreatorCase','generic host case is normalized without changing path case'),
  ('https://example.com/creatorcase','distinct generic path case is saved'),
  ('https://www.instagram.com/KeyHandle/','Instagram handle is saved'),
  ('https://www.threads.net/@KeyHandle','Threads legacy host handle is saved'),
  ('https://www.tiktok.com/@KeyHandle','TikTok handle is saved'),
  ('https://www.youtube.com/@KeyHandle','YouTube handle is saved'),
  ('https://example.com/%E3%81%82','normal encoded non-ASCII UTF8 profile is saved'),
  ('https://www.youtube.com/@%ED%95%9C%EA%B8%80','Korean UTF8 YouTube handle is saved')
) profiles(url,label);
select throws_ok(format('select pg_temp.save(''creator'',%L::uuid,%L::jsonb)',gen_random_uuid(),
  jsonb_build_object('display_name','Duplicate profile test','city_id','partnership-test','profile_url',url)::text),
  'P0001','PARTNERSHIP_DUPLICATE',label)
from (values
  ('https://EXAMPLE.com/CreatorCase/?utm_source=x','host/query/trailing slash aliases still duplicate'),
  ('https://instagram.com/keyhandle?utm_source=x','Instagram handle case still duplicates'),
  ('https://threads.com/@keyhandle/','Threads host and handle aliases duplicate'),
  ('https://tiktok.com/@keyhandle/','TikTok handle case still duplicates'),
  ('https://youtube.com/@keyhandle/','YouTube handle case still duplicates'),
  ('https://example.com/%e3%81%82','UTF8 percent-hex case aliases duplicate'),
  ('https://example.com/あ','literal and encoded UTF8 paths identify the same profile')
) aliases(url,label);
select throws_ok($$select public.save_admin_partnership('creator','{"id":"a1510000-0000-0000-0000-000000000001","notes":"overwrite"}')$$,'P0001','PARTNERSHIP_CHANGED','create-only retry cannot overwrite an existing record');
select throws_ok($$select public.save_admin_partnership('creator','{"id":"a1510000-0000-0000-0000-000000000001","notes":"overwrite"}','2000-01-01')$$,'P0001','PARTNERSHIP_CHANGED','stale save rejected');
select lives_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000001','{"merchant_id":"a1520000-0000-0000-0000-000000000001","title":"Campaign Alpha","support_amount_cents":15000,"team_limit":1}')$$,'draft retains unresolved terms, currency and date');
select throws_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000001','{"status":"open"}')$$,'P0001','PARTNERSHIP_TERMS_REQUIRED','opening needs confirmed full terms');
select throws_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000001','{"ends_on":"not-a-date"}')$$,'P0001','INVALID_PARTNERSHIP','malformed dates rejected');
select throws_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000001','{"ends_on":"infinity"}')$$,'P0001','INVALID_PARTNERSHIP','unbounded dates rejected');
select throws_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000001','{"team_limit":1.2}')$$,'P0001','INVALID_PARTNERSHIP','fractional team count rejected');
select throws_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000001','{"team_limit":"2"}')$$,'P0001','INVALID_PARTNERSHIP','numeric strings rejected');
select throws_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000001',jsonb_build_object('status','open','terms','Visit','terms_confirmed',true,'ends_on',current_date+10))$$,'P0001','PARTNERSHIP_TERMS_REQUIRED','proposed money requires explicit currency before opening');
select throws_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000001',jsonb_build_object('status','open','terms','Visit','terms_confirmed',true,'currency','CAD','ends_on',current_date-1))$$,'P0001','PARTNERSHIP_TERMS_REQUIRED','expired campaign cannot open');
select throws_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000001','{"support_amount_cents":100000000}')$$,'P0001','INVALID_PARTNERSHIP','unlocked money must remain within cents bound');
select lives_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000001',jsonb_build_object('status','open','terms','One visit and content','terms_confirmed',true,'currency','CAD','ends_on',current_date+30))$$,'complete campaign opens');
select lives_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000001','{"campaign_id":"a1530000-0000-0000-0000-000000000001","creator_id":"a1510000-0000-0000-0000-000000000001"}')$$,'first application saved');
select lives_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000002','{"campaign_id":"a1530000-0000-0000-0000-000000000001","creator_id":"a1510000-0000-0000-0000-000000000002"}')$$,'second application saved');
select throws_ok($$select pg_temp.save('participation',gen_random_uuid(),'{"campaign_id":"a1530000-0000-0000-0000-000000000001","creator_id":"a1510000-0000-0000-0000-000000000001"}')$$,'P0001','PARTNERSHIP_DUPLICATE','one application per campaign/creator');
select throws_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000001','{"stage":"completed","content_url":"https://example.com/content"}')$$,'P0001','PARTNERSHIP_STAGE','cannot skip lifecycle stages');
select lives_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000001','{"stage":"selected"}')$$,'selection occupies one team slot');
select throws_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000002','{"stage":"selected"}')$$,'P0001','PARTNERSHIP_CAPACITY','team limit includes selected teams');
select throws_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000001','{"support_amount_cents":16000}')$$,'P0001','PARTNERSHIP_TERMS_LOCKED','amount locked after selection');
select throws_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000001','{"deadline_note":"Different delivery deadline"}')$$,'P0001','PARTNERSHIP_TERMS_LOCKED','deadline conditions locked after selection');
select throws_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000001',jsonb_build_object('stage','visited','visited_at',now()+interval '1 day'))$$,'P0001','PARTNERSHIP_STAGE','visit requires a real past time');
select throws_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000001','{"payment_status":"paid","payment_note":"record"}')$$,'P0001','PARTNERSHIP_STAGE','payment cannot precede content submission');
select lives_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000001',jsonb_build_object('stage','visited','visited_at',now()-interval '1 hour'))$$,'visit confirmed');
select throws_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000001','{"stage":"submitted"}')$$,'P0001','PARTNERSHIP_STAGE','submission requires content URL');
select lives_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000001','{"stage":"submitted","content_url":"https://example.com/content","actual_views":0,"payment_status":"paid","payment_note":"Owner verified transfer"}')$$,'submitted content can record paid without invented view threshold');
select throws_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000001','{"stage":"cancelled"}')$$,'P0001','PARTNERSHIP_STAGE','paid team cannot silently cancel');
select throws_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000001','{"payment_status":"pending"}')$$,'P0001','PARTNERSHIP_STAGE','paid cannot silently revert');
select throws_ok($$select pg_temp.save('benefit',gen_random_uuid(),'{"merchant_id":"a1520000-0000-0000-0000-000000000003","campaign_id":"a1530000-0000-0000-0000-000000000001","title":"Borrowed campaign","audience":"creators"}')$$,'P0001','INVALID_PARTNERSHIP','benefit and campaign merchant must match');
select throws_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000001','{"creator_id":"a1510000-0000-0000-0000-000000000002"}')$$,'P0001','PARTNERSHIP_TERMS_LOCKED','existing participation cannot swap creator identity');
select lives_ok($$select pg_temp.save('benefit','a1550000-0000-0000-0000-000000000001',jsonb_build_object('merchant_id','a1520000-0000-0000-0000-000000000001','campaign_id','a1530000-0000-0000-0000-000000000001','title','Creator visit','audience','creators','status','active','discount_percent',25,'terms','One use only','terms_confirmed',true,'expires_on',current_date+20,'issue_limit',1))$$,'confirmed creator benefit activates');
select throws_ok($$select public.issue_admin_benefit_coupon(gen_random_uuid(),'a1550000-0000-0000-0000-000000000001',null,'a1500000-0000-0000-0000-000000000002')$$,'P0001','INVALID_PARTNERSHIP','creator benefit cannot target member identity');
select throws_ok($$select public.issue_admin_benefit_coupon(gen_random_uuid(),'a1550000-0000-0000-0000-000000000001','a1510000-0000-0000-0000-000000000002')$$,'P0001','PARTNERSHIP_INACTIVE','unselected creator cannot receive campaign coupon');
select throws_ok($$select public.issue_admin_benefit_coupon(gen_random_uuid(),'a1550000-0000-0000-0000-000000000001','a1510000-0000-0000-0000-000000000001','a1500000-0000-0000-0000-000000000002')$$,'P0001','INVALID_PARTNERSHIP','issuance requires exactly one recipient kind');
select is(public.issue_admin_benefit_coupon('a1570000-0000-0000-0000-000000000001','a1550000-0000-0000-0000-000000000001','a1510000-0000-0000-0000-000000000001'),'a1570000-0000-0000-0000-000000000001'::uuid,'stable issuance id returned');
select is(public.issue_admin_benefit_coupon('a1570000-0000-0000-0000-000000000001','a1550000-0000-0000-0000-000000000001','a1510000-0000-0000-0000-000000000001'),'a1570000-0000-0000-0000-000000000001'::uuid,'identical issuance retry is idempotent');
select throws_ok($$select public.issue_admin_benefit_coupon('a1570000-0000-0000-0000-000000000001','a1550000-0000-0000-0000-000000000001','a1510000-0000-0000-0000-000000000002')$$,'P0001','PARTNERSHIP_CHANGED','stable request cannot change recipient');
select throws_ok($$select public.issue_admin_benefit_coupon('a1570000-0000-0000-0000-000000000001',gen_random_uuid(),'a1510000-0000-0000-0000-000000000001')$$,'P0001','PARTNERSHIP_CHANGED','stable request cannot change benefit identity');
select throws_ok($$select public.issue_admin_benefit_coupon(gen_random_uuid(),'a1550000-0000-0000-0000-000000000001','a1510000-0000-0000-0000-000000000001')$$,'P0001','COUPON_ALREADY_ISSUED','new request cannot duplicate recipient');
select throws_ok($$select pg_temp.save('benefit','a1550000-0000-0000-0000-000000000001','{"discount_percent":30}')$$,'P0001','PARTNERSHIP_TERMS_LOCKED','benefit conditions locked after issuance');
select throws_ok($$select public.act_admin_benefit_coupon('a1570000-0000-0000-0000-000000000001','2000-01-01','redeem','Verified')$$,'P0001','PARTNERSHIP_CHANGED','coupon actions require exact revision');
select throws_ok($$select public.act_admin_benefit_coupon('a1570000-0000-0000-0000-000000000001',(pg_temp.doc('coupon','a1570000-0000-0000-0000-000000000001')->>'updated_at')::timestamptz,'redeem','')$$,'P0001','INVALID_PARTNERSHIP','redemption needs confirmation note');
select lives_ok($$select public.act_admin_benefit_coupon('a1570000-0000-0000-0000-000000000001',(pg_temp.doc('coupon','a1570000-0000-0000-0000-000000000001')->>'updated_at')::timestamptz,'redeem','Visit verified')$$,'single redemption recorded');
select throws_ok($$select public.act_admin_benefit_coupon('a1570000-0000-0000-0000-000000000001',(pg_temp.doc('coupon','a1570000-0000-0000-0000-000000000001')->>'updated_at')::timestamptz,'redeem','Again')$$,'P0001','COUPON_UNAVAILABLE','cannot redeem twice');
select lives_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000001','{"stage":"completed"}')$$,'submitted team completes');
select is(public.get_admin_partnerships('creators','',0,'a1510000-0000-0000-0000-000000000001')->'record'->>'member_name','제휴회원검사','detail includes linked member name');
select is(public.get_admin_partnerships('campaigns','',0,'a1530000-0000-0000-0000-000000000001')->'record'->>'selected_count','1','campaign count includes completed team');
select is(jsonb_array_length(public.get_admin_partnerships('benefits','',0,'a1550000-0000-0000-0000-000000000001')->'coupons'),1,'benefit detail includes issuance history');
select is(public.get_admin_partnerships('benefits','Creator Alpha')->'rows','[]'::jsonb,'search does not leak unrelated directory');
select is(public.get_admin_partnerships('creators','no-such-person')->'participations','[]'::jsonb,'all child arrays are present when empty');
reset role;
select is((select count(*) from private.partnership_events where resource_id='a1570000-0000-0000-0000-000000000001' and action='coupon_issued'),1::bigint,'idempotent issuance writes one action event');
select is((select count(*) from private.partnership_events where resource_id='a1570000-0000-0000-0000-000000000001' and action='coupon_redeemed'),1::bigint,'double redemption writes one action event');
select ok(exists(select 1 from public.admin_access_logs where actor_id='a1500000-0000-0000-0000-000000000001' and scope='analytics' and resource_id='a1550000-0000-0000-0000-000000000001'),'admin reads/actions audited with resource');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relname like 'partnership_%'),'all private records have RLS');
select ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join (values ('anon'),('authenticated'),('service_role')) r(role) where n.nspname='private' and c.relkind='r' and c.relname like 'partnership_%' and has_table_privilege(r.role,c.oid,'SELECT,INSERT,UPDATE,DELETE')),'no client/service direct table grants');
-- No role can bypass the four explicitly protected entry points.
select ok(not has_function_privilege('anon','public.get_admin_partnerships(text,text,integer,uuid,integer)','execute'),'anonymous RPC execution denied');
select ok(not has_function_privilege('service_role','public.save_admin_partnership(text,jsonb,timestamptz)','execute'),'service key cannot directly mutate this boundary');
select ok(not has_function_privilege('authenticated','private.partnership_record(text,uuid)','execute'),'unaudited helper cannot be invoked directly');
select ok(not exists(select 1 from (values ('anon'),('authenticated'),('service_role')) r(role)
  where has_function_privilege(r.role,'private.partnership_profile_key(text)','execute')),'profile key helper denies public, client and service execution');
set local role authenticated;
select throws_ok($$select pg_temp.save('creator','a1510000-0000-0000-0000-000000000002',jsonb_build_object('display_name',repeat('x',121)))$$,'P0001','INVALID_PARTNERSHIP','creator name length bounded');
select throws_ok($$select pg_temp.save('creator','a1510000-0000-0000-0000-000000000002','{"reference_url":"https://localhost/private"}')$$,'P0001','INVALID_PARTNERSHIP','private hostname references refused');
select throws_ok($$select pg_temp.save('campaign',gen_random_uuid(),'{"merchant_id":"a1520000-0000-0000-0000-000000000002","title":"Source is not a business"}')$$,'P0001','PARTNERSHIP_INACTIVE','source record cannot become a campaign merchant');
select throws_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000001','{"support_amount_cents":100000000}')$$,'P0001','PARTNERSHIP_TERMS_LOCKED','post-selection money cannot change even to invalid value');
select lives_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000002',jsonb_build_object('merchant_id','a1520000-0000-0000-0000-000000000001','title','Cancellation campaign','status','open','terms','Visit','terms_confirmed',true,'ends_on',current_date+30,'team_limit',1))$$,'second complete campaign opens');
select throws_ok($$select pg_temp.save('benefit',gen_random_uuid(),jsonb_build_object('merchant_id','a1520000-0000-0000-0000-000000000001','campaign_id','a1530000-0000-0000-0000-000000000002','title','Wrong audience','audience','members'))$$,'P0001','INVALID_PARTNERSHIP','member benefit cannot link creator campaign');
select lives_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000003','{"campaign_id":"a1530000-0000-0000-0000-000000000002","creator_id":"a1510000-0000-0000-0000-000000000002"}')$$,'cancellation team applies');
select lives_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000003','{"stage":"selected"}')$$,'cancellation team selects');
select lives_ok($$select pg_temp.save('benefit','a1550000-0000-0000-0000-000000000002',jsonb_build_object('merchant_id','a1520000-0000-0000-0000-000000000001','campaign_id','a1530000-0000-0000-0000-000000000002','title','Cancellation benefit','audience','creators','status','active','terms','Visit once','terms_confirmed',true,'expires_on',current_date+10))$$,'linked benefit saved');
select lives_ok($$select public.issue_admin_benefit_coupon('a1570000-0000-0000-0000-000000000002','a1550000-0000-0000-0000-000000000002','a1510000-0000-0000-0000-000000000002')$$,'selected team gets coupon');
select lives_ok($$select pg_temp.save('creator','a1510000-0000-0000-0000-000000000002','{"status":"paused"}')$$,'creator can pause');
select throws_ok($$select public.act_admin_benefit_coupon('a1570000-0000-0000-0000-000000000002',(pg_temp.doc('coupon','a1570000-0000-0000-0000-000000000002')->>'updated_at')::timestamptz,'redeem','Paused creator')$$,'P0001','COUPON_UNAVAILABLE','paused creator cannot use coupon');
select lives_ok($$select pg_temp.save('creator','a1510000-0000-0000-0000-000000000002','{"status":"active"}')$$,'creator restored for remaining checks');
select lives_ok($$select pg_temp.save('benefit','a1550000-0000-0000-0000-000000000002','{"status":"paused"}')$$,'benefit can pause after issuance');
select throws_ok($$select public.act_admin_benefit_coupon('a1570000-0000-0000-0000-000000000002',(pg_temp.doc('coupon','a1570000-0000-0000-0000-000000000002')->>'updated_at')::timestamptz,'redeem','Paused benefit')$$,'P0001','COUPON_UNAVAILABLE','paused benefit cannot redeem');
select lives_ok($$select pg_temp.save('benefit','a1550000-0000-0000-0000-000000000002','{"status":"active"}')$$,'benefit restored without changing issued terms');
select lives_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000002','{"status":"paused"}')$$,'campaign can pause after selection');
select throws_ok($$select public.act_admin_benefit_coupon('a1570000-0000-0000-0000-000000000002',(pg_temp.doc('coupon','a1570000-0000-0000-0000-000000000002')->>'updated_at')::timestamptz,'redeem','Paused campaign')$$,'P0001','COUPON_UNAVAILABLE','paused campaign cannot redeem linked coupon');
select lives_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000002','{"status":"open"}')$$,'campaign restored with original terms');
reset role;
update private.merchants set consent='revoked' where id='a1520000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.act_admin_benefit_coupon('a1570000-0000-0000-0000-000000000002',(pg_temp.doc('coupon','a1570000-0000-0000-0000-000000000002')->>'updated_at')::timestamptz,'redeem','Consent revoked')$$,'P0001','COUPON_UNAVAILABLE','current merchant consent checked at redemption');
reset role;
update private.merchants set deleted_at=clock_timestamp(),status='paused' where id='a1520000-0000-0000-0000-000000000001';
set local role authenticated;
select lives_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000003','{"stage":"cancelled"}')$$,'team can cancel after merchant deletion');
select is(pg_temp.doc('coupon','a1570000-0000-0000-0000-000000000002')->>'status','revoked','cancellation revokes unused campaign coupon');
select is(public.get_admin_partnerships('benefits','',0,'a1550000-0000-0000-0000-000000000002')->'record'->>'issued_count','1','merchant deletion retains issuance history');
reset role;
update private.merchants set deleted_at=null,status='trial',consent='granted' where id='a1520000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.save('campaign','a1530000-0000-0000-0000-000000000002','{"terms":"Changed after cancellation"}')$$,'P0001','PARTNERSHIP_TERMS_LOCKED','cancellation never unlocks historical selected terms');
select throws_ok($$select pg_temp.save('participation','a1540000-0000-0000-0000-000000000003','{"stage":"applied"}')$$,'P0001','PARTNERSHIP_STAGE','cancelled team cannot restart by overwriting history');
select lives_ok($$select pg_temp.save('benefit','a1550000-0000-0000-0000-000000000003',jsonb_build_object('merchant_id','a1520000-0000-0000-0000-000000000001','title','Member benefit','audience','members','status','active','terms','Members once','terms_confirmed',true,'expires_on',current_date+10,'issue_limit',1))$$,'independent member benefit saved');
select lives_ok($$select public.issue_admin_benefit_coupon('a1570000-0000-0000-0000-000000000003','a1550000-0000-0000-0000-000000000003',null,'a1500000-0000-0000-0000-000000000002')$$,'active member receives member coupon');
reset role;
update public.profiles set nickname='수정된회원',account_status='deleted' where id='a1500000-0000-0000-0000-000000000002';
set local role authenticated;
select is(pg_temp.doc('coupon','a1570000-0000-0000-0000-000000000003')->>'recipient_name','제휴회원검사','recipient name remains issuance snapshot');
select throws_ok($$select public.act_admin_benefit_coupon('a1570000-0000-0000-0000-000000000003',(pg_temp.doc('coupon','a1570000-0000-0000-0000-000000000003')->>'updated_at')::timestamptz,'redeem','Inactive member')$$,'P0001','COUPON_UNAVAILABLE','inactive member cannot redeem');
select lives_ok($$select public.act_admin_benefit_coupon('a1570000-0000-0000-0000-000000000003',(pg_temp.doc('coupon','a1570000-0000-0000-0000-000000000003')->>'updated_at')::timestamptz,'revoke','Admin cancellation')$$,'inactive recipient coupon can still revoke');
select throws_ok($$select public.issue_admin_benefit_coupon(gen_random_uuid(),'a1550000-0000-0000-0000-000000000003',null,'a1500000-0000-0000-0000-000000000003')$$,'P0001','PARTNERSHIP_CAPACITY','revoked history continues to count against issuance cap');
select is(public.issue_admin_benefit_coupon('a1570000-0000-0000-0000-000000000003','a1550000-0000-0000-0000-000000000003',null,'a1500000-0000-0000-0000-000000000002'),'a1570000-0000-0000-0000-000000000003'::uuid,'identical old request retains identity after revocation and recipient change');
reset role;
update public.profiles set account_status='active' where id='a1500000-0000-0000-0000-000000000002';
-- Deliberately put the SQL session more than a day ahead of the merchant.
update public.cities set timezone='Etc/GMT+12' where id='partnership-test';
set local timezone='Pacific/Kiritimati';
set local role authenticated;
select lives_ok($$select pg_temp.save('benefit','a1550000-0000-0000-0000-000000000004',jsonb_build_object('merchant_id','a1520000-0000-0000-0000-000000000001','title','Local expiry','audience','members','status','active','terms','Local day','terms_confirmed',true,'expires_on',(clock_timestamp() at time zone 'Etc/GMT+12')::date))$$,'merchant local current day is valid despite session tomorrow');
select lives_ok($$select public.issue_admin_benefit_coupon('a1570000-0000-0000-0000-000000000004','a1550000-0000-0000-0000-000000000004',null,'a1500000-0000-0000-0000-000000000003')$$,'issuance checks merchant timezone');
select is(public.get_admin_partnerships('benefits','',0,'a1550000-0000-0000-0000-000000000004')->'coupons'->0->>'expired','false','readback expiry uses merchant timezone');
reset role;
update private.partnership_coupons set expires_on=(clock_timestamp() at time zone 'Etc/GMT+12')::date-1 where id='a1570000-0000-0000-0000-000000000004';
set local role authenticated;
select is(public.get_admin_partnerships('benefits','',0,'a1550000-0000-0000-0000-000000000004')->'coupons'->0->>'expired','true','readback marks genuinely expired issuance');
select throws_ok($$select public.act_admin_benefit_coupon('a1570000-0000-0000-0000-000000000004',(pg_temp.doc('coupon','a1570000-0000-0000-0000-000000000004')->>'updated_at')::timestamptz,'redeem','Expired')$$,'P0001','COUPON_UNAVAILABLE','expired coupon cannot redeem');
reset role;
set local timezone='UTC';
update public.cities set timezone='America/Vancouver' where id='partnership-test';
set local role authenticated;
-- These use real RPCs: independently bounded list, child and recent-event pages.
do $$ declare i integer; rid uuid; begin
  for i in 1..51 loop
    rid:=('a1580000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid;
    perform pg_temp.save('creator',rid,jsonb_build_object('display_name','Paged Creator '||i,'city_id','partnership-test','profile_url','https://example.com/paged/'||i));
    perform pg_temp.save('participation',('a1590000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,jsonb_build_object('campaign_id','a1530000-0000-0000-0000-000000000001','creator_id',rid));
  end loop;
  for i in 1..22 loop perform pg_temp.save('creator','a1510000-0000-0000-0000-000000000001',jsonb_build_object('notes','Edit '||i)); end loop;
end $$;
select is(jsonb_array_length(public.get_admin_partnerships('creators','Paged Creator')->'rows'),50,'list page is capped at 50');
select is(public.get_admin_partnerships('creators','Paged Creator')->>'more','true','list more uses actual 51st record');
select is(jsonb_array_length(public.get_admin_partnerships('creators','Paged Creator',50)->'rows'),1,'second list page contains remainder');
select is(public.get_admin_partnerships('creators','Paged Creator',50)->>'more','false','last list page more is false');
select is(jsonb_array_length(public.get_admin_partnerships('campaigns','',0,'a1530000-0000-0000-0000-000000000001')->'participations'),50,'child page is capped at 50 independently');
select is(public.get_admin_partnerships('campaigns','',0,'a1530000-0000-0000-0000-000000000001')->>'children_more','true','child more uses actual 51st record');
select is(jsonb_array_length(public.get_admin_partnerships('campaigns','',0,'a1530000-0000-0000-0000-000000000001',50)->'participations'),3,'child offset does not alter parent selection');
select is(jsonb_array_length(public.get_admin_partnerships('creators','',0,'a1510000-0000-0000-0000-000000000001')->'events'),20,'detail recent action history capped at 20');
select is(jsonb_array_length(public.get_admin_partnerships('creators','Campaign Alpha')->'rows'),50,'creator search matches linked campaign names');
reset role;
insert into auth.users(id,email) values('a1500000-0000-0000-0000-000000000004','partnership-erasure@example.test');
insert into public.profiles(id,nickname,city_id) values('a1500000-0000-0000-0000-000000000004','삭제검사회원','partnership-test');
set local role authenticated;
select lives_ok($$select pg_temp.save('benefit','a1550000-0000-0000-0000-000000000005',jsonb_build_object('merchant_id','a1520000-0000-0000-0000-000000000001','title','Account erasure','audience','members','status','active','terms','Confirmed test terms','terms_confirmed',true,'expires_on',(clock_timestamp() at time zone 'America/Vancouver')::date+1))$$,'erasure regression uses an active unexpired benefit');
select lives_ok($$select public.issue_admin_benefit_coupon('a1570000-0000-0000-0000-000000000005','a1550000-0000-0000-0000-000000000005',null,'a1500000-0000-0000-0000-000000000004')$$,'active member receives an unexpired coupon before erasure');
reset role;
select lives_ok($$delete from auth.users where id='a1500000-0000-0000-0000-000000000004'$$,'coupon history does not block account erasure');
select is((select count(*) from public.profiles where id='a1500000-0000-0000-0000-000000000004'),0::bigint,'erasure removes the member profile');
select is((select user_id::text from private.partnership_coupons where id='a1570000-0000-0000-0000-000000000005'),'a1500000-0000-0000-0000-000000000004','coupon history retains its original recipient identity');
set local role authenticated;
select throws_ok($$select public.act_admin_benefit_coupon('a1570000-0000-0000-0000-000000000005',(pg_temp.doc('coupon','a1570000-0000-0000-0000-000000000005')->>'updated_at')::timestamptz,'redeem','Erased member')$$,'P0001','COUPON_UNAVAILABLE','erased member cannot redeem an otherwise valid coupon');
reset role;
update auth.sessions set not_after=now()-interval '1 minute' where id='a1560000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.get_admin_partnerships('creators')$$,'P0001','ADMIN_REQUIRED','expired elevated session denied');
reset role;
update auth.sessions set not_after=null where id='a1560000-0000-0000-0000-000000000001';
update public.profiles set account_status='deleted' where id='a1500000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.get_admin_partnerships('creators')$$,'P0001','ADMIN_REQUIRED','inactive administrator denied');
reset role;
select * from finish();
rollback;
