import assert from 'node:assert/strict';
import test from 'node:test';
import { count, t } from '../src/i18n/ko.ts';

test('세 자리마다 쉼표를 넣는다', () => {
  assert.equal(count(0), '0');
  assert.equal(count(7), '7');
  assert.equal(count(999), '999');
  assert.equal(count(1000), '1,000');
  assert.equal(count(12345), '12,345');
  assert.equal(count(1234567), '1,234,567');
});

test('소수와 음수, 잘못된 값도 자연스럽게 다룬다', () => {
  assert.equal(count(1234.9), '1,234');
  assert.equal(count(-1234), '-1,234');
  assert.equal(count(Number.NaN), '0');
});

test('화면 문구에 쉼표가 실제로 들어간다', () => {
  assert.equal(t.feed.views(12345), '조회 12,345');
  assert.equal(t.feed.likes(1000), '공감 1,000');
  assert.equal(t.profile.stats(1200, 34000, 5), '쓴 글 1,200 · 받은 공감 34,000 · 모임 5');
});
