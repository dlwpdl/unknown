import assert from 'node:assert/strict';
import test from 'node:test';
import { adminDashboardUrl, notificationRoute, isAdminNotificationKind, loadNotificationPreferences, saveNotificationPreferences, NOTIFICATION_CATEGORIES } from '../src/lib/notification-preferences.ts';

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

test('event recommendations open the verified city event and reject injected destinations', () => {
  for (const city of ['vancouver', 'toronto', 'montreal', 'calgary', 'edmonton']) {
    assert.equal(notificationRoute(`/events/Z7r9jZ1A-test?cityId=${city}`), `/events/Z7r9jZ1A-test?cityId=${city}`);
  }
  for (const route of ['/events/id', '/events/id?cityId=unknown', '/events/../admin?cityId=toronto', '/events/id?cityId=toronto&redirect=//example.com', '/events/%2fadmin?cityId=toronto']) {
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
  assert.deepEqual(await saveNotificationPreferences(client, { replies: false }), { replies: false, merchant_updates: true, merchant_operations: true, account_security: true });
  assert.deepEqual(calls, [['get_notification_preferences'], ['update_notification_preferences', { p_preferences: { replies: false } }]]);
  await assert.rejects(saveNotificationPreferences({ rpc: async () => ({ error: new Error('NETWORK') }) }, { nearby: true }), /NETWORK/);
});

test('review notifications open only the selected review tab of a valid business', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const kind of ['usage', 'employment']) assert.equal(notificationRoute(`/company/${id}?review=${kind}`), `/company/${id}?review=${kind}`);
  for (const route of [`/company/${id}`, `/company/${id}?review=unknown`, `/company/${id}?review=usage&redirect=//example.test`,
    `/company/${id}/../admin?review=usage`, '/company/not-a-uuid?review=employment']) assert.equal(notificationRoute(route), null);
});

test('business review preferences remain with activity settings and preserve every discovery category', () => {
  assert.deepEqual(NOTIFICATION_CATEGORIES.slice(0, 7).map(item => item.key),
    ['post_likes', 'comment_likes', 'replies', 'direct_requests', 'messages', 'meetups', 'merchant_reviews']);
  assert.deepEqual(NOTIFICATION_CATEGORIES.slice(7, 13).map(item => item.key), ['interests', 'nearby', 'city_food', 'city_places', 'trending', 'weekly_ranking']);
});

test('message preview is a self-scoped preference patch and preserves the server readback', async () => {
  const calls = [];
  const saved = { message_preview: false, messages: true, merchant_reviews: true };
  const client = { rpc: async (...args) => { calls.push(args); return { data: saved, error: null }; } };
  assert.deepEqual(await saveNotificationPreferences(client, { message_preview: false }), { ...saved, merchant_updates: true, merchant_operations: true, account_security: true });
  assert.deepEqual(calls, [['update_notification_preferences', { p_preferences: { message_preview: false } }]]);
  await assert.rejects(saveNotificationPreferences({ rpc: async () => ({ error: new Error('AUTH_REQUIRED') }) }, { message_preview: true }), /AUTH_REQUIRED/);
});

 test('new categories default on without resetting existing opt-outs or city settings', async () => {
  const legacy = { replies: false, city_food: false, push_enabled: false, interest_tag_ids: [2], interest_hashtags: ['coffee'] };
  const result = await loadNotificationPreferences({ rpc: async () => ({ data: legacy }) });
  assert.deepEqual(result, { ...legacy, merchant_updates: true, merchant_operations: true, account_security: true });
  const optedOut = { ...legacy, merchant_updates: false, merchant_operations: false, account_security: false };
  assert.deepEqual(await loadNotificationPreferences({ rpc: async () => ({ data: optedOut }) }), optedOut);
  assert.deepEqual(NOTIFICATION_CATEGORIES.slice(13).map(item => item.key), ['merchant_updates', 'merchant_operations', 'account_security']);
 });

test('business operation notification accepts only the exact internal merchant destination', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(notificationRoute(`/profile/merchant?merchant=${id}`), `/profile/merchant?merchant=${id}`);
  for (const route of ['/profile/merchant', '/profile/merchant?merchant=bad', `/profile/merchant?merchant=${id}&redirect=//evil.test`, `/profile/merchant?merchant=${id}#x`, `/profile/merchant?merchant=${id}/../admin`]) assert.equal(notificationRoute(route), null);
});

test('preference readback rejects missing data or malformed new booleans', async () => {
  for (const data of [null, [], { merchant_updates: 'false' }, { account_security: 0 }]) {
    await assert.rejects(loadNotificationPreferences({ rpc: async () => ({ data }) }), /NOTIFICATION_PREFERENCES_READ_FAILED/);
  }
});
