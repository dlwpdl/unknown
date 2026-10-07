begin;
select no_plan();

insert into auth.users(id,email)
select ('71110000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'chat7111-'||n||'@example.test'
from generate_series(1,3)n;
insert into public.profiles(id,nickname,city_id)
select id,'대화'||right(id::text,2),'vancouver' from auth.users where id::text like '71110000-%';
insert into public.conversations(id,user_low_id,user_high_id,status,unread_epoch)
values('71110000-0000-0000-0001-000000000001',
  '71110000-0000-0000-0000-000000000001','71110000-0000-0000-0000-000000000002',
  'active',now()-interval '1 minute');
insert into public.messages(id,conversation_id,sender_id,body)
values('71110000-0000-0000-0002-000000000001','71110000-0000-0000-0001-000000000001',
  '71110000-0000-0000-0000-000000000001','첫 메시지');

select set_config('request.jwt.claims','{"sub":"71110000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select ok(public.get_chat_read_position('71110000-0000-0000-0001-000000000001') < now(),
  'existing conversation read fallback is the migration epoch');
select public.mark_chat_read('71110000-0000-0000-0001-000000000001','71110000-0000-0000-0002-000000000001');
select is(public.get_chat_read_position('71110000-0000-0000-0001-000000000001'),
  (select created_at from public.messages where id='71110000-0000-0000-0002-000000000001'),
  'visible message advances the read position');
select throws_ok($$select public.send_chat_attachment('71110000-0000-0000-0001-000000000001','location',null,91,0)$$,
  'P0001','INVALID_CHAT_LOCATION','invalid coordinates are rejected');
select throws_ok($$select public.send_chat_attachment('71110000-0000-0000-0001-000000000001','image','missing.webp')$$,
  'P0001','INVALID_CHAT_IMAGE','an unuploaded photo cannot become a message');
select public.send_chat_attachment('71110000-0000-0000-0001-000000000001','location',null,49.282729,-123.120738) as location_message \gset
select is((select kind from public.messages where id=:'location_message'),'location','location is stored as an attachment');
select ok((select latitude=49.282729 and longitude=-123.120738 from public.messages where id=:'location_message'),
  'location coordinates remain intact');
select public.mark_chat_read('71110000-0000-0000-0001-000000000001',:'location_message');
select public.mark_chat_read('71110000-0000-0000-0001-000000000001','71110000-0000-0000-0002-000000000001');
select is(public.get_chat_read_position('71110000-0000-0000-0001-000000000001'),
  (select created_at from public.messages where id=:'location_message'),'older viewability events cannot move the cursor backward');
reset role;

insert into storage.objects(bucket_id,name,owner_id)
values('chat-images','71110000-0000-0000-0000-000000000001/71110000-0000-0000-0001-000000000001_sample.webp',
  '71110000-0000-0000-0000-000000000001');
select set_config('request.jwt.claims','{"sub":"71110000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.send_chat_attachment('71110000-0000-0000-0001-000000000001','image',
  '71110000-0000-0000-0000-000000000001/71110000-0000-0000-0001-000000000001_sample.webp') as image_message \gset
select is((select kind from public.messages where id=:'image_message'),'image','uploaded photo becomes a typed message');
reset role;
select set_config('request.jwt.claims','{"sub":"71110000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id='chat-images' and name like '%sample.webp'),1,
  'other participant can read a sent photo');
reset role;

select set_config('request.jwt.claims','{"sub":"71110000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id='chat-images' and name like '%sample.webp'),0,
  'outsider cannot read the chat photo');
select throws_ok($$select public.get_chat_read_position('71110000-0000-0000-0001-000000000001')$$,
  'P0001','CONVERSATION_ACCESS_DENIED','outsiders cannot read a chat cursor');
select throws_ok($$select public.mark_chat_read('71110000-0000-0000-0001-000000000001','71110000-0000-0000-0002-000000000001')$$,
  'P0001','MESSAGE_NOT_VISIBLE','outsiders cannot mark another room as read');
reset role;
select ok(not has_function_privilege('anon','public.send_chat_attachment(uuid,text,text,numeric,numeric)','execute'),
  'anonymous users cannot send attachments');
select ok(not has_function_privilege('anon','public.get_chat_read_position(uuid)','execute'),
  'anonymous users cannot inspect read positions');

select * from finish();
rollback;
