import assert from 'node:assert/strict';
import test from 'node:test';
import { hideContent, isContentHidden, subscribeVisibility } from '../src/lib/content-visibility.ts';
import { blockUser, reportContent } from '../src/lib/community-data.ts';

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
