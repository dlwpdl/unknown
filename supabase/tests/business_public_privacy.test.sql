begin;
set local search_path=public,extensions;
select no_plan();
-- The isolated checker injects business_post_identity.test.sql's seed prefix here.

select set_config('test.business_operator_post',(select post_id::text from private.merchant_workspace_drafts where id='b1830000-0000-4000-8000-000000000002'),true);
update private.merchants set status='trial',trial_ends_at=current_date+2,
  avatar_path='b1800000-0000-4000-8000-000000000001/b1810000-0000-4000-8000-000000000001_b1840000-0000-4000-8000-000000000001.webp',
  banner_path='b1800000-0000-4000-8000-000000000002/b1810000-0000-4000-8000-000000000001_b1840000-0000-4000-8000-000000000002.webp'
where id='b1810000-0000-4000-8000-000000000001';
update public.profiles set neighborhood='개인동네노출금지',verification_level=3
where id in('b1800000-0000-4000-8000-000000000001','b1800000-0000-4000-8000-000000000002');
update public.posts set image_paths=array[author_id::text||'/'||id::text||'.webp'],
  body=body||E'\nGoogle 지도: https://maps.google.com/?q=Vancouver'
where id in(current_setting('test.business_post')::uuid,current_setting('test.business_operator_post')::uuid);
insert into storage.objects(bucket_id,name,owner,owner_id,metadata)
select 'post-images',p.image_paths[1],p.author_id,p.author_id::text,'{"mimetype":"image/webp","size":1000}'::jsonb
from public.posts p where p.id in(current_setting('test.business_post')::uuid,current_setting('test.business_operator_post')::uuid)
union all select 'merchant-profile-images',m.avatar_path,m.owner_id,m.owner_id::text,'{"mimetype":"image/webp","size":1000}'::jsonb
from private.merchants m where m.id='b1810000-0000-4000-8000-000000000001'
union all select 'merchant-profile-images',m.banner_path,'b1800000-0000-4000-8000-000000000002'::uuid,'b1800000-0000-4000-8000-000000000002','{"mimetype":"image/webp","size":1000}'::jsonb
from private.merchants m where m.id='b1810000-0000-4000-8000-000000000001';
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
('b1820000-0000-4000-8000-000000000004','b1800000-0000-4000-8000-000000000001','vancouver',1,'개인 글 유지 검사','비즈니스 글과 별개인 합성 개인 글');
insert into public.post_reactions(post_id,user_id,kind)
select id,'b1800000-0000-4000-8000-000000000003','save' from public.posts
where id in(current_setting('test.business_post')::uuid,current_setting('test.business_operator_post')::uuid);

select is((select author_id from public.posts where id=current_setting('test.business_post')::uuid),'b1800000-0000-4000-8000-000000000001'::uuid,'stored owner actor remains available to moderation');
select is((select author_id from public.posts where id=current_setting('test.business_operator_post')::uuid),'b1800000-0000-4000-8000-000000000002'::uuid,'stored operator actor remains available to moderation');
select is((select count(*) from public.posts where id in(current_setting('test.business_post')::uuid,current_setting('test.business_operator_post')::uuid) and business_author_id='b1810000-0000-4000-8000-000000000001'),2::bigint,'both protected publishers retain the canonical business author');
select is((select business_author_id from public.posts where id='b1820000-0000-4000-8000-000000000003'),null::uuid,'curated personal association does not confer official authorship');
select ok(not has_column_privilege('authenticated','public.posts','business_author_id','UPDATE'),'ordinary clients cannot rewrite official provenance');
select ok(not has_column_privilege('anon','public.posts','business_author_id','UPDATE'),'anonymous clients cannot rewrite official provenance');
select ok(not has_function_privilege('anon','public.get_business_public_media(uuid,text,integer,uuid)','EXECUTE'),'anonymous callers cannot resolve physical business media keys');
select ok(not has_function_privilege('authenticated','public.get_business_public_media(uuid,text,integer,uuid)','EXECUTE'),'authenticated callers cannot resolve physical business media keys');
select ok(has_function_privilege('service_role','public.get_business_public_media(uuid,text,integer,uuid)','EXECUTE'),'only the trusted media service can resolve physical media keys');
select ok((select prosecdef and pg_get_userbyid(proowner)='postgres'
  and coalesce(array_to_string(proconfig,','),'') ~ '(^|,)search_path=(""|)(,|$)'
  from pg_proc where oid='public.get_business_public_media(uuid,text,integer,uuid)'::regprocedure),'media resolver uses a privileged owner and fixed empty search path');
