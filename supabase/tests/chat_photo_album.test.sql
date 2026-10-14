begin;
set local search_path=public,extensions;
select set_config('storage.allow_delete_query','true',true);
select no_plan();
select has_column('public','messages','image_paths','messages retain all ordered album paths');
select has_function('public','send_chat_album',array['uuid','text[]','uuid','uuid'],'one idempotent album send entry');

insert into auth.users(id,email,raw_app_meta_data)
select ('a1340000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'album-'||n||'@example.test',
  case when n=4 then '{"role":"admin"}'::jsonb else '{}'::jsonb end from generate_series(1,4)n;
insert into public.profiles(id,nickname,city_id,ai_safety_consent_at)
select id,'묶음검사'||right(id::text,1),'vancouver',now() from auth.users where id::text like 'a1340000-%';
insert into auth.sessions(id,user_id,aal) values
('a1346000-0000-0000-0000-000000000004','a1340000-0000-0000-0000-000000000004','aal2');
insert into public.conversations(id,user_low_id,user_high_id,status) values
('a1341000-0000-0000-0000-000000000001','a1340000-0000-0000-0000-000000000001','a1340000-0000-0000-0000-000000000002','active');
insert into public.messages(id,conversation_id,sender_id,body) values
('a1342000-0000-0000-0000-000000000001','a1341000-0000-0000-0000-000000000001','a1340000-0000-0000-0000-000000000002','답장 원문');
insert into storage.objects(bucket_id,name,owner_id)
select 'chat-images','a1340000-0000-0000-0000-000000000001/a1341000-0000-0000-0000-000000000001_'||n||'.webp','a1340000-0000-0000-0000-000000000001'
from generate_series(1,21)n;
select array_agg(name order by (regexp_match(name,'_([0-9]+)\.webp$'))[1]::int)::text as paths
from storage.objects where bucket_id='chat-images' and name like 'a1340000-%' \gset
select set_config('test.album_paths',:'paths',true);
select set_config('request.jwt.claims','{"sub":"a1340000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.send_chat_album('a1341000-0000-0000-0000-000000000001','{}','a1343000-0000-0000-0000-000000000001')$$,'P0001','INVALID_CHAT_IMAGES','empty albums are rejected');
select throws_ok($$select public.send_chat_album('a1341000-0000-0000-0000-000000000001',current_setting('test.album_paths')::text[],'a1343000-0000-0000-0000-000000000001')$$,'P0001','INVALID_CHAT_IMAGES','21 images cannot bypass the picker limit');
select throws_ok($$select public.send_chat_album('a1341000-0000-0000-0000-000000000001',array['same','same'],'a1343000-0000-0000-0000-000000000001')$$,'P0001','INVALID_CHAT_IMAGES','duplicate paths are rejected');
select throws_ok($$select public.send_chat_album('a1341000-0000-0000-0000-000000000001',array[null]::text[],'a1343000-0000-0000-0000-000000000001')$$,'P0001','INVALID_CHAT_IMAGES','null images are rejected');
select throws_ok($$select public.send_chat_album('a1341000-0000-0000-0000-000000000001',array['missing.webp'],'a1343000-0000-0000-0000-000000000001')$$,'P0001','INVALID_CHAT_IMAGE','unuploaded or foreign images cannot become an album');
select public.send_chat_album('a1341000-0000-0000-0000-000000000001',(current_setting('test.album_paths')::text[])[1:20],
  'a1343000-0000-0000-0000-000000000001','a1342000-0000-0000-0000-000000000001') as album_id \gset
select set_config('test.album_id',:'album_id',true);
select is((select cardinality(image_paths) from public.messages where id=:'album_id'),20,'all twenty photos belong to one message');
select is((select image_paths from public.messages where id=:'album_id'),(current_setting('test.album_paths')::text[])[1:20],'selection order is preserved');
select is((select image_path from public.messages where id=:'album_id'),(current_setting('test.album_paths')::text[])[1],'legacy clients retain the first-photo fallback');
select is((select reply_to_id from public.messages where id=:'album_id'),'a1342000-0000-0000-0000-000000000001'::uuid,'one reply applies to the entire bundle');
select is(public.send_chat_album('a1341000-0000-0000-0000-000000000001',(current_setting('test.album_paths')::text[])[1:20],
  'a1343000-0000-0000-0000-000000000001','a1342000-0000-0000-0000-000000000001'),:'album_id'::uuid,'an immediate retry confirms the same message without hitting the send cooldown');
select throws_ok($$select public.send_chat_album('a1341000-0000-0000-0000-000000000001',(current_setting('test.album_paths')::text[])[2:20],'a1343000-0000-0000-0000-000000000001')$$,'P0001','SEND_ID_CONFLICT','an existing request identity cannot change its photos or reply');
select throws_ok($$select public.send_chat_album('a1341000-0000-0000-0000-000000000001',(current_setting('test.album_paths')::text[])[20:21],'a1343000-0000-0000-0000-000000000002')$$,'P0001','CHAT_IMAGE_ALREADY_SENT','a non-cover album photo cannot be rebound to another message');
reset role;
update private.action_rate_events set created_at=now()-interval '2 seconds'
where user_id='a1340000-0000-0000-0000-000000000001' and action='message';
set local role authenticated;
select throws_ok($$do $reuse$ begin
  perform public.send_chat_attachment('a1341000-0000-0000-0000-000000000001','image',(current_setting('test.album_paths')::text[])[20]);
  raise exception 'REUSE_ACCEPTED';
end $reuse$; $$,'P0001','CHAT_IMAGE_ALREADY_SENT','the installed legacy attachment caller cannot reuse a non-cover album photo');
select throws_ok($$do $reuse$ begin
  perform public.send_message_v2('a1341000-0000-0000-0000-000000000001',p_kind=>'image',p_image_path=>(current_setting('test.album_paths')::text[])[19]);
  raise exception 'REUSE_ACCEPTED';
end $reuse$; $$,'P0001','CHAT_IMAGE_ALREADY_SENT','the reply-capable caller uses the same album path guard');
select is((select count(*)::int from public.messages where conversation_id='a1341000-0000-0000-0000-000000000001' and sender_id=auth.uid()),1,'retry creates one unread message');
reset role;
select is((select count(*)::int from public.notifications where target_id=:'album_id'),1,'one bundle creates one notification');
select is((select count(*)::int from public.safety_review_queue where target_type='message' and target_id=:'album_id'),1,'unreported photo bundles still enter the existing safety queue');

select set_config('request.jwt.claims','{"sub":"a1340000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id='chat-images' and name=any((current_setting('test.album_paths')::text[])[1:20])),20,'the participant can sign every photo, not just the cover');
select is((select count(*)::int from storage.objects where bucket_id='chat-images' and name=(current_setting('test.album_paths')::text[])[21]),0,'an unsent photo is not shared');
reset role;
select set_config('request.jwt.claims','{"sub":"a1340000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id='chat-images' and name like 'a1340000-%'),0,'outsiders cannot read any album photo');
select throws_ok($$select public.send_chat_album('a1341000-0000-0000-0000-000000000001',array['foreign.webp'],'a1343000-0000-0000-0000-000000000003')$$,'P0001','CONVERSATION_ACCESS_DENIED','outsiders cannot send or probe existing album requests');
reset role;

select set_config('request.jwt.claims','{"sub":"a1340000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id='chat-images' and name like 'a1340000-%'),0,'an administrator without MFA cannot sign album photos');
reset role;
select set_config('request.jwt.claims','{"sub":"a1340000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2","session_id":"a1346000-0000-0000-0000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((select jsonb_array_length(message->'image_paths') from jsonb_array_elements(public.get_admin_conversation('a1341000-0000-0000-0000-000000000001',null,null,null)->'messages') message where message->>'id'=current_setting('test.album_id')),20,'audited admin conversation reads include the full album');
select is((select count(*)::int from storage.objects where bucket_id='chat-images' and name=any((current_setting('test.album_paths')::text[])[1:20])),20,'MFA administrators can inspect every unreported album photo');
reset role;

select set_config('request.jwt.claims','{"sub":"a1340000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
delete from storage.objects where bucket_id='chat-images' and name=any(current_setting('test.album_paths')::text[]);
select is((select count(*)::int from storage.objects where bucket_id='chat-images' and name like 'a1340000-%'),20,'sender cleanup removes only the unsent photo and preserves every sent album image');
select public.delete_chat_message(current_setting('test.album_id')::uuid);
select is((select image_paths from public.messages where id=current_setting('test.album_id')::uuid),'{}'::text[],'deletion clears all public album paths');
delete from storage.objects where bucket_id='chat-images' and name like 'a1340000-%';
select is((select count(*)::int from storage.objects where bucket_id='chat-images' and name like 'a1340000-%'),20,'retained album evidence cannot be removed by its sender');
reset role;
select is(jsonb_array_length((select original->'image_paths' from private.message_history where message_id=current_setting('test.album_id')::uuid)),20,'private deletion evidence retains the entire ordered album');
select set_config('request.jwt.claims','{"sub":"a1340000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id='chat-images' and name like 'a1340000-%'),0,'the recipient cannot sign withdrawn album photos');
reset role;
select set_config('request.jwt.claims','{"sub":"a1340000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2","session_id":"a1346000-0000-0000-0000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id='chat-images' and name like 'a1340000-%'),20,'audited retained-image access covers every deleted album photo');
reset role;
select ok(not has_function_privilege('anon','public.send_chat_album(uuid,text[],uuid,uuid)','execute'),'anonymous clients cannot send bundles');
select * from finish();
rollback;
