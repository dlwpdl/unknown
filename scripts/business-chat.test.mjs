import assert from 'node:assert/strict';
import test from 'node:test';
import * as chat from '../src/lib/business-chat.ts';
import { loadConversations } from '../src/lib/community-data.ts';

const user = 'c1810000-0000-4000-8000-000000000001';
const actor = 'c1810000-0000-4000-8000-000000000002';
const business = 'c1820000-0000-4000-8000-000000000001';
const room = 'c1830000-0000-4000-8000-000000000001';
const message = 'c1840000-0000-4000-8000-000000000001';
const token = 'c1850000-0000-4000-8000-000000000001';
const at = '2026-10-18T02:30:00Z';
const logo = `business-profile/${business}/avatar/${'a'.repeat(32)}`;
const identity = (kind, id, name) => ({ kind, id, name, avatar_path: kind === 'business' ? logo : null });
const row = () => ({ id: room, kind: 'business', status: 'active', latest_body: 'Hello', latest_at: at,
  self_identity: identity('business', business, 'Example Business'), other_identity: identity('user', user, 'Neighbor'),
  owner_id: actor, requester_id: actor, owner_nickname: 'Private owner' });
const dto = (patch = {}) => ({ id: message, conversation_id: room, sender_id: business, sender_kind: 'business',
  sender_name: 'Example Business', avatar_path: logo, is_mine: true, body: 'Hello', created_at: at, kind: 'text',
  image_path: null, image_paths: [], latitude: null, longitude: null, location_label: null,
  reply_to_id: null, reply_to: null, edited_at: null, deleted_at: null, hearts: 0, mine_reacted: false,
  actor_id: actor, ...patch });
const conversation = () => chat.mapBusinessConversation(row(), actor, business);
function client(data, error = null) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push([name, args]); return { data, error }; },
    auth: { getSession: async () => ({ data: { session: { user: { id: actor }, access_token: 'fixture-token' } }, error: null }) },
    storage: { from: () => ({ getPublicUrl: path => ({ data: { publicUrl: `https://project.example/storage/v1/object/public/chat-images/${path}` } }) }) } };
}

test('explicit personal and business inboxes use the identity RPC and reject another scope', async () => {
  const api = client({ items: [row()], selected: row(), pending_count: 0, cursor: null });
  const page = await loadConversations(api, actor, 'direct', null, room, business);
  assert.equal(page.selectedConversation.selfIdentity.id, business);
  assert.equal(api.calls[0][0], 'get_identity_conversation_inbox');
  assert.equal(api.calls[0][1].p_as_business_id, business);
  await assert.rejects(loadConversations(api, actor, 'direct', null, room, null), /BUSINESS_CHAT_READ_FAILED/);
  const personal = { ...row(), self_identity: identity('user', actor, 'Me'), other_identity: identity('business', business, 'Example Business') };
  api.rpc = async (name, args) => {
    assert.equal(name, 'get_identity_conversation_inbox'); assert.equal(args.p_as_business_id, null);
    return { data: { items: [personal], selected: null, pending_count: 0, cursor: null }, error: null };
  };
  assert.equal((await loadConversations(api, actor, 'all', null, null, null)).conversations[0].otherUser.id, business);
});

test('private realtime accepts only identifier events and drops sender/private fields', async () => {
  let handler, removed = false; const events = [];
  const channel = { on(kind, filter, next) { assert.equal(kind, 'broadcast'); assert.equal(filter.event, 'business_chat_changed'); handler = next; return this; }, subscribe() { return this; } };
  const api = { channel(name, options) { assert.equal(name, `business-chat:${actor}`); assert.equal(options.config.private, true); return channel; }, removeChannel(value) { assert.equal(value, channel); removed = true; return Promise.resolve(); } };
  const stop = chat.subscribeBusinessChat(api, actor, event => events.push(event));
  handler({ payload: { conversation_id: room, message_id: message, recipient_business_id: business, actor_id: actor, body: 'Private' } });
  handler({ payload: { conversation_id: '../bad' } });
  assert.deepEqual(events, [{ conversationId: room, messageId: message, businessId: business }]);
  stop(); await new Promise(setImmediate); assert.equal(removed, true);
});

test('business preview keeps public endpoints and drops linked actor/requester information', () => {
  const mapped = conversation();
  assert.equal(mapped.kind, 'business');
  assert.equal(mapped.selfIdentity.id, business);
  assert.equal(mapped.otherUser.id, user);
  assert.equal(mapped.requesterId, null);
  assert.ok(mapped.selfIdentity.avatarUri.includes('format=business-image'));
  assert.ok(!JSON.stringify(mapped).includes(actor));
  assert.ok(!JSON.stringify(mapped).includes('Private owner'));
});

