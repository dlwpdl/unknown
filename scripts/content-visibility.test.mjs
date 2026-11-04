import assert from 'node:assert/strict';
import test from 'node:test';
import { hideContent, isContentHidden, showContent, subscribeVisibility } from '../src/lib/content-visibility.ts';
import { blockUser, reportContent, setPostHidden } from '../src/lib/community-data.ts';

test('successful reports hide only that target for its reporter; failed actions do not hide', async () => {
  const client = { rpc: async () => ({ data: 'report', error: null }) };
  await reportContent(client, 'post', 'reported-post', 'spam', '', 'reporter');
  assert.equal(isContentHidden('reporter', 'post', 'reported-post', 'author'), true);
  assert.equal(isContentHidden('other', 'post', 'reported-post', 'author'), false);
  assert.equal(isContentHidden('reporter', 'post', 'another-post', 'author'), false);
  client.rpc = async () => ({ error: new Error('offline') });
  await assert.rejects(reportContent(client, 'post', 'failed-post', 'spam', '', 'reporter'), /offline/);
  assert.equal(isContentHidden('reporter', 'post', 'failed-post', 'author'), false);
});

test('blocking invalidates every surface and filters even a late response, scoped to one account', async () => {
  let notified = 0;
  const stop = subscribeVisibility(() => notified++);
  const client = { from: () => ({ upsert: async () => ({ error: null }) }) };
  await blockUser(client, 'blocker', 'blocked-author');
  for (const type of ['post', 'comment', 'message']) {
    assert.equal(isContentHidden('blocker', type, 'late-response', 'blocked-author'), true);
    assert.equal(isContentHidden('other', type, 'late-response', 'blocked-author'), false);
  }
  assert.equal(notified, 1);
  stop();
  hideContent('blocker', 'comment', 'reported-comment');
  assert.equal(notified, 1);
  assert.equal(isContentHidden('blocker', 'post', 'reported-comment'), false);
});

test('이 글 숨기기 drops the post from lists at once, keeps detail and links open, and a failed save or undo puts it back (owner 2026-11-04)', async () => {
  const calls = [];
  let fail = false, listedWhileSaving;
  const client = { rpc: async (name, args) => {
    calls.push([name, args]); listedWhileSaving = isContentHidden('hider', 'listed_post', args.p_post_id, 'author');
    return { error: fail ? new Error('offline') : null };
  } };
  await setPostHidden(client, 'hider', 'hidden-post', true);
  assert.deepEqual(calls, [['set_post_hidden', { p_post_id: 'hidden-post', p_hidden: true }]]);
  assert.equal(listedWhileSaving, true, 'the lists drop it before the server answers');
  assert.equal(isContentHidden('hider', 'listed_post', 'hidden-post', 'author'), true);
  assert.equal(isContentHidden('hider', 'post', 'hidden-post', 'author'), false, 'the detail, links and my meetups still open it');
  assert.equal(isContentHidden('other', 'listed_post', 'hidden-post', 'author'), false, 'only the member who hid it');

  await setPostHidden(client, 'hider', 'hidden-post', false);
  assert.equal(isContentHidden('hider', 'listed_post', 'hidden-post', 'author'), false, 'undo shows it again');

  fail = true;
  await assert.rejects(setPostHidden(client, 'hider', 'unsaved-post', true), /offline/);
  assert.equal(isContentHidden('hider', 'listed_post', 'unsaved-post', 'author'), false, 'a failed save puts the post back');
  fail = false;
  await setPostHidden(client, 'hider', 'kept-hidden', true);
  fail = true;
  await assert.rejects(setPostHidden(client, 'hider', 'kept-hidden', false), /offline/);
  assert.equal(isContentHidden('hider', 'listed_post', 'kept-hidden', 'author'), true, 'a failed undo keeps it hidden');
  assert.ok(!calls.some(([name]) => name === 'create_report'), 'hiding files no report');
});

test('list rows also drop reported posts and blocked authors; showing again only touches what was hidden', () => {
  let notified = 0;
  const stop = subscribeVisibility(() => notified++);
  hideContent('lister', 'post', 'reported-in-list');
  assert.equal(isContentHidden('lister', 'listed_post', 'reported-in-list'), true);
  hideContent('lister', 'user', 'blocked-in-list');
  assert.equal(isContentHidden('lister', 'listed_post', 'any-post', 'blocked-in-list'), true);
  showContent('lister', 'listed_post', 'never-hidden');
  assert.equal(notified, 2, 'nothing to show again, so no repaint');
  stop();
});

test('lists drop hidden posts; the screens that open one post keep the reported-only check', async () => {
  const { readFileSync } = await import('node:fs');
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const lists = { 'src/components/feed-screen.tsx': 2, 'src/components/weekly-ranking.tsx': 1, 'src/app/(tabs)/meetups.tsx': 1 };
  for (const [path, count] of Object.entries(lists)) {
    assert.equal(read(path).split("hidden('listed_post'").length - 1, count, path);
    assert.ok(!read(path).includes("hidden('post'"), `${path} lists use listed_post`);
  }
  for (const path of ['src/components/post-detail.tsx', 'src/app/meetup-join.tsx', 'src/components/my-meetups.tsx', 'src/components/shared-link-card.tsx'])
    assert.ok(!read(path).includes('listed_post'), `${path} still opens a hidden post`);
  const migration = read('supabase/migrations/20261104140000_hidden_posts.sql');
  assert.ok(migration.includes("('post.manage.hide')"), 'the new menu target is allowed for analytics');
  assert.ok(read('src/components/post-card.tsx').includes("analyticsId: 'post.manage.hide'"));
});
