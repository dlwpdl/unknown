begin;
set local search_path=public,extensions;
select no_plan();

-- 01 is on the posting list without a business account, 02 is an ordinary member, 03 owns a business and is not listed.
insert into auth.users(id,email,raw_app_meta_data) values
 ('d4900000-0000-4000-8000-000000000001','personal-ai@example.test','{"provider":"kakao"}'),
 ('d4900000-0000-4000-8000-000000000002','personal-other@example.test','{"provider":"kakao"}'),
 ('d4900000-0000-4000-8000-000000000003','personal-owner@example.test','{"provider":"kakao","merchant_enabled":true}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
 select id,'개인AI'||right(id::text,4),'vancouver',now(),now(),now(),'test' from auth.users where id::text like 'd4900000-%';
insert into private.unlimited_posters(user_id,note) values('d4900000-0000-4000-8000-000000000001','Synthetic rollback-only test');
insert into private.merchants(id,name,city_id,contact,status,trial_ends_at,consent,consent_note,owner_id,owner_verified_at,record_kind) values
 ('d4910000-0000-4000-8000-000000000003','개인AI검사업체','vancouver','','trial',current_date+14,'granted','검사만','d4900000-0000-4000-8000-000000000003',now(),'business');
insert into auth.oauth_clients(id,client_name,redirect_uris,grant_types,registration_type,client_type,token_endpoint_auth_method) values
 ('d4930000-0000-4000-8000-000000000001','Claude Code','http://localhost:33418/callback','authorization_code,refresh_token','dynamic','public','none'),
 ('d4930000-0000-4000-8000-000000000002','Claude','https://evil.example/callback','authorization_code,refresh_token','dynamic','public','none');
insert into auth.oauth_consents(id,user_id,client_id,scopes) values
 ('d4950000-0000-4000-8000-000000000001','d4900000-0000-4000-8000-000000000001','d4930000-0000-4000-8000-000000000001','offline_access'),
 ('d4950000-0000-4000-8000-000000000003','d4900000-0000-4000-8000-000000000003','d4930000-0000-4000-8000-000000000001','offline_access');
insert into auth.sessions(id,user_id,oauth_client_id,scopes,created_at,updated_at) values
 ('d4970000-0000-4000-8000-000000000001','d4900000-0000-4000-8000-000000000001','d4930000-0000-4000-8000-000000000001','offline_access',now(),now()),
 ('d4970000-0000-4000-8000-000000000002','d4900000-0000-4000-8000-000000000001','d4930000-0000-4000-8000-000000000001','offline_access',now(),now()),
 ('d4970000-0000-4000-8000-000000000003','d4900000-0000-4000-8000-000000000003','d4930000-0000-4000-8000-000000000001','offline_access',now(),now());
insert into auth.oauth_authorizations(id,authorization_id,client_id,redirect_uri,scope) values
 ('d4980000-0000-4000-8000-000000000001','personal-request-1','d4930000-0000-4000-8000-000000000001','http://localhost:33418/callback','offline_access');
-- Another member's real photo, to prove it cannot be attached.
insert into storage.objects(bucket_id,name,metadata) values('post-images','d4900000-0000-4000-8000-000000000002/1-other.jpg','{"mimetype":"image/jpeg","size":1000}');

-- Hook input for member 01 and a session.
create function pg_temp.hook(p_user text,p_session text) returns jsonb language sql as $$
  select public.gling_access_token_hook(jsonb_build_object('user_id',p_user,'authentication_method','oauth_provider/authorization_code','client_id','d4930000-0000-4000-8000-000000000001',
    'claims',jsonb_build_object('iss','https://example.supabase.co/auth/v1','scope','offline_access','session_id',p_session,'role','authenticated')))
$$;
create function pg_temp.mcp(p_tool text,p_args jsonb default '{}') returns jsonb language sql as $$
  select public.dispatch_personal_mcp('d4900000-0000-4000-8000-000000000001','d4930000-0000-4000-8000-000000000001',current_setting('test.conn')::uuid,current_setting('test.session')::uuid,p_tool,p_args)
$$;
create function pg_temp.photo(p_index int) returns text language sql as $$ select current_setting('test.photos')::jsonb->p_index->>'path' $$;

-- Consent screen
select set_config('request.jwt.claims','{"sub":"d4900000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_my_personal_mcp_access(),false,'an ordinary member is not offered personal AI posting');
select throws_ok($$select public.get_merchant_mcp_authorization('personal-request-1')$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','the consent screen stays closed to unlisted members without a business');
select throws_ok($$select public.save_merchant_mcp_connection('d4900000-0000-4000-8000-000000000002','d4930000-0000-4000-8000-000000000001','{}',false,false,'drafts')$$,'P0001','MCP_PERSONAL_POSTS_REQUIRED','an unlisted member cannot grant personal posts');
select set_config('request.jwt.claims','{"sub":"d4900000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.save_merchant_mcp_connection('d4900000-0000-4000-8000-000000000003','d4930000-0000-4000-8000-000000000001',array['d4910000-0000-4000-8000-000000000003'::uuid],true,false,'drafts')$$,'P0001','MCP_PERSONAL_POSTS_REQUIRED','a business owner who is not listed cannot add personal posts');
select set_config('request.jwt.claims','{"sub":"d4900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.get_my_personal_mcp_access(),true,'a listed member is offered personal AI posting');
select is(public.get_merchant_mcp_authorization('personal-request-1')->>'client_id','d4930000-0000-4000-8000-000000000001','a listed member without a business can open the consent screen');
select throws_ok($$select public.save_merchant_mcp_connection('d4900000-0000-4000-8000-000000000001','d4930000-0000-4000-8000-000000000001','{}',false,false,null)$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','without businesses the member has to pick personal posts');
select throws_ok($$select public.save_merchant_mcp_connection('d4900000-0000-4000-8000-000000000001','d4930000-0000-4000-8000-000000000001','{}',true,false,'drafts')$$,'P0001','INVALID_MCP_INPUT','business permissions need a business');
select throws_ok($$select public.save_merchant_mcp_connection('d4900000-0000-4000-8000-000000000001','d4930000-0000-4000-8000-000000000001','{}',false,false,'everything')$$,'P0001','INVALID_MCP_INPUT','only the two personal levels exist');
select throws_ok($$select public.save_merchant_mcp_connection('d4900000-0000-4000-8000-000000000001','d4930000-0000-4000-8000-000000000002','{}',false,false,'publish')$$,'P0001','MCP_PUBLISH_CLIENT_UNVERIFIED','posting straight away needs a verified callback such as Claude Code on this computer');
select throws_ok($$select public.save_merchant_mcp_connection('d4900000-0000-4000-8000-000000000002','d4930000-0000-4000-8000-000000000001','{}',false,false,'drafts')$$,'P0001','ACCOUNT_CHANGED','the grant stays bound to the reviewed account');
select set_config('test.conn',public.save_merchant_mcp_connection('d4900000-0000-4000-8000-000000000001','d4930000-0000-4000-8000-000000000001','{}',false,false,'drafts')->>'id',true);
select is((public.get_my_merchant_mcp_connections()->0)->>'personal_posts','drafts','the connection list shows the personal level');
reset role;
select set_config('test.session','d4970000-0000-4000-8000-000000000001',true);

-- Token
select is(pg_temp.hook('d4900000-0000-4000-8000-000000000001','d4970000-0000-4000-8000-000000000001')->'claims'->>'role','gling_mcp','a listed member without a business account receives the AI token');
select is(pg_temp.hook('d4900000-0000-4000-8000-000000000001','d4970000-0000-4000-8000-000000000001')->'claims'->>'sub','mcp:'||current_setting('test.conn'),'the token subject is the connection, not the member account');

-- Drafts-only connection
set local role authenticated;
select throws_ok($$select pg_temp.mcp('list_post_boards')$$,'42501',null,'a browser session cannot call the personal dispatch');
reset role;
set local role service_role;
select is(pg_temp.mcp('_context')-'businesses','{"allow_drafts":false,"allow_publish":false,"business":false,"personal_posts":"drafts"}'::jsonb,'a personal-only connection exposes personal tools and no business tools');
select throws_ok($$select pg_temp.mcp('publish_personal_draft','{"draft_id":"d4990000-0000-4000-8000-000000000001","expected_updated_at":"2026-11-13T00:00:00Z"}')$$,'P0001','MCP_TOOL_NOT_ALLOWED','a drafts-only connection cannot publish');
select throws_ok($$select pg_temp.mcp('list_business_drafts','{}')$$,'P0001','MCP_TOOL_NOT_ALLOWED','business tools are not reachable through the personal dispatch');
select ok(not (pg_temp.mcp('list_post_boards')->'boards' @> '[{"board":"business"}]'),'the business board is not offered');
select ok(not (pg_temp.mcp('list_post_boards')->'boards' @> '[{"board":"meetup"}]'),'meetups are not offered');
select ok(pg_temp.mcp('list_post_boards')->'boards' @> '[{"board":"used","kind":"listing","fields":["title","body","price","hashtags","image_paths"]}]','the used board is a listing board with a price');
select is((pg_temp.mcp('list_post_boards')->>'listing_limit')::int,1000,'a listed member sees the 1000 listing ceiling');
reset role;

-- Publishing connection
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d4900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('test.old_conn',current_setting('test.conn'),true);
select set_config('test.conn',public.save_merchant_mcp_connection('d4900000-0000-4000-8000-000000000001','d4930000-0000-4000-8000-000000000001','{}',false,false,'publish')->>'id',true);
reset role;
select is(pg_temp.hook('d4900000-0000-4000-8000-000000000001','d4970000-0000-4000-8000-000000000002')->'claims'->>'gling_connection_id',current_setting('test.conn'),'a new session binds to the new connection');
select set_config('test.session','d4970000-0000-4000-8000-000000000002',true);
set local role service_role;
select throws_ok($$select public.dispatch_personal_mcp('d4900000-0000-4000-8000-000000000001','d4930000-0000-4000-8000-000000000001',current_setting('test.old_conn')::uuid,'d4970000-0000-4000-8000-000000000001','list_post_boards','{}')$$,'P0001','MCP_CONNECTION_REQUIRED','the replaced connection stops working');
select throws_ok($$select pg_temp.mcp('create_photo_uploads','{"count":11,"content_type":"image/jpeg"}')$$,'P0001','INVALID_MCP_INPUT','at most ten upload links per call');
select throws_ok($$select pg_temp.mcp('create_photo_uploads','{"count":1,"content_type":"image/gif"}')$$,'P0001','INVALID_MCP_INPUT','only the app photo types');
select set_config('test.photos',(pg_temp.mcp('create_photo_uploads','{"count":5,"content_type":"image/jpeg"}')->'uploads')::text,true);
select is(jsonb_array_length(current_setting('test.photos')::jsonb),5,'five upload paths');
select ok(pg_temp.photo(0) ~ '^d4900000-0000-4000-8000-000000000001/[0-9]+-[0-9a-f]{12}-0\.jpg$','upload paths stay in the member folder in the app shape');
reset role;
select ok((select bool_and(expires_at between now()+interval '9 minutes' and clock_timestamp()+interval '10 minutes') from private.personal_mcp_photos where actor_id='d4900000-0000-4000-8000-000000000001'),'upload slots last ten minutes');
-- Simulated uploads: 0 good, 1 wrong type, 2 too big, 3 after the window, 4 never uploaded.
insert into storage.objects(bucket_id,name,metadata,created_at) values
 ('post-images',pg_temp.photo(0),'{"mimetype":"image/jpeg","size":500000}',now()),
 ('post-images',pg_temp.photo(1),'{"mimetype":"image/png","size":500000}',now()),
 ('post-images',pg_temp.photo(2),'{"mimetype":"image/jpeg","size":3000000}',now()),
 ('post-images',pg_temp.photo(3),'{"mimetype":"image/jpeg","size":500000}',now()+interval '11 minutes');
set local role service_role;
create function pg_temp.draft(p_id text,p_patch jsonb default '{}') returns jsonb language sql as $$
  select pg_temp.mcp('save_personal_draft',jsonb_build_object('draft_id',p_id,'city_id','vancouver','board','used','title','책상 팝니다','body','이사 가서 책상 팝니다. 직거래만 해요.',
    'price',120,'image_paths',jsonb_build_array(pg_temp.photo(0)))||p_patch)
$$;
select throws_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000001','{"image_paths":["d4900000-0000-4000-8000-000000000002/1-other.jpg"]}')$$,'P0001','INVALID_IMAGE_PATH','another member photo cannot be attached');
select throws_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000001',jsonb_build_object('image_paths',jsonb_build_array(pg_temp.photo(4))))$$,'P0001','PHOTO_NOT_UPLOADED','a photo has to be uploaded first');
select throws_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000001',jsonb_build_object('image_paths',jsonb_build_array(pg_temp.photo(3))))$$,'P0001','PHOTO_NOT_UPLOADED','an upload after the ten-minute window does not attach');
select throws_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000001',jsonb_build_object('image_paths',jsonb_build_array(pg_temp.photo(1))))$$,'P0001','PHOTO_INVALID','the stored type must match the upload link');
select throws_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000001',jsonb_build_object('image_paths',jsonb_build_array(pg_temp.photo(2))))$$,'P0001','PHOTO_INVALID','photos keep the app 2 MB limit');
select throws_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000001','{"board":"business","price":null}')$$,'P0001','INVALID_TAG','the business board stays closed');
select throws_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000001','{"board":"meetup","price":null}')$$,'P0001','INVALID_TAG','meetups are not written here');
select throws_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000001','{"board":"life"}')$$,'P0001','INVALID_POST_KIND','only listing boards take a price');
select throws_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000001','{"city_id":"winnipeg"}')$$,'P0001','CITY_NOT_OPEN','only open cities');
select throws_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000001','{"body":"씨발 책상"}')$$,'P0001','CONTENT_NOT_ALLOWED','the content filter runs on drafts');
select lives_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000001')$$,'a listing draft with an uploaded photo is saved');
select set_config('test.updated',pg_temp.mcp('preview_personal_draft','{"draft_id":"d4990000-0000-4000-8000-000000000001"}')->>'updated_at',true);
select is(pg_temp.draft('d4990000-0000-4000-8000-000000000001')->>'updated_at',current_setting('test.updated'),'an identical retry changes nothing');
select throws_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000001','{"price":100}')$$,'P0001','POST_DRAFT_CHANGED','an edit needs the latest updated_at');
select throws_ok($$select pg_temp.mcp('publish_personal_draft','{"draft_id":"d4990000-0000-4000-8000-000000000001","expected_updated_at":"2026-11-13T00:00:00Z"}')$$,'P0001','POST_DRAFT_CHANGED','publishing needs the reviewed version');
select throws_ok($$select pg_temp.mcp('preview_personal_draft','{"draft_id":"d4990000-0000-4000-8000-000000000099"}')$$,'P0001','POST_DRAFT_NOT_FOUND','an unknown draft is not found');
select set_config('test.post',pg_temp.mcp('publish_personal_draft',jsonb_build_object('draft_id','d4990000-0000-4000-8000-000000000001','expected_updated_at',current_setting('test.updated')))->>'post_id',true);
reset role;
select ok(exists(select 1 from public.posts p join public.tags t on t.id=p.tag_id where p.id=current_setting('test.post')::uuid and p.author_id='d4900000-0000-4000-8000-000000000001'
  and p.business_author_id is null and t.slug='used' and p.kind='listing' and p.price=120 and p.listing_status='open' and p.image_paths=array[pg_temp.photo(0)]),'the post is a normal personal listing by the member');
select ok(exists(select 1 from public.safety_review_queue where target_type='post' and target_id=current_setting('test.post')::uuid),'the post enters the safety review queue like an app post');
select is((select owner_id from storage.objects where bucket_id='post-images' and name=pg_temp.photo(0)),'d4900000-0000-4000-8000-000000000001','the photo belongs to the member like an app upload');
set local role service_role;
select is(pg_temp.mcp('publish_personal_draft',jsonb_build_object('draft_id','d4990000-0000-4000-8000-000000000001','expected_updated_at',current_setting('test.updated')))->>'post_id',current_setting('test.post'),'publishing the same draft again returns the first post');
select is((select count(*)::int from public.posts where author_id='d4900000-0000-4000-8000-000000000001'),1,'a retried publish never makes a second post');
select throws_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000001',jsonb_build_object('price',90,'expected_updated_at',current_setting('test.updated')))$$,'P0001','POST_DRAFT_PUBLISHED','a published draft cannot change');
select lives_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000002','{"title":"의자 팝니다"}')$$,'a second draft may point at the same file');
select throws_ok($$select pg_temp.mcp('publish_personal_draft',jsonb_build_object('draft_id','d4990000-0000-4000-8000-000000000002','expected_updated_at',pg_temp.mcp('preview_personal_draft','{"draft_id":"d4990000-0000-4000-8000-000000000002"}')->>'updated_at'))$$,'P0001','PHOTO_ALREADY_USED','two posts never share a photo');
select is(pg_temp.mcp('list_my_posts')->'posts'->0->>'id',current_setting('test.post'),'the member lists their own posts');
reset role;
select ok(not exists(select 1 from private.merchant_mcp_audit where connection_id=current_setting('test.conn')::uuid and (merchant_id is not null or tool not in
  ('list_post_boards','list_my_posts','create_photo_uploads','save_personal_draft','preview_personal_draft','publish_personal_draft'))),'audit keeps only the tool and connection');
select ok(exists(select 1 from private.merchant_mcp_audit where connection_id=current_setting('test.conn')::uuid and tool='publish_personal_draft'),'publishing is audited');

-- No admin power through the AI link, even for an admin member.
update auth.users set raw_app_meta_data=raw_app_meta_data||'{"role":"admin"}' where id='d4900000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select pg_temp.draft('d4990000-0000-4000-8000-000000000003','{"board":"business","price":null,"image_paths":[]}')$$,'P0001','INVALID_TAG','an admin member still cannot use the business board through AI');
reset role;
update auth.users set raw_app_meta_data=raw_app_meta_data-'role' where id='d4900000-0000-4000-8000-000000000001';

-- Live checks on every call
delete from private.unlimited_posters where user_id='d4900000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select pg_temp.mcp('list_post_boards')$$,'P0001','MCP_PERSONAL_POSTS_REQUIRED','removing the member from the list refuses the next call');
select throws_ok($$select pg_temp.mcp('_context')$$,'P0001','MCP_PERSONAL_POSTS_REQUIRED','a personal-only connection is refused as a whole');
reset role;
select ok(pg_temp.hook('d4900000-0000-4000-8000-000000000001','d4970000-0000-4000-8000-000000000002')->'error' is not null,'no new token after removal');
insert into private.unlimited_posters(user_id) values('d4900000-0000-4000-8000-000000000001');
update public.profiles set account_status='suspended' where id='d4900000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select pg_temp.mcp('list_post_boards')$$,'P0001','ACCOUNT_LOCKED','a suspended account is refused');
reset role;
update public.profiles set account_status='active' where id='d4900000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"d4900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select ok(public.revoke_merchant_mcp_connection(current_setting('test.conn')::uuid),'the member revokes the link');
reset role;
set local role service_role;
select throws_ok($$select pg_temp.mcp('list_post_boards')$$,'P0001','MCP_CONNECTION_REQUIRED','a revoked link is refused');
reset role;

-- Business connections are unchanged.
select set_config('request.jwt.claims','{"sub":"d4900000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.biz',public.save_merchant_mcp_connection('d4900000-0000-4000-8000-000000000003','d4930000-0000-4000-8000-000000000001',array['d4910000-0000-4000-8000-000000000003'::uuid],true,false)->>'id',true);
reset role;
select is(pg_temp.hook('d4900000-0000-4000-8000-000000000003','d4970000-0000-4000-8000-000000000003')->'claims'->>'role','gling_mcp','a business owner still receives the AI token');
set local role service_role;
select is(public.dispatch_personal_mcp('d4900000-0000-4000-8000-000000000003','d4930000-0000-4000-8000-000000000001',current_setting('test.biz')::uuid,'d4970000-0000-4000-8000-000000000003','_context','{}'),
  public.dispatch_merchant_mcp('d4900000-0000-4000-8000-000000000003','d4930000-0000-4000-8000-000000000001',current_setting('test.biz')::uuid,'d4970000-0000-4000-8000-000000000003','_context','{}')
    ||'{"business":true,"personal_posts":null}','a business-only connection gets the same context as before');
select throws_ok($$select public.dispatch_personal_mcp('d4900000-0000-4000-8000-000000000003','d4930000-0000-4000-8000-000000000001',current_setting('test.biz')::uuid,'d4970000-0000-4000-8000-000000000003','list_post_boards','{}')$$,'P0001','MCP_PERSONAL_POSTS_REQUIRED','a business-only connection has no personal tools');
reset role;
update auth.users set raw_app_meta_data=raw_app_meta_data-'merchant_enabled' where id='d4900000-0000-4000-8000-000000000003';
set local role service_role;
select throws_ok($$select public.dispatch_personal_mcp('d4900000-0000-4000-8000-000000000003','d4930000-0000-4000-8000-000000000001',current_setting('test.biz')::uuid,'d4970000-0000-4000-8000-000000000003','_context','{}')$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','a business-only connection fails with the same error as before');
reset role;

select * from finish();
rollback;
