import assert from 'node:assert/strict';
import test from 'node:test';
import { splitPostPhotoCredits } from '../src/lib/post-photo-credits.ts';

test('photo credits leave the article readable without losing attribution or ordinary text', () => {
  const credits = '1. Tibor Kovacs / CC BY 2.0\nhttps://commons.wikimedia.org/wiki/File:Photo.jpg\n라이선스: https://creativecommons.org/licenses/by/2.0\n사진 편집됨.';
  assert.deepEqual(splitPostPhotoCredits(`행사 정보\n\n사진 출처·이용 조건\n${credits}`), { body: '행사 정보', credits });
  for (const body of ['일반 글', '사진 출처·이용 조건은 확인 중', '행사 정보\n\n사진 출처·이용 조건\n내 사진이에요.']) {
    assert.deepEqual(splitPostPhotoCredits(body), { body, credits: '' });
  }
  for (const original of [`행사 정보\n\n사진 출처·이용 조건\n${credits}`, `첫 문단\n\n둘째 문단\n\n사진 출처·이용 조건\n${credits}`]) {
    const result = splitPostPhotoCredits(original);
    assert.ok(result.body && result.credits);
    assert.equal(`${result.body}\n\n사진 출처·이용 조건\n${result.credits}`, original);
  }
});
