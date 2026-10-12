import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const source = new URL('../src/lib/admin-conversations.ts', import.meta.url);
const api = existsSync(source) ? await import(source) : null;
const filters = { city: 'vancouver', scope: 'pending', kind: 'direct', risk: 'high', since: '2026-10-06T07:00:00Z', query: ' name ', sort: 'risk' };
const conversation = 'ce000000-0000-4000-8000-000000000001';

test('server filters and the same period reach every conversation page', async () => {
  assert.ok(api, 'Conversation investigation data API is missing');
  const calls = [], result = { rows: [], counts: { all: 0, pending: 0, done: 0, high: 0 }, nextOffset: null };
  const client = { rpc: async (name, params) => { calls.push({ name, params }); return { data: result, error: null }; } };
  for (const offset of [0, 50]) {
    assert.equal(await api.loadAdminConversations(client, filters, offset), result);
    assert.deepEqual(calls.at(-1), { name: 'get_admin_conversations', params: { p_city: 'vancouver', p_scope: 'pending', p_kind: 'direct', p_risk: 'high', p_since: filters.since, p_query: 'name', p_sort: 'risk', p_offset: offset } });
  }
});

test('thread cursor retains database precision and focus is scoped to the selected room', async () => {
  assert.ok(api, 'Conversation investigation data API is missing');
  const calls = [], result = { messages: [] };
  const client = { rpc: async (name, params) => { calls.push({ name, params }); return { data: result, error: null }; } };
  const cursor = { at: '2026-10-12T12:00:00.123456+00:00', id: 'ce100000-0000-4000-8000-000000000001' };
  await api.loadAdminConversation(client, conversation, cursor);
  assert.deepEqual(calls.at(-1), { name: 'get_admin_conversation', params: { p_conversation_id: conversation, p_before: cursor.at, p_before_id: cursor.id, p_focus_message_id: null } });
  await api.loadAdminConversation(client, conversation, null, cursor.id);
  assert.equal(calls.at(-1).params.p_focus_message_id, cursor.id);
  assert.equal(calls.at(-1).params.p_before, null);
});

test('review saves the exact prior revision and signal snapshot with a trimmed note', async () => {
  assert.ok(api, 'Conversation investigation data API is missing');
  let call;
  const review = { id: 'review', status: 'clear' };
  const client = { rpc: async (name, params) => { call = { name, params }; return { data: review, error: null }; } };
  const signalAt = '2026-10-12T12:00:00.123456+00:00';
  assert.equal(await api.saveAdminConversationReview(client, conversation, 'clear', ' 확인한 맥락 ', 'revision', signalAt), review);
  assert.deepEqual(call, { name: 'save_admin_conversation_review', params: { p_conversation_id: conversation, p_status: 'clear', p_note: '확인한 맥락', p_expected_review_id: 'revision', p_expected_signal_at: signalAt } });
});

test('empty notes, oversized notes and invalid states cannot send a review request', async () => {
  assert.ok(api, 'Conversation investigation data API is missing');
  let called = false;
  const client = { rpc: async () => { called = true; return { data: {}, error: null }; } };
  for (const [status, note] of [['clear', '  '], ['clear', '가'.repeat(1001)], ['ban', '메모']]) {
    await assert.rejects(api.saveAdminConversationReview(client, conversation, status, note, null, null));
  }
  assert.equal(called, false);
});

test('permission failures and uncertain saves are propagated without automatic retries', async () => {
  assert.ok(api, 'Conversation investigation data API is missing');
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: null, error: { message: 'CONVERSATION_REVIEW_CHANGED' } }; } };
  await assert.rejects(api.saveAdminConversationReview(client, conversation, 'clear', '확인함', null, null), /CONVERSATION_REVIEW_CHANGED/);
  assert.equal(calls, 1);
  await assert.rejects(api.loadAdminConversations({ rpc: async () => ({ data: null, error: { message: 'ADMIN_REQUIRED' } }) }, filters), /ADMIN_REQUIRED/);
});

test('page repeats cannot duplicate messages and prepend preserves chronological order', () => {
  assert.ok(api, 'Conversation investigation data API is missing');
  const older = { id: 'a', created_at: '2026-10-12T12:00:00.123456Z' }, newer = { id: 'b', created_at: '2026-10-12T12:00:00.123457Z' };
  assert.deepEqual(api.mergeConversationMessages([newer], [older, newer]), [older, newer]);
});

test('whole seconds, mixed fractional precision and UTC offsets remain chronological', () => {
  const at = (id, created_at) => ({ id, created_at });
  const whole = at('whole', '2026-10-12T12:00:00+00:00');
  const tenth = at('tenth', '2026-10-12T12:00:00.1+00:00');
  const microsecond = at('microsecond', '2026-10-12T12:00:00.100001+00:00');
  const equivalent = at('z', '2026-10-12T05:00:00.100001-07:00');
  assert.deepEqual(api.mergeConversationMessages([equivalent, microsecond, tenth, whole], []), [whole, tenth, microsecond, equivalent]);
  assert.equal(api.mergeConversationMessages([microsecond, whole], [tenth])[2].created_at, microsecond.created_at);
});
