import assert from 'node:assert/strict';
import test from 'node:test';
import { appendPage, autoReadIds, groupInbox, hashtagOf, inboxSections, inboxTab, likeActors, mergeHeadPage } from '../src/lib/notification-inbox.ts';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_SETTING_GROUPS, notificationRoute, openNotificationTarget, pushPromptAllowed, settingPatch, settingState } from '../src/lib/notification-preferences.ts';

const row = (id, kind, extra = {}) => ({ id, kind, category: 'replies', body: `${id} body`, route: null, read_at: null, created_at: `2026-10-26T10:${String(60 - Number(id.replace(/\D/g, '') || 0)).padStart(2, '0')}:00Z`, ...extra });

test('city recommendations go to the city tab, messages never reach the bell, admin rows only split for admins', () => {
  for (const category of ['trending', 'weekly_ranking', 'city_food', 'city_places', 'interests', 'nearby']) assert.equal(inboxTab({ kind: 'trending_post', category }), 'city');
  for (const kind of ['trending_meetup', 'trending_hashtag']) assert.equal(inboxTab({ kind, category: 'system' }), 'city');
  for (const [kind, category] of [['comment', 'replies'], ['post_like', 'post_likes'], ['meetup_request', 'meetups'], ['account_security', 'account_security'], ['moderation_warning', 'system']]) assert.equal(inboxTab({ kind, category }), 'mine');
  assert.equal(inboxTab({ kind: 'message', category: 'messages' }), null);
  assert.equal(inboxTab({ kind: 'admin_digest', category: 'system' }), 'mine');
  assert.equal(inboxTab({ kind: 'admin_digest', category: 'system' }, true), 'admin');
  assert.equal(inboxTab({ kind: 'safety_alert', category: 'system' }, true), 'admin');
});

test('likes and like summaries fold into one row per target; other kinds stay separate', () => {
  const post = { target_type: 'post', target_id: 'p1' };
  const rows = [
    row('n1', 'post_like', { ...post, actor_id: 'a' }), row('n2', 'comment', { target_type: 'comment', target_id: 'c9' }),
    row('n3', 'like_summary', { ...post, actor_id: null }), row('n4', 'post_like', { ...post, actor_id: 'b' }),
    row('n5', 'post_like', { ...post, actor_id: 'a' }), row('n6', 'comment_like', { target_type: 'comment', target_id: 'c1', actor_id: 'c' }),
  ];
  const items = groupInbox(rows);
  assert.deepEqual(items.map(item => [item.kind, item.rows.map(({ id }) => id)]), [['likes', ['n1', 'n3', 'n4', 'n5']], ['single', ['n2']], ['likes', ['n6']]]);
  assert.equal(items[0].lead.id, 'n1');
  assert.deepEqual(likeActors(items[0]), ['a', 'b'], 'the same person liking twice counts once; summaries add nobody');
  const summaryFirst = groupInbox([row('s', 'like_summary', post), row('l', 'post_like', { ...post, actor_id: 'z' })]);
  assert.equal(summaryFirst[0].lead.id, 'l', 'an individual like leads the group over the summary');
});

test('trending hashtags group by tag from the route or the legacy body', () => {
  const a = row('h1', 'trending_hashtag', { category: 'trending', route: '/?hashtag=' + encodeURIComponent('워홀') });
  const b = row('h2', 'trending_hashtag', { category: 'trending', route: '/notifications', body: '요즘 관심이 모이는 주제예요 #워홀' });
  const c = row('h3', 'trending_hashtag', { category: 'trending', route: '/?hashtag=rent' });
  assert.equal(hashtagOf(b), '워홀');
  assert.deepEqual(groupInbox([a, b, c]).map(item => item.rows.map(({ id }) => id)), [['h1', 'h2'], ['h3']]);
});

test('new and earlier sections follow the unread set captured for this visit, not the current read state', () => {
  const items = groupInbox([row('n1', 'comment', { read_at: '2026-10-26' }), row('n2', 'reply', { read_at: '2026-10-25' })]);
  const { fresh, earlier } = inboxSections(items, new Set(['n1']));
  assert.deepEqual(fresh.map(item => item.lead.id), ['n1'], 'a row read during this visit stays under 새 알림');
  assert.deepEqual(earlier.map(item => item.lead.id), ['n2']);
});

test('opening a tab marks only its rows and never chat-request kinds', () => {
  const rows = [row('n1', 'comment'), row('n2', 'meetup_request', { category: 'meetups' }), row('n3', 'trending_post', { category: 'trending' }),
    row('n4', 'meetup_approved', { category: 'meetups' }), row('n5', 'reply', { read_at: '2026-10-26' })];
  assert.deepEqual(autoReadIds(rows, 'mine'), ['n1']);
  assert.deepEqual(autoReadIds(rows, 'city'), ['n3']);
});

