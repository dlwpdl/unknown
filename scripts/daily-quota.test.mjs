import assert from 'node:assert/strict';
import test from 'node:test';

import { t } from '../src/i18n/ko.ts';

test('남은 글 수를 플랜 한도와 표시한다', () => {
  assert.equal(t.feed.remaining(0, 1), '1/1');
  assert.equal(t.feed.remaining(1, 1), '0/1');
  assert.equal(t.feed.remaining(1, 3), '2/3');
  assert.equal(t.feed.remaining(4, 3), '0/3');
});
