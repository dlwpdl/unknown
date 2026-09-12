import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationRoute, loadNotificationPreferences, saveNotificationPreferences } from '../src/lib/notification-preferences.ts';

test('notification routing accepts existing content destinations and rejects external or injected routes', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const route of [`/post/${id}`, `/post/${id}?commentId=${id}`, `/chat?conversationId=${id}`, '/chat?view=requests', '/profile/guidelines', '/profile/settings', '/notifications']) {
    assert.equal(notificationRoute(route), route);
  }
  assert.equal(notificationRoute(`/chat?requestId=${id}`), '/chat?view=requests');
  for (const route of ['https://example.com', '//example.com', 'javascript:alert(1)', '/admin', '/profile/settings?redirect=https://example.com', `/post/${id}/../admin`, `/chat?conversationId=${id}&redirect=//example.com`, {}, null]) {
    assert.equal(notificationRoute(route), null);
  }
});

test('notification settings save only the requested patch and propagate server failures', async () => {
  const calls = [];
  const client = { rpc: async (...args) => { calls.push(args); return { data: { replies: false }, error: null }; } };
  await loadNotificationPreferences(client);
  assert.deepEqual(await saveNotificationPreferences(client, { replies: false }), { replies: false });
  assert.deepEqual(calls, [['get_notification_preferences'], ['update_notification_preferences', { p_preferences: { replies: false } }]]);
  await assert.rejects(saveNotificationPreferences({ rpc: async () => ({ error: new Error('NETWORK') }) }, { nearby: true }), /NETWORK/);
});
