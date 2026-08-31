import assert from 'node:assert/strict';
import test from 'node:test';

import { t } from '../src/i18n/ko.ts';
import {
  MAX_HASHTAGS,
  addHashtag,
  canonicalizeHashtag,
  getSuggestedHashtags,
  parseHashtags,
  uniqueHashtags,
} from '../src/lib/hashtags.ts';
import { MOCK_POSTS, TAGS } from '../src/lib/mock.ts';

const expected = [
  ['life', '라이프'],
  ['food', '맛집'],
  ['travel', '여행'],
  ['shopping', '쇼핑'],
  ['settlement', '정착'],
  ['transport', '이동'],
  ['housing', '주거'],
  ['education', '교육'],
  ['meetup', '모임'],
];

test('9개 대분류를 정해진 순서로 제공한다', () => {
  assert.deepEqual(TAGS.map(({ slug, label }) => [slug, label]), expected);
});

test('모임만 대화방 생성 대상이다', () => {
  assert.deepEqual(TAGS.filter(({ kind }) => kind === 'meetup').map(({ slug }) => slug), ['meetup']);
  assert.equal(MOCK_POSTS.filter(({ room }) => room).every(({ tag }) => tag.slug === 'meetup'), true);
});

test('모든 mock 글이 현재 대분류를 참조한다', () => {
  const categoryIds = new Set(TAGS.map(({ id }) => id));
  assert.equal(MOCK_POSTS.every(({ tag }) => categoryIds.has(tag.id)), true);
});

test('글쓰기 안내가 9개 대분류를 모두 지원한다', () => {
  assert.deepEqual(Object.keys(t.write.bodyPlaceholder), expected.map(([slug]) => slug));
});

test('실제 사용 빈도가 높은 해시태그를 먼저 제안한다', () => {
  const posts = [
    { tag: { id: 12 }, hashtags: ['워홀', '비자'] },
    { tag: { id: 12 }, hashtags: ['비자', '정착'] },
    { tag: { id: 13 }, hashtags: ['비자'] },
  ];

  assert.deepEqual(getSuggestedHashtags(posts, TAGS.find(({ slug }) => slug === 'settlement'), 4), [
    '비자',
    '워홀',
    '정착',
    '이민',
  ]);
});

test('동네의 한영 표기와 흔한 오타를 대표 해시태그로 합친다', () => {
  assert.deepEqual(
    ['#코퀴틀럼', '코퀴틀람', '커퀴틀람', 'Coquitlam'].map(canonicalizeHashtag),
    Array(4).fill('코퀴틀람'),
  );

  const posts = [
    { tag: { id: 4 }, hashtags: ['코퀴틀럼'] },
    { tag: { id: 4 }, hashtags: ['Coquitlam', '맛집'] },
    { tag: { id: 4 }, hashtags: ['커퀴틀람'] },
  ];

  assert.deepEqual(getSuggestedHashtags(posts, TAGS.find(({ slug }) => slug === 'food'), 3), [
    '코퀴틀람',
    '맛집',
    '카페',
  ]);
});

test('자유 입력을 대표 표기로 중복 제거하고 최대 5개만 저장한다', () => {
  assert.deepEqual(parseHashtags('#코퀴틀럼 Coquitlam 커퀴틀람 맛집'), ['코퀴틀람', '맛집']);
  assert.deepEqual(
    parseHashtags(Array.from({ length: 8 }, (_, i) => `태그${i}`).join(' ')),
    Array.from({ length: MAX_HASHTAGS }, (_, i) => `태그${i}`),
  );
});

test('추천 해시태그를 중복 없이 최대 5개까지 입력한다', () => {
  assert.equal(addHashtag('#워홀 비자', '워홀'), '워홀 비자');
  assert.equal(addHashtag('워홀 비자', '정착'), '워홀 비자 정착');
  assert.equal(
    addHashtag(Array.from({ length: MAX_HASHTAGS }, (_, i) => `태그${i}`).join(' '), '추가'),
    Array.from({ length: MAX_HASHTAGS }, (_, i) => `태그${i}`).join(' '),
  );
});

test('동네와 같은 해시태그는 카드에서 한 번만 표시한다', () => {
  assert.deepEqual(uniqueHashtags(['코리아타운', '맛집', '코리아타운']), ['코리아타운', '맛집']);
});
