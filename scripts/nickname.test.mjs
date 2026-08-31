import assert from 'node:assert/strict';
import test from 'node:test';

import { generateNickname } from '../src/lib/nickname.ts';

test('한글과 영문 닉네임은 각각 두 단어를 조합하고 DB 길이 제한을 지킨다', () => {
  assert.equal(generateNickname('ko', () => 0), '고요한수달');
  assert.equal(generateNickname('en', () => 0), 'CalmOtter');
  assert.equal(generateNickname('ko', () => 0).length <= 20, true);
  assert.equal(generateNickname('en', () => 0).length <= 20, true);
});
