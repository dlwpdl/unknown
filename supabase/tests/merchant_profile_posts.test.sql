begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,raw_app_meta_data) values
('13900000-0000-4000-8000-000000000001','profile-post-owner@example.invalid','{"merchant_enabled":true}'),
('13900000-0000-4000-8000-000000000002','profile-post-reader@example.invalid','{}'),
('13900000-0000-4000-8000-000000000003','profile-post-coauthor@example.invalid','{}'),
('13900000-0000-4000-8000-000000000004','profile-post-inactive@example.invalid','{}'),
('13900000-0000-4000-8000-000000000005','profile-post-other-owner@example.invalid','{"merchant_enabled":true}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'업체분류검사'||right(id::text,1),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '13900000-%';
update public.profiles set account_status='suspended' where id='13900000-0000-4000-8000-000000000004';
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,owner_id,owner_verified_at) values
('13910000-0000-4000-8000-000000000001','분류 검사 업체','vancouver','private contact sentinel','trial','granted','private consent sentinel','13900000-0000-4000-8000-000000000001',now()),
('13910000-0000-4000-8000-000000000002','분류 다른 업체','vancouver','','paid','granted','검사 허가','13900000-0000-4000-8000-000000000005',now()),
('13910000-0000-4000-8000-000000000003','분류 중단 업체','vancouver','','paused','granted','검사 허가','13900000-0000-4000-8000-000000000001',now()),
('13910000-0000-4000-8000-000000000004','분류 철회 업체','vancouver','','trial','revoked','검사 철회','13900000-0000-4000-8000-000000000001',now()),
('13910000-0000-4000-8000-000000000005','분류 대기 업체','vancouver','','lead','granted','검사 허가','13900000-0000-4000-8000-000000000001',now()),
('13910000-0000-4000-8000-000000000006','분류 미동의 업체','vancouver','','trial','pending','','13900000-0000-4000-8000-000000000001',now()),
('13910000-0000-4000-8000-000000000007','분류 미연결 업체','vancouver','','trial','granted','검사 허가','13900000-0000-4000-8000-000000000001',now()),
('13910000-0000-4000-8000-000000000008','분류 삭제글 업체','vancouver','','trial','granted','검사 허가','13900000-0000-4000-8000-000000000001',now()),
('13910000-0000-4000-8000-000000000009','분류 비활성 업체','vancouver','','trial','granted','검사 허가','13900000-0000-4000-8000-000000000001',now()),
('13910000-0000-4000-8000-000000000010','분류 종료채용 업체','vancouver','','trial','granted','검사 허가','13900000-0000-4000-8000-000000000001',now());