test('wrong identity scope and private business logo paths are rejected', () => {
  assert.throws(() => chat.mapBusinessConversation(row(), actor, null), /BUSINESS_CHAT_READ_FAILED/);
  assert.throws(() => chat.mapBusinessConversation({ ...row(), self_identity: { ...row().self_identity, avatar_path: `${actor}/logo.webp` } }, actor, business), /BUSINESS_CHAT_READ_FAILED/);
});

test('business starts use exactly the selected sender identity and a public recipient business or user', async () => {
  const api = client(room);
  await chat.startBusinessConversation(api, { userId: user }, business, message);
  await chat.startBusinessConversation(api, { businessId: business }, null);
  assert.deepEqual(api.calls, [
    ['start_business_conversation', { p_as_business_id: business, p_other_user_id: user, p_other_business_id: null, p_post_id: message }],
    ['start_business_conversation', { p_as_business_id: null, p_other_user_id: null, p_other_business_id: business, p_post_id: null }],
  ]);
  await assert.rejects(chat.startBusinessConversation(api, { userId: user }, null), /INVALID_BUSINESS_CHAT_RECIPIENT/);
});

test('a missing or rejected business RPC never retries through a personal DM endpoint', async () => {
  const api = client(null, { code: 'PGRST202', message: 'business RPC unavailable' });
  await assert.rejects(chat.startBusinessConversation(api, { businessId: business }, null), /business RPC unavailable/);
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0][0], 'start_business_conversation');
});

test('safe messages and replies never copy a raw business actor or unknown response fields', async () => {
  const api = client({ conversation: row(), items: [dto({ reply_to_id: token,
    reply_to: { id: token, sender_id: user, sender_kind: 'user', body: 'Question', kind: 'text', deleted_at: null, actor_id: actor } })], cursor: null, read_at: at });
  const page = await chat.loadBusinessChatMessages(api, conversation());
  assert.equal(page.messages[0].sender_id, business);
  assert.equal(page.messages[0].sender_nickname, 'Example Business');
  assert.equal(page.messages[0].reply.sender_id, user);
  assert.equal(page.readAt, at);
  assert.ok(!JSON.stringify(page).includes(actor));
  assert.deepEqual(api.calls[0][1], { p_conversation_id: room, p_as_business_id: business, p_limit: 50,
    p_before_created: null, p_before_id: null, p_message_ids: null });
});

test('an unexpected business sender actor is rejected before it reaches the UI', async () => {
  const api = client({ conversation: row(), items: [dto({ sender_id: actor })], cursor: null, read_at: null });
  await assert.rejects(chat.loadBusinessChatMessages(api, conversation()), /BUSINESS_CHAT_READ_FAILED/);
});

test('business image requests carry current authorization and only public-identity object paths', async () => {
  const path = `${business}/${room}_12345-safe.webp`;
  const api = client({ conversation: row(), items: [dto({ kind: 'image', body: '📷 사진', image_path: path, image_paths: [path] })], cursor: null, read_at: null });
  const page = await chat.loadBusinessChatMessages(api, conversation());
  assert.equal(page.messages[0].imageSources[0].headers.Authorization, 'Bearer fixture-token');
  assert.equal(page.messages[0].imageSources[0].uri, `https://project.example/storage/v1/object/authenticated/chat-images/${path}`);
  assert.ok(!page.messages[0].imageSources[0].uri.includes(actor));
  api.rpc = async () => ({ data: { conversation: row(), items: [dto({ kind: 'image', image_paths: [`${actor}/${room}_12345-safe.webp`] })], cursor: null, read_at: null }, error: null });
  await assert.rejects(chat.loadBusinessChatMessages(api, conversation()), /BUSINESS_CHAT_READ_FAILED/);
});

test('exact-ID refresh is identity-scoped and caps message batches', async () => {
  const api = client({ conversation: row(), items: [dto()], cursor: null, read_at: null });
  await chat.loadBusinessChatMessages(api, conversation(), { messageIds: [message, message] });
  assert.deepEqual(api.calls[0][1].p_message_ids, [message]);
  await assert.rejects(chat.loadBusinessChatMessages(api, conversation(), { messageIds: Array.from({ length: 51 }, (_, i) => `c1840000-0000-4000-8000-${String(i).padStart(12, '0')}`) }), /MESSAGE_BATCH_TOO_LARGE/);
});

