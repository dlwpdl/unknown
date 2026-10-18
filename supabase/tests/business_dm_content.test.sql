begin;
set local search_path=public,extensions;
select no_plan();
-- business dm fixtures
insert into public.conversations(id,kind,user_low_id,business_high_id,status) values
 ('b19b0000-0000-4000-8000-000000000001','business','b1900000-0000-4000-8000-000000000003','b1910000-0000-4000-8000-000000000001','active');
insert into public.messages(id,conversation_id,sender_id,body) values
 ('b19b1000-0000-4000-8000-000000000001','b19b0000-0000-4000-8000-000000000001','b1900000-0000-4000-8000-000000000003','Synthetic reply parent');
insert into storage.objects(bucket_id,name,owner_id)
 select 'chat-images','b1910000-0000-4000-8000-000000000001/b19b0000-0000-4000-8000-000000000001_1792280000000-Photo'||n||'.webp','b1900000-0000-4000-8000-000000000002' from generate_series(1,21)n;
select set_config('test.album_paths',(select array_agg(name order by name)::text from storage.objects where name like 'b1910000-0000-4000-8000-000000000001/b19b0000-%'),true);
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.send_business_chat_message('b19b0000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001',gen_random_uuid(),p_body=>' ')$$,'P0001','INVALID_MESSAGE','empty text is rejected');
select throws_ok($$select public.send_business_chat_message('b19b0000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001',gen_random_uuid(),p_body=>repeat('x',2001))$$,'P0001','INVALID_MESSAGE','business text keeps existing 2000 character limit');
select throws_ok($$select public.send_business_chat_message('b19b0000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001',gen_random_uuid(),p_kind=>'image',p_image_paths=>current_setting('test.album_paths')::text[])$$,'P0001','INVALID_CHAT_IMAGES','twenty-one photos cannot bypass album limit');
select throws_ok($$select public.send_business_chat_message('b19b0000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001',gen_random_uuid(),p_kind=>'image',p_image_paths=>array[null]::text[])$$,'P0001','INVALID_CHAT_IMAGES','null photo path is rejected');
select throws_ok($$select public.send_business_chat_message('b19b0000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001',gen_random_uuid(),p_kind=>'location',p_latitude=>91,p_longitude=>0)$$,'P0001','INVALID_CHAT_LOCATION','invalid location is rejected');
select public.send_business_chat_message('b19b0000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001','b19b2000-0000-4000-8000-000000000001',p_kind=>'image',p_image_paths=>(current_setting('test.album_paths')::text[])[1:20],p_reply_to_id=>'b19b1000-0000-4000-8000-000000000001') as album_id \gset
select set_config('test.album_id',:'album_id',true);
select is(jsonb_array_length(public.get_business_chat_messages('b19b0000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001',p_message_ids=>array[current_setting('test.album_id')::uuid])->'items'->0->'image_paths'),20,'all twenty ordered photos reach safe DTO as one message');
select is(public.send_business_chat_message('b19b0000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001','b19b2000-0000-4000-8000-000000000001',p_kind=>'image',p_image_paths=>(current_setting('test.album_paths')::text[])[1:20],p_reply_to_id=>'b19b1000-0000-4000-8000-000000000001'),current_setting('test.album_id')::uuid,'album retry does not duplicate rate/safety/notifications');
select throws_ok($$select public.edit_business_chat_message(current_setting('test.album_id')::uuid,'b1910000-0000-4000-8000-000000000001','Image edit')$$,'P0001','MESSAGE_NOT_EDITABLE','album cannot be edited as text');
select throws_ok($$select public.send_business_chat_message('b19b0000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001',gen_random_uuid(),p_body=>'Too soon')$$,'P0001','RATE_LIMITED','business messages retain existing per-human message cooldown');
reset role;
select is((select count(*) from public.safety_review_queue where target_type='message' and target_id=current_setting('test.album_id')::uuid),1::bigint,'album creates one all-content safety entry');
delete from private.action_rate_events where user_id='b1900000-0000-4000-8000-000000000002';
set local role authenticated;
select public.send_business_chat_message('b19b0000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001','b19b2000-0000-4000-8000-000000000002',p_kind=>'location',p_latitude=>49.2827,p_longitude=>-123.1207,p_location_label=>'Synthetic place') as location_id \gset
select set_config('test.location_id',:'location_id',true);
select is(public.get_business_chat_messages('b19b0000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001',p_message_ids=>array[current_setting('test.location_id')::uuid])->'items'->0->>'location_label','Synthetic place','location label and coordinates use existing safe message shape');
select is((public.delete_business_chat_message(current_setting('test.album_id')::uuid,'b1910000-0000-4000-8000-000000000001')->'image_paths'),'[]'::jsonb,'deleted album returns no media paths');
select is(public.send_business_chat_message('b19b0000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001','b19b2000-0000-4000-8000-000000000001',p_kind=>'image',p_image_paths=>(current_setting('test.album_paths')::text[])[1:20],p_reply_to_id=>'b19b1000-0000-4000-8000-000000000001'),current_setting('test.album_id')::uuid,'retry after delete confirms original saved operation');
select throws_ok($$select public.send_business_chat_message('b19b0000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001',gen_random_uuid(),p_body=>'Reply to deleted',p_reply_to_id=>current_setting('test.album_id')::uuid)$$,'P0001','MESSAGE_REPLY_UNAVAILABLE','deleted parent cannot acquire new replies');
reset role;
select is((select jsonb_array_length(original->'image_paths') from private.message_history where message_id=current_setting('test.album_id')::uuid and action='delete'),20,'all album evidence survives deletion privately');
select * from finish();
rollback;
