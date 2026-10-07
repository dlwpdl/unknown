import assert from 'node:assert/strict';
import test from 'node:test';
import { adminDashboardUrl, notificationRoute, isAdminNotificationKind, loadNotificationPreferences, saveNotificationPreferences } from '../src/lib/notification-preferences.ts';

test('notification routing accepts existing content destinations and rejects external or injected routes', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const route of [`/post/${id}`, `/post/${id}?commentId=${id}`, `/chat?conversationId=${id}`, '/chat?view=requests', '/profile/guidelines', '/profile/settings', '/notifications']) {
    assert.equal(notificationRoute(route), route);
  }
  assert.equal(notificationRoute(`/chat?requestId=${id}`), '/chat?view=requests');
  for (const route of ['/admin', '/admin?section=reports', '/admin?section=errors', `/admin?safety=${id}`, `/admin?alert=${id}`, '/admin?safety=12', '/admin?alert=1']) {
    assert.equal(notificationRoute(route), route);
  }
  for (const route of ['https://example.com', '//example.com', 'javascript:alert(1)', '/admin?section=../admin', '/admin?redirect=https://example.com', `/admin?safety=${id}&redirect=//example.com`, `/admin?safety=not-a-uuid`, '/admin?alert=0', '/profile/settings?redirect=https://example.com', `/post/${id}/../admin`, `/chat?conversationId=${id}&redirect=//example.com`, {}, null]) {
    assert.equal(notificationRoute(route), null);
  }
});

test('admin-only alerts are distinct from ordinary Gling notifications', () => {
  for (const kind of ['safety_alert', 'admin_security', 'admin_multiacct', 'admin_error_spike']) assert.equal(isAdminNotificationKind(kind), true);
  for (const kind of ['moderation_warning', 'message', 'weekly_ranking']) assert.equal(isAdminNotificationKind(kind), false);
});

test('only an admin route for an admin account opens the private dashboard', () => {
  assert.equal(adminDashboardUrl('/admin?section=reports', true), 'https://cayden-macbookpro.tailb6648f.ts.net/?section=reports');
  assert.equal(adminDashboardUrl('/admin?safety=12', true), 'https://cayden-macbookpro.tailb6648f.ts.net/?safety=12');
  assert.equal(adminDashboardUrl('/admin?section=reports', false), null);
  assert.equal(adminDashboardUrl('/post/11111111-1111-4111-8111-111111111111', true), null);
  assert.equal(adminDashboardUrl('/admin?redirect=https://example.com', true), null);
});

test('notification settings save only the requested patch and propagate server failures', async () => {
  const calls = [];
  const client = { rpc: async (...args) => { calls.push(args); return { data: { replies: false }, error: null }; } };
  await loadNotificationPreferences(client);
  assert.deepEqual(await saveNotificationPreferences(client, { replies: false }), { replies: false });
  assert.deepEqual(calls, [['get_notification_preferences'], ['update_notification_preferences', { p_preferences: { replies: false } }]]);
  await assert.rejects(saveNotificationPreferences({ rpc: async () => ({ error: new Error('NETWORK') }) }, { nearby: true }), /NETWORK/);
});