insert into public.posts(id,city_id,author_id,tag_id,title,body,status,created_at,kind,listing_status,expires_at)
select ('13920000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'vancouver',
  ('13900000-0000-4000-8000-'||lpad(author_no::text,12,'0'))::uuid,
  case when is_job then (select id from public.tags where slug='jobs') else 1 end,
  '분류 검사 글 '||n,'public body '||n,post_status,now()+(days||' days')::interval,
  post_kind,listing_state,case when expiry is null then null else now()+(expiry||' seconds')::interval end
from(values
 (1,1,false,'published',0,'story',null::text,null::integer),
 (2,3,false,'published',4,'story',null,null),
 (3,1,true,'published',1,'story',null,null),
 (4,1,true,'published',2,'listing','open',86400),
 (5,3,true,'published',3,'listing','partial',86400),
 (6,1,true,'published',5,'listing','closed',86400),
 (7,1,true,'published',6,'listing','open',-1),
 (8,1,false,'published',7,'listing','closed',86400),
 (9,1,false,'published',8,'listing','open',-1),
 (10,1,false,'removed',9,'story',null,null),
 (11,1,true,'removed',10,'story',null,null),
 (12,4,false,'published',11,'story',null,null),
 (13,4,true,'published',12,'story',null,null),
 (14,1,false,'published',13,'story',null,null),
 (15,5,false,'published',14,'story',null,null),
 (16,1,true,'published',15,'listing','open',0),
 (17,1,false,'published',4,'listing','open',86400),
 (20,1,false,'published',0,'story',null,null),
 (21,1,false,'published',0,'story',null,null),
 (22,1,false,'published',0,'story',null,null),
 (23,1,false,'published',0,'story',null,null),
 (24,1,false,'removed',0,'story',null,null),
 (25,4,false,'published',0,'story',null,null),
 (26,1,true,'published',0,'listing','closed',-1)
)v(n,author_no,is_job,post_status,days,post_kind,listing_state,expiry);
insert into private.merchant_posts(post_id,merchant_id,original_url)
select ('13920000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('13910000-0000-4000-8000-'||lpad(merchant_no::text,12,'0'))::uuid,null
from(values(1,1),(2,1),(3,1),(4,1),(5,1),(6,1),(7,1),(8,1),(9,1),(10,1),(11,1),(12,1),(13,1),(16,1),(17,1),
 (15,2),(20,3),(21,4),(22,5),(23,6),(24,8),(25,9),(26,10))v(n,merchant_no);
update private.merchant_posts set original_url=case right(post_id::text,3)
  when '001' then 'https://cafe.example.com/' when '002' then 'https://www.instagram.com/test_cafe/'
  when '003' then 'https://cafe.example.com/' else 'https://hidden.example.com/' end
where post_id in ('13920000-0000-4000-8000-000000000001','13920000-0000-4000-8000-000000000002',
  '13920000-0000-4000-8000-000000000003','13920000-0000-4000-8000-000000000006','13920000-0000-4000-8000-000000000010');
update public.posts set sort_at=now()+interval '99 days',bumped_at=now() where id='13920000-0000-4000-8000-000000000001';
insert into private.merchant_workspace_drafts(id,merchant_id,channel,title,body,tag_slug,kind)
values('13930000-0000-4000-8000-000000000001','13910000-0000-4000-8000-000000000001','gling','private draft sentinel','private draft body sentinel','jobs','story');
insert into private.merchant_reviews(merchant_id,author_id,score,body,receipt_path,receipt_status)
values('13910000-0000-4000-8000-000000000001','13900000-0000-4000-8000-000000000002',5,'private review sentinel',
 '13900000-0000-4000-8000-000000000002/13940000-0000-4000-8000-000000000001.webp','pending');

select has_function('public','get_merchant_profile_posts',array['uuid','text','integer'],'profile posts read RPC exists');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_merchant_profile('13910000-0000-4000-8000-000000000001')->'source_urls',
  '["https://www.instagram.com/test_cafe/","https://cafe.example.com/"]'::jsonb,
  'profile links are distinct consented visible sources; removed and closed posts never contribute');
select is(public.get_merchant_profile('13910000-0000-4000-8000-000000000002')->'source_urls','[]'::jsonb,
  'company without registered public sources never invents a website or social handle');
select lives_ok($$do $check$ declare page jsonb; begin
  page:=public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001');
  if page->>'kind' is distinct from 'posts' or page->>'post_count' is distinct from '3' or page->>'job_count' is distinct from '3' then raise exception 'wrong canonical classification or default'; end if;
  if (select jsonb_agg(r->>'id') from jsonb_array_elements(page->'posts')r) is distinct from '["13920000-0000-4000-8000-000000000017","13920000-0000-4000-8000-000000000002","13920000-0000-4000-8000-000000000001"]'::jsonb then raise exception 'wrong creation order or public filtering'; end if;
end $check$;$$,'anonymous default page classifies only alive canonical posts with stable creation order');
select lives_ok($$do $check$ declare page jsonb; begin
  page:=public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs');
  if page->>'kind' is distinct from 'jobs' or page->>'post_count' is distinct from '3' or page->>'job_count' is distinct from '3' then raise exception 'wrong jobs classification'; end if;
  if (select jsonb_agg(r->>'id') from jsonb_array_elements(page->'posts')r) is distinct from '["13920000-0000-4000-8000-000000000005","13920000-0000-4000-8000-000000000004","13920000-0000-4000-8000-000000000003"]'::jsonb then raise exception 'closed, expired, hidden or inactive jobs leaked'; end if;
end $check$;$$,'anonymous jobs page excludes closed, expired, removed and inactive listings');
select throws_ok($$select public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','reviews')$$,'P0001','INVALID_MERCHANT_PROFILE_KIND','unsupported profile kind is rejected');
select throws_ok($$select public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',10001)$$,'P0001','INVALID_MERCHANT_PROFILE_OFFSET','offset beyond accepted boundary is rejected');
reset role;

select ok(has_function_privilege('anon','public.get_merchant_profile_posts(uuid,text,integer)','EXECUTE'),'anonymous can execute the public read');
select ok(has_function_privilege('authenticated','public.get_merchant_profile_posts(uuid,text,integer)','EXECUTE'),'authenticated can execute the public read');
select ok(not has_function_privilege('service_role','public.get_merchant_profile_posts(uuid,text,integer)','EXECUTE'),'service scope was not expanded');
select ok(not has_table_privilege('anon','private.merchant_posts','SELECT'),'anonymous still cannot read private company links');
select ok(not has_table_privilege('authenticated','private.merchant_workspace_drafts','SELECT'),'public reader cannot inspect company drafts');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001'))k),
 array['has_more','job_count','kind','merchant_id','post_count','posts']::text[],'page exposes only the approved public envelope');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->'posts'->0)k),
 array['author_id','author_neighborhood','author_nickname','author_verification_level','body','bumped_at','city_id','comment_count','created_at','expires_at','hashtags','id','image_paths','kind','like_count','liked_by_me','listing_status','price','room_preview','save_count','saved_by_me','share_count','sort_at','tag_id','tag_kind','tag_label','tag_slug','title','view_count']::text[],
 'post rows expose exactly the existing public feed projection');