test('a refreshed first page keeps older scrolled pages and cursor pages append without duplicates', () => {
  const head = Array.from({ length: 3 }, (_, i) => row(`n${i + 1}`, 'comment'));
  const older = [row('n9', 'comment'), row('n2', 'comment')];
  assert.deepEqual(mergeHeadPage(head, [...head, ...older], 3).map(({ id }) => id), ['n1', 'n2', 'n3', 'n9']);
  assert.deepEqual(mergeHeadPage(head.slice(0, 2), [...head, ...older], 3).map(({ id }) => id), ['n1', 'n2'], 'a short first page is the whole list');
  assert.deepEqual(appendPage(head, [head[2], older[0]]).map(({ id }) => id), ['n1', 'n2', 'n3', 'n9']);
});

test('legacy ranking routes open Today and invalid routes open nothing', () => {
  assert.equal(notificationRoute('/ranking?city=vancouver'), '/');
  assert.equal(notificationRoute('/ranking'), '/');
  for (const value of ['/ranking?city=../admin', '/ranking?city=vancouver&x=1', '/rankings']) assert.equal(notificationRoute(value), null);
  const navigated = [];
  const options = { adminAccount: false, navigate: route => navigated.push(route), dashboardOrigin: async () => 'https://admin.example', openURL: async () => {} };
  assert.equal(openNotificationTarget({ ...options, route: 'https://evil.example' }), false);
  assert.equal(openNotificationTarget({ ...options, route: '/admin?section=reports' }), false, 'non-admins never open admin routes');
  assert.equal(openNotificationTarget({ ...options, route: '/ranking?city=toronto' }), true);
  assert.deepEqual(navigated, ['/']);
});

test('admin routes open the server-provided dashboard, else the in-app admin screen', async () => {
  const navigated = [], opened = [];
  const base = { adminAccount: true, navigate: route => navigated.push(route), openURL: async url => { opened.push(url); } };
  openNotificationTarget({ ...base, route: '/admin?section=reports', dashboardOrigin: async () => 'https://admin.example.ts.net' });
  openNotificationTarget({ ...base, route: '/admin?section=errors', dashboardOrigin: async () => null });
  await new Promise(setImmediate);
  assert.deepEqual(opened, ['https://admin.example.ts.net/?section=reports']);
  assert.deepEqual(navigated, ['/admin?section=errors']);
});

test('settings rows cover every category once except the retired 1:1 request toggle', () => {
  const keys = NOTIFICATION_SETTING_GROUPS.flatMap(group => group.rows.flatMap(item => item.keys));
  assert.deepEqual([...keys].sort(), NOTIFICATION_CATEGORIES.map(item => item.key).filter(key => key !== 'direct_requests').sort());
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(NOTIFICATION_SETTING_GROUPS.map(group => group.id), ['mine', 'city', 'account']);
});

test('app pills write category booleans, push pills write only push_muted, and account security stays locked', () => {
  const likes = NOTIFICATION_SETTING_GROUPS[0].rows.find(item => item.id === 'likes');
  const security = NOTIFICATION_SETTING_GROUPS[2].rows[0];
  const preferences = { post_likes: true, comment_likes: true, account_security: false, push_enabled: true, push_muted: ['trending'] };
  assert.deepEqual(settingState(preferences, likes), { app: true, push: true, pushDisabled: false });
  assert.deepEqual(settingPatch(preferences, likes, 'app', false), { post_likes: false, comment_likes: false });
  assert.deepEqual(settingPatch(preferences, likes, 'push', false), { push_muted: ['trending', 'post_likes', 'comment_likes'] });
  const muted = { ...preferences, push_muted: ['trending', 'post_likes', 'comment_likes'] };
  assert.equal(settingState(muted, likes).push, false);
  assert.deepEqual(settingPatch(muted, likes, 'push', true), { push_muted: ['trending'] });
  assert.equal(settingState({ ...preferences, comment_likes: false }, likes).pushDisabled, true, 'push cannot be toggled while the app row is off');
  assert.equal(settingState({ ...preferences, push_enabled: false }, likes).pushDisabled, true);
  assert.deepEqual(settingState(preferences, security), { app: true, push: true, pushDisabled: true });
  assert.deepEqual(settingPatch(preferences, security, 'app', false), {});
});

test('contextual push sheets respect the 14-day snooze, each moment once, and the OS ask state', () => {
  const now = Date.parse('2026-10-26T00:00:00Z');
  const ready = { authed: true, configured: true, snoozedAt: null, askedReasons: [], reason: 'comment', permissionGranted: false, canAsk: true, now };
  assert.equal(pushPromptAllowed(ready), true);
  assert.equal(pushPromptAllowed({ ...ready, snoozedAt: '2026-10-20T00:00:00Z' }), false);
  assert.equal(pushPromptAllowed({ ...ready, snoozedAt: '2026-10-11T00:00:00Z' }), true, 'the snooze ends after 14 days');
  assert.equal(pushPromptAllowed({ ...ready, askedReasons: ['comment'] }), false);
  assert.equal(pushPromptAllowed({ ...ready, askedReasons: ['comment'], reason: 'meetup_request' }), true);
  assert.equal(pushPromptAllowed({ ...ready, canAsk: false }), false, 'a permanently denied Android/iOS device is never asked');
  assert.equal(pushPromptAllowed({ ...ready, permissionGranted: true }), false);
});