test('business text/photo/location sends share one explicit identity-bound idempotent endpoint', async () => {
  const api = client(message);
  await chat.sendBusinessChatMessage(api, conversation(), { clientId: token, body: ' Hello ', replyToId: message });
  assert.deepEqual(api.calls[0], ['send_business_chat_message', { p_conversation_id: room, p_as_business_id: business,
    p_client_id: token, p_body: 'Hello', p_kind: 'text', p_image_paths: [], p_latitude: null, p_longitude: null,
    p_reply_to_id: message, p_location_label: null }]);
  assert.ok(!JSON.stringify(api.calls).includes(actor));
});

test('editing, deletion, reads and reactions always carry the pinned conversation identity', async () => {
  const api = client(dto());
  await chat.editBusinessChatMessage(api, conversation(), message, 'Edited', at);
  await chat.deleteBusinessChatMessage(api, conversation(), message, at);
  api.rpc = async (name, args) => { api.calls.push([name, args]); return { data: name === 'set_business_chat_reaction' ? { hearts: 1, mine: true } : null, error: null }; };
  await chat.markBusinessChatRead(api, conversation(), message);
  assert.deepEqual(await chat.setBusinessChatReaction(api, conversation(), message, true), { hearts: 1, mine: true });
  assert.ok(api.calls.every(([, args]) => args.p_as_business_id === business));
});

test('report, block and ending cannot fall back to blocking or exposing a personal business owner', async () => {
  const api = client(token);
  await chat.reportBusinessChatMessage(api, conversation(), message, 'spam', 'Report details');
  await chat.blockBusinessConversation(api, conversation());
  await chat.endBusinessConversation(api, conversation());
  assert.deepEqual(api.calls.map(([name]) => name), ['report_business_chat_message', 'block_business_conversation', 'end_business_conversation']);
  assert.ok(api.calls.every(([, args]) => args.p_as_business_id === business));
  assert.ok(!JSON.stringify(api.calls).includes(actor));
});


test('inbox and room share one private topic and closing a room preserves the inbox listener', async () => {
  const handlers = [], events = []; let subscriptions = 0, removed = 0;
  const channel = { on(_kind, _filter, handler) { handlers.push(handler); return this; }, subscribe() { subscriptions++; return this; } };
  const api = { channel() { return channel; }, removeChannel() { removed++; return Promise.resolve(); } };
  const inbox = chat.subscribeBusinessChat(api, actor, event => events.push(['inbox', event.conversationId]));
  const roomListener = chat.subscribeBusinessChat(api, actor, event => events.push(['room', event.conversationId]));
  assert.equal(subscriptions, 1, 'Supabase reuses channels by topic; listeners must share its lifecycle');
  handlers[0]({ payload: { conversation_id: room } });
  roomListener(); assert.equal(removed, 0);
  handlers[0]({ payload: { conversation_id: room } });
  assert.deepEqual(events.map(([scope]) => scope), ['inbox', 'room', 'inbox']);
  inbox(); await new Promise(setImmediate); assert.equal(removed, 1);
});


test('a profile/filter remount reuses the live topic and waits for a retiring channel before rejoining', async () => {
  let created = 0, removed = 0, finish;
  const api = { channel() { created++; return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() { removed++; return new Promise(resolve => { finish = resolve; }); } };
  const first = chat.subscribeBusinessChat(api, actor, () => {}); first();
  const replacement = chat.subscribeBusinessChat(api, actor, () => {});
  await Promise.resolve(); assert.equal(created, 1); assert.equal(removed, 0);
  replacement(); await Promise.resolve(); assert.equal(removed, 1);
  const next = chat.subscribeBusinessChat(api, actor, () => {});
  assert.equal(created, 1, 'do not join the same channel while unsubscribe is pending');
  finish('ok'); await new Promise(setImmediate); assert.equal(created, 2);
  next(); await Promise.resolve(); finish('ok'); await new Promise(setImmediate);
});

test('business pages keep timeline order and deleted photo tombstones contain no media or original text', async () => {
  const old = 'c1840000-0000-4000-8000-000000000000';
  const api = client({ conversation: row(), items: [dto(), dto({ id: old, kind: 'image', deleted_at: at, body: 'PRIVATE_OLD_TEXT', image_path: null, image_paths: [], created_at: '2026-10-17T12:00:00Z' })], cursor: null, read_at: null });
  const page = await chat.loadBusinessChatMessages(api, conversation());
  assert.deepEqual(page.messages.map(item => item.id), [old, message]);
  assert.deepEqual(page.messages[0].image_paths, []);
  assert.ok(!JSON.stringify(page).includes('PRIVATE_OLD_TEXT'));
});