select ok(position('private ' in public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')::text)=0,'contacts, consent notes, drafts and private review text cannot leak');
select ok(position('13940000-' in public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')::text)=0,'private review proof paths cannot leak');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->>'has_more','false','a complete small page has no remainder');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000002')->>'post_count','1','paid company reads only its own canonical post');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000002')->>'job_count','0','zero jobs is a genuine count');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000002','jobs')->'posts','[]'::jsonb,'empty job tab returns an empty public list');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000002','jobs')->>'has_more','false','empty job tab has no remainder');
select is(public.get_merchant_profile_posts(('13910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid),null::jsonb,label)
from(values(3,'paused company is inaccessible'),(4,'revoked company is inaccessible'),(5,'lead company is inaccessible'),
 (6,'pending-consent company is inaccessible'),(7,'unlinked company is inaccessible'),(8,'only-removed company is inaccessible'),
 (9,'only-inactive company is inaccessible'),(99,'unknown company is inaccessible'))v(n,label);
select is(public.get_merchant_profile_posts(null),null::jsonb,'null company is inaccessible');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000010','jobs')->>'job_count','0','existing public profile with only finished jobs has zero current recruitment');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000010','jobs')->'posts','[]'::jsonb,'finished-only profile never lists expired or closed content');
select throws_ok(format($query$select public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001',%L)$query$,kind),'P0001','INVALID_MERCHANT_PROFILE_KIND','invalid kind rejected: '||coalesce(kind,'NULL'))
from(values(null::text),(''),('Posts'),(' jobs'))v(kind);
select throws_ok(format($query$select public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',%s)$query$,offset_value),'P0001','INVALID_MERCHANT_PROFILE_OFFSET','invalid offset rejected: '||offset_value)
from(values('null'),('-1'),('10001'))v(offset_value);
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',10000)->'posts','[]'::jsonb,'maximum allowed offset is an empty page without truncating counts');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',10000)->>'post_count','3','high offset retains exact overall count');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',10000)->>'has_more','false','maximum allowed empty offset has no remainder');
reset role;

-- Public DTO parity preserves viewer flags and the existing ordered images.
update public.posts set image_paths=array['13900000-0000-4000-8000-000000000001/13945000-0000-4000-8000-000000000002.webp','13900000-0000-4000-8000-000000000001/13945000-0000-4000-8000-000000000001.webp'] where id='13920000-0000-4000-8000-000000000001';
insert into public.post_reactions(post_id,user_id,kind) values
('13920000-0000-4000-8000-000000000001','13900000-0000-4000-8000-000000000002','like'),
('13920000-0000-4000-8000-000000000001','13900000-0000-4000-8000-000000000002','save');
select set_config('request.jwt.claims','{"sub":"13900000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->'posts'->2,
 (select to_jsonb(p) from public.get_public_post('13920000-0000-4000-8000-000000000001')p),'profile row matches the live public detail DTO without a private table projection');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->'posts'->2->>'liked_by_me','true','public post row retains the current reader like state');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->'posts'->2->>'saved_by_me','true','public post row retains the current reader save state');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->'posts'->2->'image_paths',
 '["13900000-0000-4000-8000-000000000001/13945000-0000-4000-8000-000000000002.webp","13900000-0000-4000-8000-000000000001/13945000-0000-4000-8000-000000000001.webp"]'::jsonb,'ordered post image paths are preserved');