select has_function('private','business_base_get_public_post',array['uuid'],'raw detail implementation remains private');
select has_function('private','business_base_get_public_feed_page_v2',array['text','smallint','text','timestamp with time zone','uuid','integer'],'raw feed implementation remains private');
select ok(count(*)>=2 and bool_and(not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE')),
  'all raw business_base clones are inaccessible to public clients')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'business_base_%';

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((select author_id from public.get_public_post(current_setting('test.business_post')::uuid)),'b1810000-0000-4000-8000-000000000001'::uuid,'anonymous detail uses the business ID, never its owner');
select is((select author_nickname from public.get_public_post(current_setting('test.business_operator_post')::uuid)),'지모코신원검사','anonymous detail uses the business name, never its operator');
select ok((select to_jsonb(p)::text !~ 'b1800000-0000-4000-8000-|비즈니스신원검사[12]|개인동네노출금지' from public.get_public_post(current_setting('test.business_post')::uuid) p),'anonymous DTO contains no personal ID, nickname, neighborhood or uploader key');
select matches(public.get_merchant_profile('b1810000-0000-4000-8000-000000000001')->>'avatar_path','^business-profile/b1810000-0000-4000-8000-000000000001/avatar/[0-9a-f]{32}$','public logo uses a versioned opaque business alias');
select matches(public.get_merchant_profile('b1810000-0000-4000-8000-000000000001')->>'banner_path','^business-profile/b1810000-0000-4000-8000-000000000001/banner/[0-9a-f]{32}$','public banner uses a versioned opaque business alias');
select ok(public.get_merchant_profile('b1810000-0000-4000-8000-000000000001')::text !~ 'b1800000-0000-4000-8000-|b1840000-0000-4000-8000-','public profile contains no linked account or physical media key');
select is(public.get_merchant_profile_posts('b1810000-0000-4000-8000-000000000001')->>'post_count','2','trial business profile counts only its two official posts');
select is(jsonb_array_length(public.get_merchant_profile_posts('b1810000-0000-4000-8000-000000000001')->'posts'),2,'trial business page lists only its two official posts');
select ok(not exists(select 1 from jsonb_array_elements(public.get_merchant_profile_posts('b1810000-0000-4000-8000-000000000001')->'posts') p where p->>'id'='b1820000-0000-4000-8000-000000000003'),'review-eligible curated personal post stays off the official business profile');
select ok(public.get_merchant_profile_posts('b1810000-0000-4000-8000-000000000001')::text !~ 'b1800000-0000-4000-8000-|비즈니스신원검사[12]|개인동네노출금지','business profile post DTOs contain no personal author correlation');
select is((select array_agg(id) from public.get_public_author_posts('b1800000-0000-4000-8000-000000000001')),array['b1820000-0000-4000-8000-000000000004'::uuid],'personal author history retains personal posts and excludes official owner posts');
select is((select count(*) from public.get_public_author_posts('b1800000-0000-4000-8000-000000000002')),0::bigint,'operator personal author history excludes official posts');
select is(public.get_public_user_activity('b1800000-0000-4000-8000-000000000001','story')->0->>'id','b1820000-0000-4000-8000-000000000004','personal activity retains the actual personal post');
select is(jsonb_array_length(public.get_public_user_activity('b1800000-0000-4000-8000-000000000001','story')),1,'personal activity does not correlate the owner to an official post');
select is(public.get_public_user_activity('b1800000-0000-4000-8000-000000000002','story'),'[]'::jsonb,'personal activity does not correlate the operator to an official post');
select is(public.get_public_user_profile('b1800000-0000-4000-8000-000000000001')->>'storyCount','1','personal profile counts only personal stories');
select is(public.get_public_user_profile('b1800000-0000-4000-8000-000000000002')->>'storyCount','0','operator profile count excludes official stories');
select is((select count(*) from public.get_public_feed_page_v2('vancouver',null::smallint,'비즈니스신원검사1',null::timestamptz,null::uuid,50) p where p.id=current_setting('test.business_post')::uuid),0::bigint,'searching the owner nickname cannot discover their official business post');
select throws_ok($$select public.get_business_public_media(current_setting('test.business_post')::uuid,'post',0)$$,'42501',null,'anonymous resolver execution is denied at the database boundary');
select throws_ok($$select private.business_base_get_public_post(current_setting('test.business_post')::uuid)$$,'42501',null,'anonymous callers cannot bypass the safe detail projection');
reset role;

select set_config('request.jwt.claims','{"sub":"b1800000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
with reads as (
  select 'detail' source,to_jsonb(p) dto from unnest(array[current_setting('test.business_post')::uuid,current_setting('test.business_operator_post')::uuid]) ids(id) cross join lateral public.get_public_post(ids.id) p
  union all select 'legacy feed',to_jsonb(p) from public.get_public_feed('vancouver',50) p
  union all select 'legacy page',to_jsonb(p) from public.get_public_feed_page('vancouver',null::smallint,null::text,null::timestamptz,null::uuid,50) p
  union all select 'v2 feed',to_jsonb(p) from public.get_public_feed_page_v2('vancouver',null::smallint,null::text,null::timestamptz,null::uuid,50) p
  union all select 'popular feed',to_jsonb(p) from public.get_public_popular_feed_page('vancouver',null::smallint,null::bigint,null::timestamptz,null::uuid,null::timestamptz,50) p
  union all select 'saved posts',to_jsonb(p) from public.get_saved_posts(null::timestamptz,null::uuid,50) p
  union all select 'discovery',to_jsonb(p) from public.get_discovery_posts('vancouver',null::smallint,null::text,null::timestamptz,null::uuid,50) p
), official as (
  select * from reads where dto->>'id' in(current_setting('test.business_post'),current_setting('test.business_operator_post'))
), routes(source) as (
  values('detail'),('legacy feed'),('legacy page'),('v2 feed'),('popular feed'),('saved posts'),('discovery')
)
select ok(count(dto)=2 and coalesce(bool_and(dto->>'author_id'='b1810000-0000-4000-8000-000000000001'
  and dto->>'author_nickname'='지모코신원검사' and dto->>'author_neighborhood' is null
  and coalesce((dto->>'author_verification_level')::integer,0)=0
  and dto::text !~ 'b1800000-0000-4000-8000-|비즈니스신원검사[12]|개인동네노출금지'),false),source||' returns both official posts with business identity and no personal metadata')
from routes left join official using(source) group by source order by source;
select is((select count(*) from public.posts where id in(current_setting('test.business_post')::uuid,current_setting('test.business_operator_post')::uuid)),0::bigint,'raw authenticated posts reads cannot bypass official author masking');
select is((select count(*) from public.posts where id='b1820000-0000-4000-8000-000000000003'),1::bigint,'raw personal post visibility is preserved');
select is((select author_id from public.get_public_post('b1820000-0000-4000-8000-000000000003')),'b1800000-0000-4000-8000-000000000003'::uuid,'curated personal DTO keeps its actual personal author');
select is((select cardinality(image_paths) from public.get_public_post(current_setting('test.business_post')::uuid)),1,'safe public media aliases preserve the official photo');
select is((select count(*) from storage.objects where bucket_id in('post-images','merchant-profile-images') and name like 'b1800000-0000-4000-8000-%'),0::bigint,'ordinary readers cannot enumerate or sign the physical uploader paths');
select throws_ok($$select public.get_business_public_media(current_setting('test.business_post')::uuid,'post',0)$$,'42501',null,'authenticated resolver execution is denied at the database boundary');
reset role;

update private.merchants set status='paused' where id='b1810000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.get_public_post(current_setting('test.business_post')::uuid)),0::bigint,'paused official post fails closed instead of falling back to personal author');
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000001'),null::jsonb,'paused business profile is unavailable');
reset role;
update private.merchants set status='trial',consent='revoked' where id='b1810000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.get_public_post(current_setting('test.business_post')::uuid)),0::bigint,'revoked consent fails closed instead of exposing the personal author');
reset role;
update private.merchants set consent='granted',record_kind='source' where id='b1810000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.get_public_post(current_setting('test.business_post')::uuid)),0::bigint,'source record cannot turn a formerly official post into a personal post');
reset role;
update private.merchants set record_kind='business' where id='b1810000-0000-4000-8000-000000000001';
update public.posts set status='removed' where id=current_setting('test.business_post')::uuid;
set local role authenticated;
select is((select count(*) from public.get_public_post(current_setting('test.business_post')::uuid)),0::bigint,'removed official post exposes neither business nor personal DTO');
reset role;
update public.posts set status='published' where id=current_setting('test.business_post')::uuid;
update public.profiles set account_status='suspended' where id='b1800000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.get_public_post(current_setting('test.business_post')::uuid)),0::bigint,'inactive underlying actor cannot trigger personal identity fallback');
reset role;
update public.profiles set account_status='active' where id='b1800000-0000-4000-8000-000000000001';
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code)
values('b1800000-0000-4000-8000-000000000003','b1800000-0000-4000-8000-000000000001','post',current_setting('test.business_post')::uuid,'spam');
set local role authenticated;
select is((select count(*) from public.get_public_post(current_setting('test.business_post')::uuid)),0::bigint,'reported official post remains hidden with no personal fallback');
reset role;
delete from public.reports where reporter_id='b1800000-0000-4000-8000-000000000003' and target_id=current_setting('test.business_post')::uuid;

delete from private.merchant_posts where post_id=current_setting('test.business_post')::uuid;
select is((select business_author_id from public.posts where id=current_setting('test.business_post')::uuid),'b1810000-0000-4000-8000-000000000001'::uuid,'unlinking a curation row cannot erase permanent official provenance');
select is((select author_id from public.posts where id=current_setting('test.business_post')::uuid),'b1800000-0000-4000-8000-000000000001'::uuid,'unlinking preserves the private moderation actor');
set local role authenticated;
select ok(not exists(select 1 from public.get_public_post(current_setting('test.business_post')::uuid) p where p.author_id is distinct from 'b1810000-0000-4000-8000-000000000001'::uuid),'unlinking never publishes a personal author identity');
select is((select count(*) from public.posts where id=current_setting('test.business_post')::uuid),0::bigint,'unlinked official post still cannot leak through raw table reads');
select is((select array_agg(id) from public.get_public_author_posts('b1800000-0000-4000-8000-000000000001')),array['b1820000-0000-4000-8000-000000000004'::uuid],'unlinked official post stays out of personal author history');
select is(public.get_public_user_profile('b1800000-0000-4000-8000-000000000001')->>'storyCount','1','unlinked official post stays out of personal profile counts');
reset role;

select ok(not has_column_privilege('authenticated','public.posts','business_author_id','INSERT'),'direct inserts cannot forge business provenance');
insert into public.post_polls(post_id,question,options) values(current_setting('test.business_post')::uuid,'합성 비즈니스 투표',array['예','아니요']);
insert into public.weekly_rankings(city_id,week_start,rank,post_id,score) values('vancouver','9999-01-01',1,current_setting('test.business_post')::uuid,1);
select set_config('test.business_notification',gen_random_uuid()::text,true);
insert into public.notifications(id,user_id,kind,actor_id,target_type,target_id,body,route)
values(current_setting('test.business_notification')::uuid,'b1800000-0000-4000-8000-000000000003','trending_post',
'b1800000-0000-4000-8000-000000000001','post',current_setting('test.business_post')::uuid,'비즈니스신원검사1 개인 이름 누출 금지','/post/'||current_setting('test.business_post'));
select is((select actor_id from public.notifications where id=current_setting('test.business_notification')::uuid),null::uuid,'recommendation storage/realtime payload has no personal actor');
select ok((select body like '지모코신원검사%' and body not like '%비즈니스신원검사1%' from public.notifications where id=current_setting('test.business_notification')::uuid),'notification text uses only business identity');
select set_config('request.jwt.claims','{"sub":"b1800000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000001')->>'can_message','false','public business profile has no personal DM entry');
select throws_ok($$select public.start_merchant_conversation('b1810000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_CONTACT_UNAVAILABLE','old/custom clients cannot discover a linked personal conversation');
select is(public.get_post_poll(current_setting('test.business_post')::uuid)->>'question','합성 비즈니스 투표','business author does not break poll visibility');
select lives_ok($$select public.vote_post_poll(current_setting('test.business_post')::uuid,0,'b1800000-0000-4000-8000-000000000003')$$,'business post voting retains authenticated eligibility');
select is(public.get_weekly_ranking('vancouver')->'entries'->0->>'authorId','b1810000-0000-4000-8000-000000000001','ranking author ID is the business ID');
select is(public.get_weekly_ranking('vancouver')->'entries'->0->>'nickname','지모코신원검사','ranking author is the business name');
select is((select actor_id from public.user_notifications where id=current_setting('test.business_notification')::uuid),null::uuid,'inbox does not expose the underlying actor');
select throws_ok($$select public.is_public_post_image('b1800000-0000-4000-8000-000000000001/'||current_setting('test.business_post')||'.webp')$$,'42501',null,'authenticated users cannot call the anonymous image predicate');
select throws_ok($$select public.block_business('b1810000-0000-4000-8000-000000000001','b1800000-0000-4000-8000-000000000001')$$,'P0001','AUTH_CHANGED','business blocking cannot impersonate another viewer');
select lives_ok($$select public.block_business('b1810000-0000-4000-8000-000000000001','b1800000-0000-4000-8000-000000000003')$$,'reader can block the business without learning its owner');
select is((select count(*) from public.get_public_post(current_setting('test.business_operator_post')::uuid)),0::bigint,'business block also hides the other operator official post');
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000001'),null::jsonb,'business block hides the company profile');
select is(jsonb_array_length(public.get_weekly_ranking('vancouver')->'entries'),0,'business block hides ranking entries');
select is((select count(*) from public.user_notifications where id=current_setting('test.business_notification')::uuid),0::bigint,'business block hides queued recommendation inbox entries');
select is((select count(*) from public.get_public_post('b1820000-0000-4000-8000-000000000004')),1::bigint,'business block does not expose or silently block the personal account');
reset role;
select is((select count(*) from public.blocks where blocker_id='b1800000-0000-4000-8000-000000000003'),0::bigint,'business block never writes a business ID into personal blocks');
delete from private.business_blocks where user_id='b1800000-0000-4000-8000-000000000003';
update public.posts set image_paths=array_append(image_paths,'b1800000-0000-4000-8000-000000000001/second-image.webp') where id=current_setting('test.business_post')::uuid;
set local role service_role;
select ok(public.get_business_public_media(current_setting('test.business_post')::uuid,'post',0,null) is not null,'trusted image service resolves an eligible public cover');
select is(public.get_business_public_media(current_setting('test.business_post')::uuid,'post',1,null),null::jsonb,'anonymous image endpoint cannot bypass the cover-only login boundary');
select ok(public.get_business_public_media(current_setting('test.business_post')::uuid,'post',1,'b1800000-0000-4000-8000-000000000003') is not null,'verified active reader can resolve the authenticated second photo');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select ok(not public.is_public_post_image('b1800000-0000-4000-8000-000000000001/'||current_setting('test.business_post')||'.webp'),'anonymous image predicate cannot confirm a business uploader key');
select matches(public.get_shared_link_preview(current_setting('test.business_post')::uuid)->>'imagePath','^business-post/','share preview uses an opaque photo reference');
reset role;
update private.merchants set status='lead',avatar_path=null,banner_path=null where id='b1810000-0000-4000-8000-000000000001';
set local role anon;
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000001')->>'name','지모코신원검사','basic lead business keeps its explicit official profile without upgrading status');
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000001')->>'review_post_id',null::text,'basic business profile does not gain trial/paid review privileges');
select is(public.get_merchant_profile('b1810000-0000-4000-8000-000000000001')->>'avatar_path',null::text,'missing branding never falls back to the linked personal avatar');
reset role;
select set_config('request.jwt.claims','{"sub":"b1800000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"b1890000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.log_admin_access('posts',null,current_setting('test.business_post')::uuid)$$,'private admin access keeps the existing audit boundary');
select is((select author_id from public.posts where id=current_setting('test.business_post')::uuid),'b1800000-0000-4000-8000-000000000001'::uuid,'verified admin moderation retains the real actor');
reset role;


select set_config('request.jwt.claims','{"sub":"b1800000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select ok(not has_table_privilege('authenticated','public.posts','INSERT'),'raw post inserts remain revoked; provenance work does not bypass protected publishing');
select throws_ok($$insert into public.posts(author_id,city_id,tag_id,title,body) values('b1800000-0000-4000-8000-000000000003','vancouver',1,'우회 시도','직접 쓰기 금지')$$,'42501',null,'raw post insertion cannot bypass quota/image/promotion guards');
select lives_ok($$select public.create_post('vancouver',1::smallint,'합성 개인 검증','실제 게시가 아닌 롤백 검증')$$,'ordinary personal publishing remains available through its protected RPC');
select set_config('test.private_report',public.create_report('post',current_setting('test.business_post')::uuid,'privacy','합성 신고 검사')::text,true);
select is((select count(*) from public.reports where id=current_setting('test.private_report')::uuid),0::bigint,'reporter cannot recover the business actor or physical media from their own report');
reset role;
select is((select reported_user_id from public.reports where id=current_setting('test.private_report')::uuid),'b1800000-0000-4000-8000-000000000001'::uuid,'report retains the real actor for private moderation');
select is((select evidence->>'author_id' from public.reports where id=current_setting('test.private_report')::uuid),'b1800000-0000-4000-8000-000000000001','private evidence retains the original actor');
select set_config('test.review_conversation',gen_random_uuid()::text,true);
insert into public.conversations(id,user_low_id,user_high_id,requester_id,status,accepted_at,origin_post_id)
values(current_setting('test.review_conversation')::uuid,'b1800000-0000-4000-8000-000000000001','b1800000-0000-4000-8000-000000000003',
'b1800000-0000-4000-8000-000000000003','active',now(),current_setting('test.business_post')::uuid);
insert into public.listing_reviews(conversation_id,post_id,author_id,subject_id,would_deal_again,body)
values(current_setting('test.review_conversation')::uuid,current_setting('test.business_post')::uuid,'b1800000-0000-4000-8000-000000000003','b1800000-0000-4000-8000-000000000001',true,'합성 이전 거래 후기');
set local role authenticated;
select throws_ok($$select public.start_conversation('b1800000-0000-4000-8000-000000000001',current_setting('test.business_operator_post')::uuid)$$,'P0001','MERCHANT_CONTACT_UNAVAILABLE','personal DM origin cannot probe business writer identity');
select is((select count(*) from public.listing_reviews where post_id=current_setting('test.business_post')::uuid),0::bigint,'raw listing review rows cannot correlate business post and personal subject');
select is(public.get_listing_reputation('b1800000-0000-4000-8000-000000000001')->>'total','0','business-linked review history stays out of personal public reputation');
select is(public.get_listing_review_state(current_setting('test.review_conversation')::uuid)->>'canWrite','false','business-origin personal chat does not confer personal review eligibility');
select is((select count(*) from public.conversations where id=current_setting('test.review_conversation')::uuid),1::bigint,'normal authorized existing personal conversation remains available');
reset role;
select set_config('request.jwt.claims','{"sub":"b1800000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"b1890000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((select reported_user_id from public.reports where id=current_setting('test.private_report')::uuid),'b1800000-0000-4000-8000-000000000001'::uuid,'verified admin can still read the true reported actor');
select is((select count(*) from public.listing_reviews where post_id=current_setting('test.business_post')::uuid),1::bigint,'verified admin preserves business-related historical review evidence');
reset role;

select * from finish();
rollback;
