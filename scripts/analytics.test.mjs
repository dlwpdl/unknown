import assert from 'node:assert/strict';
import test from 'node:test';
import { analyticsScreen } from '../src/lib/analytics.ts';

test('traffic records only named app surfaces without identifiers, search text or admin pages', () => {
  assert.equal(analyticsScreen('/post/private-uuid?secret=value'), 'post');
  assert.equal(analyticsScreen('/profile/membership'), 'membership');
  assert.equal(analyticsScreen('/gling/chat'), 'chat');
  assert.equal(analyticsScreen('/'), 'feed');
  for (const path of ['/admin', '/admin?secret=x', '/auth/callback', '/privacy', '/unknown/path']) {
    assert.equal(analyticsScreen(path), null);
  }
});