select lives_ok($$select public.create_report('post','13920000-0000-4000-8000-000000000003','other','분류 글 신고 검사')$$,'actual personal post report is supported');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->>'job_count','2','reported job is excluded from the overall count');
select is(jsonb_array_length(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs')->'posts'),2,'reported job is equally excluded from the page');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->>'post_count','3','reporting a job leaves unrelated company posts visible');
reset role;
delete from public.reports where reporter_id='13900000-0000-4000-8000-000000000002';
delete from private.action_rate_events where user_id='13900000-0000-4000-8000-000000000002' and action='report';
set local role authenticated;
select lives_ok($$select public.create_report('user','13900000-0000-4000-8000-000000000003','other','분류 작성자 신고 검사')$$,'actual personal author report is supported');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->>'post_count','2','reported author is excluded from all company post counts');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->>'job_count','2','reported author is excluded from all company job counts');
select is(jsonb_array_length(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->'posts'),2,'reported author is equally excluded from company post rows');
select is(jsonb_array_length(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs')->'posts'),2,'reported author is equally excluded from company job rows');
reset role;
delete from public.reports where reporter_id='13900000-0000-4000-8000-000000000002';
delete from private.action_rate_events where user_id='13900000-0000-4000-8000-000000000002' and action='report';
insert into public.blocks(blocker_id,blocked_id) values('13900000-0000-4000-8000-000000000002','13900000-0000-4000-8000-000000000003');
set local role authenticated;
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->>'post_count','2','blocked author is excluded from the post count');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->>'job_count','2','blocked author is excluded from the job count');
select is(jsonb_array_length(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs')->'posts'),2,'blocked author is equally excluded from the job page');
reset role;
insert into public.blocks(blocker_id,blocked_id) values('13900000-0000-4000-8000-000000000002','13900000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001'),null::jsonb,'blocking all active linked authors makes the company inaccessible');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs'),null::jsonb,'inaccessible company cannot leak job totals');
reset role;
delete from public.blocks where blocker_id='13900000-0000-4000-8000-000000000002';
delete from public.reports where reporter_id='13900000-0000-4000-8000-000000000002';
delete from private.action_rate_events where user_id='13900000-0000-4000-8000-000000000002' and action='report';
update public.profiles set account_status='suspended' where id='13900000-0000-4000-8000-000000000003';
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->>'post_count','2','newly inactive author is excluded from post count');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->>'job_count','2','newly inactive author is excluded from job count');
select is(jsonb_array_length(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs')->'posts'),2,'newly inactive author is equally excluded from jobs page');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->'posts'->1->>'liked_by_me','false','guest cannot inherit a prior reader like state');
reset role;
update public.profiles set account_status='active' where id='13900000-0000-4000-8000-000000000003';
update private.merchants set status='paused' where id='13910000-0000-4000-8000-000000000001';
set local role anon;
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001'),null::jsonb,'live merchant suspension removes post totals and rows');
reset role;
select set_config('request.jwt.claims','{"sub":"13900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs'),null::jsonb,'actual owner cannot bypass public suspension');
reset role;
update private.merchants set status='trial',consent='revoked' where id='13910000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs'),null::jsonb,'live consent withdrawal removes recruitment totals and rows');
reset role;
update private.merchants set consent='granted' where id='13910000-0000-4000-8000-000000000001';

