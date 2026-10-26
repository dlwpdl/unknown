import assert from 'node:assert/strict';
import test from 'node:test';
import * as data from '../src/lib/community-data.ts';

test('reply sends the visible parent and selected place in one guarded RPC', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: 'sent', error: null }; } };
  await data.sendDirectMessage(client, 'room', ' hello ', 'parent');
  assert.deepEqual(calls[0], ['send_message_v2', { p_conversation_id: 'room', p_body: 'hello', p_reply_to_id: 'parent' }]);
  await data.sendChatAttachment(client, 'room', { kind: 'location', latitude: 49.28, longitude: -123.12, label: ' Vancouver Library ' }, 'parent');
  assert.deepEqual(calls[1], ['send_message_v2', { p_conversation_id: 'room', p_kind: 'location', p_image_path: null, p_latitude: 49.28, p_longitude: -123.12, p_location_label: 'Vancouver Library', p_reply_to_id: 'parent' }]);
  await data.sendDirectMessage(client, 'room', 'ordinary');
  assert.equal(calls[2][0], 'send_message', 'old callers retain their existing endpoint');
});

test('editing and deletion send the current revision and propagate server refusal', async () => {
  assert.equal(typeof data.editChatMessage, 'function');
  assert.equal(typeof data.deleteChatMessage, 'function');
  const calls = [], revision = '2026-10-12T19:00:00.123456Z';
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: { id: 'message', body: 'changed', edited_at: revision }, error: null }; } };
  const edited = await data.editChatMessage(client, 'message', ' changed ', null);
  assert.equal(edited.body, 'changed');
  assert.deepEqual(calls[0], ['edit_chat_message', { p_message_id: 'message', p_body: 'changed', p_expected_edited_at: null }]);
  await data.deleteChatMessage(client, 'message', revision);
  assert.deepEqual(calls[1], ['delete_chat_message', { p_message_id: 'message', p_expected_edited_at: revision }]);
  client.rpc = async () => ({ data: null, error: { message: 'MESSAGE_CHANGED' } });
  await assert.rejects(data.editChatMessage(client, 'message', 'changed', null), { message: 'MESSAGE_CHANGED' });
});

test('reply previews follow edited/deleted originals and never show a blocked original', () => {
  const parent = { id: 'parent', conversation_id: 'room', sender_id: 'neighbor', body: 'before', kind: 'text', created_at: '1' };
  const reply = { ...parent, id: 'reply', sender_id: 'me', body: 'reply', created_at: '2', reply_to_id: parent.id, reply: parent };
  const edited = data.mergeChatMessages([parent, reply], [{ ...parent, body: 'after', edited_at: 'now' }]);
  assert.equal(edited[1].reply.body, 'after');
  const deleted = data.mergeChatMessages(edited, [{ ...parent, body: '삭제된 메시지입니다.', deleted_at: 'now' }]);
  assert.equal(deleted[1].reply.deleted_at, 'now');
  assert.equal(data.mergeChatMessages(deleted, [], new Set(['neighbor']))[0].reply, null);
});

test('text retries carry one client id and host member controls call their RPCs', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: 'sent', error: null }; } };
  await data.sendDirectMessage(client, 'room', ' hi ', null, 'client-1');
  assert.deepEqual(calls[0], ['send_message_v3', { p_conversation_id: 'room', p_client_id: 'client-1', p_body: 'hi', p_reply_to_id: null }]);
  await data.setMeetupHistoryAccess(client, 'post', 'guest', true);
  assert.deepEqual(calls[1], ['set_meetup_history_access', { p_post_id: 'post', p_user_id: 'guest', p_share: true }]);
  await data.removeMeetupMember(client, 'post', 'guest');
  assert.deepEqual(calls[2], ['remove_meetup_member', { p_post_id: 'post', p_user_id: 'guest' }]);
  const filters = [];
  const query = { select: columns => { filters.push(['select', columns]); return query; }, eq: (column, value) => { filters.push([column, value]); return query; },
    then: resolve => resolve({ data: [{ requester_id: 'guest', share_history: true }], error: null }) };
  const access = await data.loadMeetupHistoryAccess({ from: table => { filters.push(['from', table]); return query; } }, 'post');
  assert.deepEqual(filters, [['from', 'meetup_requests'], ['select', 'requester_id, share_history'], ['post_id', 'post'], ['status', 'approved']]);
  assert.equal(access.get('guest'), true);
  await assert.rejects(data.removeMeetupMember({ rpc: async () => ({ error: { message: 'REQUEST_NOT_FOUND' } }) }, 'post', 'guest'), { message: 'REQUEST_NOT_FOUND' });
});
