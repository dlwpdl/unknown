import assert from 'node:assert/strict';
import test from 'node:test';
import { handlePushNotifications } from '../_shared/push-notifications.ts';

const id = '11111111-1111-4111-8111-111111111111';
const ticket = '22222222-2222-4222-8222-222222222222';
const base = { id, lease_id: ticket, token: 'ExpoPushToken[abcdefghijklmnop]', user_id: id, notification_id: id, ticket_id: null };
async function sendOne(job) {
  let message;
  const rpc = async (name, args) => ({ error: null, data: name === 'claim_push_notifications' && args.p_phase === 'send' ? [job] : null });
  const fetcher = async (_, options) => { [message] = JSON.parse(options.body); return Response.json({ data: [{ status: 'ok', id: ticket }] }); };
  await handlePushNotifications(new Request('https://example.test', { method: 'POST', headers: { 'x-push-secret': 's' } }), { secret: 's', rpc, fetcher });
  return message;
}

test('comment and reply pushes use the server title and the comment text', async () => {
  const comment = { ...base, category: 'replies', kind: 'comment', body: '첫 줄 둘째 줄', route: `/post/${id}?commentId=${id}`, push_title: '튠3님의 댓글' };
  const ko = await sendOne(comment);
  assert.equal(ko.title, '튠3님의 댓글');
  assert.equal(ko.body, '첫 줄 둘째 줄');
  const en = await sendOne({ ...comment, locale: 'en' });
  assert.equal(en.title, '튠3 commented');
  assert.equal(en.body, '첫 줄 둘째 줄', 'comment text is never translated');
  assert.equal((await sendOne({ ...comment, kind: 'reply', push_title: '민지님의 답글', locale: 'en' })).title, '민지 replied');
  assert.equal((await sendOne({ ...comment, push_title: null })).title, '글링', 'without a server title the old title stays');
});

test('roundup title, routes to the home feed and the map, and a bubble TTL', async () => {
  const roundup = await sendOne({ ...base, category: 'new_posts', kind: 'city_new_posts', body: '‘글’ 말고도 3개 더 올라왔어요.', route: '/', push_title: '밴쿠버 새 글 4개' });
  assert.equal(roundup.title, '밴쿠버 새 글 4개');
  assert.equal(roundup.data.route, '/');
  assert.equal(roundup.ttl, 3600);
  assert.equal((await sendOne({ ...base, category: 'new_posts', kind: 'city_new_posts', body: 'x', route: '/', push_title: '밴쿠버 새 글 4개', locale: 'en' })).title, '4 new posts in 밴쿠버');
  const bubble = await sendOne({ ...base, category: 'bubble_alerts', kind: 'live_bubble_nearby', body: '지금 밴쿠버에 말풍선이 떴어요. ‘안녕’', route: '/discover', push_ttl: 1500 });
  assert.equal(bubble.data.route, '/discover');
  assert.equal(bubble.ttl, 1500);
  assert.equal(bubble.title, '글링');
  assert.equal((await sendOne({ ...base, category: 'bubble_alerts', kind: 'live_bubble_nearby', body: 'x', route: '/discover', push_ttl: 999999 })).ttl, 86400, 'TTL is capped at a day');
  assert.equal((await sendOne({ ...base, category: 'meetups', kind: 'meetup_host_tip', body: 'x', route: '/elsewhere' })).data.route, '/notifications', 'unknown routes still fall back');
});