-- Twenty-one additional rows per kind force an actual second page. Counts are
-- independently known: three eligible originals plus twenty-one new rows.
insert into public.posts(id,city_id,author_id,tag_id,title,body,status,created_at)
select ('13920000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'vancouver','13900000-0000-4000-8000-000000000001',
 case when n>=70 then (select id from public.tags where slug='jobs') else 1 end,'분류 페이지 검사 '||n,'public page body '||n,'published',now()+interval '30 days'+(n||' seconds')::interval
from(select generate_series(40,60)n union all select generate_series(70,90))v;
insert into private.merchant_posts(post_id,merchant_id,original_url)
select id,'13910000-0000-4000-8000-000000000001',null from public.posts
where id::text like '13920000-%' and (right(id::text,12)::integer between 40 and 60 or right(id::text,12)::integer between 70 and 90);
set local role anon;
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->>'post_count','24','post total covers all eligible pages');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->>'job_count','24','job total covers all eligible pages');
select is(jsonb_array_length(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->'posts'),20,'post page is capped at twenty rows');
select is(jsonb_array_length(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs')->'posts'),20,'job page is capped at twenty rows');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->>'has_more','true','first post page has an actual remainder');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs')->>'has_more','true','first job page has an actual remainder');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->'posts'->0->>'id','13920000-0000-4000-8000-000000000060','post page sorts newest creation first');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs')->'posts'->0->>'id','13920000-0000-4000-8000-000000000090','job page sorts newest creation first');
select is(jsonb_array_length(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',20)->'posts'),4,'second post page returns the exact remainder');
select is(jsonb_array_length(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs',20)->'posts'),4,'second job page returns the exact remainder');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',20)->>'post_count','24','second page still reports the full post total');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs',20)->>'job_count','24','second page still reports the full job total');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',20)->>'has_more','false','last post page has no remainder');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs',20)->>'has_more','false','last job page has no remainder');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',24)->'posts','[]'::jsonb,'offset at total is empty');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs',10000)->>'has_more','false','maximum accepted job offset has no false remainder');
select ok(not exists(select 1 from jsonb_array_elements(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')->'posts')p where p->>'tag_slug'='jobs'),'post pages never mix recruitment rows');
select ok(not exists(select 1 from jsonb_array_elements(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','jobs')->'posts')p where p->>'tag_slug'<>'jobs'),'job pages never mix other post rows');
reset role;

-- A real remainder beyond the last accepted offset proves that the terminal
-- flag prevents a client from requesting a forbidden next page.
insert into public.posts(id,city_id,author_id,tag_id,title,body,status,created_at)
select ('13920000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'vancouver','13900000-0000-4000-8000-000000000001',1,
 '분류 끝페이지 검사 '||n,'public limit fixture','published',now()-interval '30 days'+(n||' seconds')::interval from generate_series(100,10096)n;
insert into private.merchant_posts(post_id,merchant_id,original_url)
select ('13920000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'13910000-0000-4000-8000-000000000001',null from generate_series(100,10096)n;
set local role anon;
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',10000)->>'post_count','10021','last allowed page preserves the full count beyond the offset cap');
select is(jsonb_array_length(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',10000)->'posts'),20,'last allowed page still returns its public rows');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',10000)->>'has_more','false','offset cap stops an invalid next page even with a real remainder');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',9990)->>'has_more','false','accepted unaligned offset stops a next page beyond the cap');
select is(public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001','posts',9980)->>'has_more','true','next page exactly at the cap remains available');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.get_merchant_profile_posts('13910000-0000-4000-8000-000000000001')$$,'42501',null,'service role cannot execute the ungranted public profile RPC');
reset role;
update private.merchants set name='이름 변경 후 업체',owner_id='13900000-0000-4000-8000-000000000005',status='paused'
where id='13910000-0000-4000-8000-000000000001';
select is((select count(*)::int from private.merchant_reviews where merchant_id='13910000-0000-4000-8000-000000000001'),1,
  'owner/name/status changes preserve saved review records under the same company id');
select is((select body from private.merchant_reviews where merchant_id='13910000-0000-4000-8000-000000000001'),'private review sentinel',
  'paused company preserves the original review text');
select is((select score from private.merchant_reviews where merchant_id='13910000-0000-4000-8000-000000000001'),5::numeric,
  'paused company preserves the original review score');
select is(public.get_merchant_profile('13910000-0000-4000-8000-000000000001'),null::jsonb,
  'pausing changes public visibility without deleting the company or its reviews');
select * from finish();
rollback;
