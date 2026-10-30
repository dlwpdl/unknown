import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { handlePushNotifications } from '../supabase/functions/_shared/push-notifications.ts';
import * as i18n from '../src/i18n/index.ts';
import * as convenience from '../src/lib/meetup-convenience.ts';

const postId = '33333333-3333-4333-8333-333333333333';
const noticeId = '44444444-4444-4444-8444-444444444444';
const ticketId = '22222222-2222-4222-8222-222222222222';
// Values built inside the vm context have another realm's prototypes.
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

async function sent(claim) {
  let message;
  const job = { id: noticeId, lease_id: ticketId, token: 'ExpoPushToken[abcdefghijklmnop]', user_id: noticeId, notification_id: noticeId,
    category: 'meetups', kind: 'meetup_reminder', body: '보드게임 모임이 1시간 뒤에 시작해요.', route: `/post/${postId}`, ticket_id: null, ...claim };
  const rpc = async (name, args) => ({ error: null, data: name === 'claim_push_notifications' && args.p_phase === 'send' ? [job] : [] });
  const response = await handlePushNotifications(new Request('https://example.test', { method: 'POST', headers: { 'x-push-secret': 's' } }), {
    secret: 's', rpc, fetcher: async (_, options) => { [message] = JSON.parse(options.body); return Response.json({ data: [{ status: 'ok', id: ticketId }] }); } });
  assert.equal(response.status, 200);
  return message;
}

test('only a member reminder the server marked answerable gets the buttons and the post id', async () => {
  const member = await sent({ rsvp_post_id: postId });
  assert.equal(member.categoryId, 'meetup_rsvp');
  assert.deepEqual(member.data, { notificationId: noticeId, userId: noticeId, category: 'meetups', route: `/post/${postId}`, postId });
  // Host copy, claims from before the migration, other kinds and a mismatched route keep the 1.4.6 payload.
  for (const claim of [{ rsvp_post_id: null }, {}, { kind: 'meetup_changed', rsvp_post_id: postId },
    { rsvp_post_id: '55555555-5555-4555-8555-555555555555' }]) {
    const message = await sent(claim);
    assert.equal('categoryId' in message, false);
    assert.deepEqual(Object.keys(message.data).sort(), ['category', 'notificationId', 'route', 'userId']);
  }
});

function harness({ row = { id: noticeId }, rpcError = null } = {}) {
  const calls = [], local = [], dismissed = [], read = [], categories = [];
  let cleared = 0;
  const query = { select: () => query, eq: (column, value) => { calls.push(['user_notifications', column, value]); return query; },
    maybeSingle: async () => ({ data: row, error: null }) };
  const client = { from: table => { assert.equal(table, 'user_notifications'); return query; },
    rpc: async (name, args) => { calls.push([name, plain(args)]); return { data: { mine: args.p_going ? 'going' : 'not_going' }, error: rpcError }; } };
  const imports = {
    'expo-notifications': {
      setNotificationCategoryAsync: async (...args) => { categories.push(plain(args)); },
      clearLastNotificationResponse: () => { cleared++; },
      dismissNotificationAsync: async id => { dismissed.push(id); },
      scheduleNotificationAsync: async request => { local.push(plain(request)); return 'local'; },
    },
    '@/lib/community-data': { markNotificationsRead: async (_client, ids) => { read.push(plain(ids)); } },
    '@/lib/meetup-convenience': convenience,
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/meetup-push-rsvp.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false } }).outputText;
  vm.runInNewContext(source, { exports, require: withLanguageImports(name => {
    if (name in imports) return imports[name];
    throw new Error(`Unexpected import: ${name}`);
  }) });
  const press = (actionIdentifier, data = {}, identifier = 'push-1') => exports.answerMeetupRsvpFromPush(client, 'member', { actionIdentifier,
    notification: { request: { identifier, content: { data: { notificationId: noticeId, userId: 'member', category: 'meetups', route: `/post/${postId}`, postId, ...data } } } } });
  return { exports, press, calls, local, dismissed, read, categories, cleared: () => cleared };
}

test('the category registers two background buttons in the app language', async t => {
  t.after(() => i18n.setActiveLanguage('ko'));
  const h = harness();
  await h.exports.registerMeetupRsvpCategory();
  i18n.setActiveLanguage('en');
  await h.exports.registerMeetupRsvpCategory();
  const [[id, ko], [, en]] = h.categories;
  assert.equal(id, h.exports.MEETUP_RSVP_CATEGORY);
  assert.equal(id, (await sent({ rsvp_post_id: postId })).categoryId, 'the worker and the app use one category id');
  assert.deepEqual(ko.map(action => [action.identifier, action.buttonTitle]), [['meetup_rsvp_going', '갈게요'], ['meetup_rsvp_not_going', '못 가요']]);
  assert.deepEqual(en.map(action => action.buttonTitle), ["I'm going", "Can't make it"]);
  for (const action of [...ko, ...en]) assert.deepEqual(action.options, { opensAppToForeground: false });
});

test('a button press saves once with the card RSVP call; a body tap is left to the caller', async () => {
  const h = harness();
  assert.equal(h.press('expo.modules.notifications.actions.DEFAULT'), false);
  assert.equal(h.press('reply'), false);
  assert.equal(h.cleared(), 0);
  assert.equal(h.press('meetup_rsvp_going'), true);
  assert.equal(h.press('meetup_rsvp_going'), true, 'the same press delivered again (listener + last response)');
  await flush();
  assert.deepEqual(h.calls, [['user_notifications', 'id', noticeId], ['set_meetup_rsvp', { p_post_id: postId, p_going: true, p_release: false }]]);
  assert.deepEqual(h.dismissed, ['push-1']);
  assert.deepEqual(h.read, [[noticeId]]);
  assert.deepEqual(h.local, []);
  h.press('meetup_rsvp_not_going', {}, 'push-2'); await flush();
  assert.deepEqual(h.calls.at(-1), ['set_meetup_rsvp', { p_post_id: postId, p_going: false, p_release: false }]);
});

for (const [name, options, data, rsvpCalls] of [
  ['the meetup moved, closed or started (reminder left the inbox)', { row: null }, {}, 0],
  ['the server rejects the answer', { rpcError: { message: 'RSVP_UNAVAILABLE' } }, {}, 1],
  ['the push belongs to another account', {}, { userId: 'other' }, 0],
  ['the push has no post id', {}, { postId: undefined }, 0],
]) {
  test(`a failed save tells the member and allows another press: ${name}`, async () => {
    const h = harness(options);
    h.press('meetup_rsvp_going', data); await flush();
    assert.equal(h.calls.filter(([call]) => call === 'set_meetup_rsvp').length, rsvpCalls);
    assert.deepEqual(h.dismissed, [], 'the reminder stays so the member can answer again');
    assert.equal(h.local.length, 1);
    const [{ content, trigger }] = h.local;
    assert.equal(content.body, '알림에서 누른 답을 저장하지 못했어요. 모임 글에서 다시 골라 주세요.');
    assert.deepEqual(content.data, { userId: 'member', category: 'meetups', route: data.postId === undefined && 'postId' in data ? '/notifications' : `/post/${postId}` });
    assert.deepEqual(trigger, { channelId: 'gling-activity' });
    h.press('meetup_rsvp_going', data); await flush();
    assert.equal(h.local.length, 2, 'a failed press is not swallowed by the duplicate guard');
  });
}
