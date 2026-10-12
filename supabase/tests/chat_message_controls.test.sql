begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
('a1220000-0000-0000-0000-000000000001','chat-controls-one@example.test'),
('a1220000-0000-0000-0000-000000000002','chat-controls-two@example.test'),
('a1220000-0000-0000-0000-000000000003','chat-controls-other@example.test');
insert into public.profiles(id,nickname,city_id) values
('a1220000-0000-0000-0000-000000000001','메시지하나','vancouver'),
('a1220000-0000-0000-0000-000000000002','메시지둘','vancouver'),
('a1220000-0000-0000-0000-000000000003','메시지타인','vancouver');
insert into public.conversations(id,user_low_id,user_high_id,status,requester_id) values
('a1221000-0000-0000-0000-000000000001','a1220000-0000-0000-0000-000000000001','a1220000-0000-0000-0000-000000000002','active','a1220000-0000-0000-0000-000000000001'),
('a1221000-0000-0000-0000-000000000002','a1220000-0000-0000-0000-000000000002','a1220000-0000-0000-0000-000000000003','active','a1220000-0000-0000-0000-000000000002');
insert into public.messages(id,conversation_id,sender_id,body) values
('a1222000-0000-0000-0000-000000000001','a1221000-0000-0000-0000-000000000001','a1220000-0000-0000-0000-000000000001','original'),
('a1222000-0000-0000-0000-000000000002','a1221000-0000-0000-0000-000000000001','a1220000-0000-0000-0000-000000000002','other author'),
('a1222000-0000-0000-0000-000000000003','a1221000-0000-0000-0000-000000000002','a1220000-0000-0000-0000-000000000003','another room');
select set_config('request.jwt.claims','{"sub":"a1220000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.edit_chat_message('a1222000-0000-0000-0000-000000000001','edited',null)$$,'author edits own text');
select is((select body from public.messages where id='a1222000-0000-0000-0000-000000000001'),'edited','edited text reaches the participant read path');
select throws_ok($$select public.edit_chat_message('a1222000-0000-0000-0000-000000000001','stale',null)$$,'P0001','MESSAGE_CHANGED','stale edits cannot overwrite a newer change');
select throws_ok($$select public.delete_chat_message('a1222000-0000-0000-0000-000000000002',null)$$,'P0001','MESSAGE_OWNER_REQUIRED','participants cannot delete another sender message');
select throws_ok($$select public.send_message_v2('a1221000-0000-0000-0000-000000000001','reply',p_reply_to_id=>'a1222000-0000-0000-0000-000000000003')$$,'P0001','MESSAGE_REPLY_UNAVAILABLE','reply parent cannot cross rooms');
select lives_ok($$select public.send_message_v2('a1221000-0000-0000-0000-000000000001','reply',p_reply_to_id=>'a1222000-0000-0000-0000-000000000002')$$,'reply uses existing send guards');
select ok(exists(select 1 from public.messages where body='reply' and reply_to_id='a1222000-0000-0000-0000-000000000002'),'reply persists the parent');
select lives_ok($$select public.delete_chat_message('a1222000-0000-0000-0000-000000000001',(select edited_at from public.messages where id='a1222000-0000-0000-0000-000000000001'))$$,'author removes own message for participants');
select is((select body from public.messages where id='a1222000-0000-0000-0000-000000000001'),'삭제된 메시지입니다.','normal reads contain a tombstone');
select throws_ok($$select public.send_message_v2('a1221000-0000-0000-0000-000000000001','reply',p_reply_to_id=>'a1222000-0000-0000-0000-000000000001')$$,'P0001','MESSAGE_REPLY_UNAVAILABLE','deleted content is not copied into new replies');
reset role;
select is((select count(*)::int from private.message_history where message_id='a1222000-0000-0000-0000-000000000001'),2,'both prior versions remain available for authorized safety review');
select ok(not has_table_privilege('authenticated','private.message_history','select'),'ordinary clients cannot read retained originals');
select ok(not has_function_privilege('authenticated','public.get_message_safety_content(uuid)','execute'),'retained safety content is not a participant read endpoint');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select ok(public.get_message_safety_content('a1222000-0000-0000-0000-000000000001')->>'text' like '%original%' and public.get_message_safety_content('a1222000-0000-0000-0000-000000000001')->>'text' like '%edited%','existing safety worker can still analyze retained content after deletion');
reset role;
select is((select content_hash from public.safety_review_queue where target_type='message' and target_id='a1222000-0000-0000-0000-000000000001'),encode(extensions.digest(convert_to(private.message_safety_content('a1222000-0000-0000-0000-000000000001')->>'text','UTF8'),'sha256'),'hex'),'review queue hash includes the retained versions');
select set_config('request.jwt.claims','{"sub":"a1220000-0000-0000-0000-000000000001","role":"authenticated"}',true);
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
values('a1223000-0000-0000-0000-000000000001','a1220000-0000-0000-0000-000000000001','vancouver',1,'대화 기능 확인','모임',current_date,'{"capacity":8}');
insert into public.meetup_requests(post_id,host_id,requester_id,status)
values('a1223000-0000-0000-0000-000000000001','a1220000-0000-0000-0000-000000000001','a1220000-0000-0000-0000-000000000002','approved');
insert into public.messages(id,conversation_id,sender_id,body)
select 'a1222000-0000-0000-0000-000000000004',id,'a1220000-0000-0000-0000-000000000002','group message'
from public.conversations where group_post_id='a1223000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"a1220000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.edit_chat_message('a1222000-0000-0000-0000-000000000004','group edit',null)$$,'approved group members edit their own text');
select lives_ok($$select public.send_message_v2((select id from public.conversations where group_post_id='a1223000-0000-0000-0000-000000000001'),p_kind=>'location',p_latitude=>49.28,p_longitude=>-123.12,p_location_label=>'Library',p_reply_to_id=>'a1222000-0000-0000-0000-000000000004')$$,'group location reply uses the guarded attachment path');
select ok(exists(select 1 from public.messages where location_label='Library' and latitude=49.28 and reply_to_id='a1222000-0000-0000-0000-000000000004'),'selected coordinates and label persist atomically');
select throws_ok($$select public.send_message_v2('a1221000-0000-0000-0000-000000000001',p_kind=>'location',p_latitude=>91,p_longitude=>0)$$,'P0001','INVALID_CHAT_LOCATION','server rejects out-of-range locations');
reset role;
update public.posts set room_preview=room_preview||'{"closed":true}' where id='a1223000-0000-0000-0000-000000000001';
-- Exercise the post guard even if an older client left a conversation active.
update public.conversations set status='active' where group_post_id='a1223000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.edit_chat_message('a1222000-0000-0000-0000-000000000004','closed edit',(select edited_at from public.messages where id='a1222000-0000-0000-0000-000000000004'))$$,'P0001','MEETUP_CLOSED','closed groups refuse edits');
select throws_ok($$select public.delete_chat_message('a1222000-0000-0000-0000-000000000004',(select edited_at from public.messages where id='a1222000-0000-0000-0000-000000000004'))$$,'P0001','MEETUP_CLOSED','closed groups refuse deletion');
select throws_ok($$select public.get_admin_message_history('a1222000-0000-0000-0000-000000000001')$$,'P0001','ADMIN_REQUIRED','ordinary participants cannot fetch retained originals');
reset role;
update auth.users set raw_app_meta_data='{"role":"admin"}' where id='a1220000-0000-0000-0000-000000000003';
insert into auth.sessions(id,user_id,aal) values('a1226000-0000-0000-0000-000000000001','a1220000-0000-0000-0000-000000000003','aal2');
select set_config('request.jwt.claims','{"sub":"a1220000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1","session_id":"a1226000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_message_history('a1222000-0000-0000-0000-000000000001')$$,'P0001','ADMIN_REQUIRED','history requires live second-factor admin access');
reset role;
select set_config('request.jwt.claims','{"sub":"a1220000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2","session_id":"a1226000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_admin_message_history('a1222000-0000-0000-0000-000000000001')),2,'authorized admin can read earlier versions');
reset role;
select ok(exists(select 1 from public.admin_access_logs where actor_id='a1220000-0000-0000-0000-000000000003' and resource_id='a1222000-0000-0000-0000-000000000001'),'history read is audited');
update auth.users set raw_app_meta_data='{}' where id='a1220000-0000-0000-0000-000000000003';
select set_config('request.jwt.claims','{"sub":"a1220000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.edit_chat_message('a1222000-0000-0000-0000-000000000002','intrusion',null)$$,'P0001','MESSAGE_NOT_FOUND','outsiders cannot mutate a conversation');
reset role;
select * from finish();
rollback;
