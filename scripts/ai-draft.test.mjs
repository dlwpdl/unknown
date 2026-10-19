import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAiDraftResponse } from '../src/lib/ai-draft.ts';
import * as aiDraft from '../src/lib/ai-draft.ts';

test('AI 초안 응답을 앱 형식으로 정규화한다', () => {
  assert.deepEqual(
    parseAiDraftResponse({
      draft: {
        categorySlug: 'shopping',
        title: '  원목 식탁 나눔  ',
        body: '  사진 속 식탁을 나눔합니다. 상태와 크기를 확인해주세요.  ',
        hashtags: ['#가구', 'Coquitlam', '코퀴틀럼', '나눔', '이사', '원목'],
      },
    }),
    {
      categorySlug: 'shopping',
      title: '원목 식탁 나눔',
      body: '사진 속 식탁을 나눔합니다. 상태와 크기를 확인해주세요.',
      hashtags: ['가구', '코퀴틀람', '나눔', '이사', '원목'],
    },
  );
});

test('비즈니스 초안은 정상 카테고리로 받아들인다', () => {
  const draft = { categorySlug: 'business', title: '업체 소개', body: '밴쿠버에서 운영하는 가게를 소개합니다.', hashtags: ['업체소개'] };
  assert.deepEqual(parseAiDraftResponse({ draft }), draft);
});

test('업체 소개·구인구직·중고거래 초안 카테고리를 지원한다', () => {
  for (const categorySlug of ['business', 'jobs', 'used']) {
    const draft = { categorySlug, title: '지역 안내', body: '밴쿠버의 소식을 나눕니다.', hashtags: [] };
    assert.deepEqual(parseAiDraftResponse({ draft }), draft);
  }
});

test('알 수 없는 카테고리나 빈 본문은 거부한다', () => {
  assert.throws(() => parseAiDraftResponse({ draft: { categorySlug: 'sale', title: '제목', body: '본문', hashtags: [] } }));
  assert.throws(() => parseAiDraftResponse({ draft: { categorySlug: 'life', title: '제목', body: ' ', hashtags: [] } }));
});

const meetup = {
  categorySlug: 'meetup', title: '가볍게 산책해요', body: '걷고 이야기 나눌 이웃을 찾아요.', hashtags: ['산책'],
  purpose: '편하게 걸으며 알아가요.', activities: ['인사를 나눠요.', '각자 편한 속도로 걸어요.'],
  fit: '가벼운 산책과 대화를 좋아하는 분', preparation: [], applicationQuestion: '어떤 산책을 좋아하세요?',
};

test('meetup drafts validate all outline fields and keep factual fields outside the contract', () => {
  assert.deepEqual(aiDraft.parseMeetupAiDraftResponse({ draft: meetup }), meetup);
  for (const change of [
    { categorySlug: 'life' }, { title: 'x'.repeat(61) }, { body: 'x'.repeat(1001) },
    { purpose: ' ' }, { purpose: 'x'.repeat(501) }, { activities: [] }, { activities: Array(7).fill('걷기') },
    { activities: ['x'.repeat(201)] }, { fit: null }, { preparation: [''] }, { preparation: Array(7).fill('물') },
    { applicationQuestion: 'x'.repeat(301) }, { hashtags: [42] }, { hashtags: Array(6).fill('산책') },
    { capacity: 6 }, { startsAt: '2026-10-20' }, { venue: '예약한 장소' }, { price: 10 },
  ]) assert.throws(() => aiDraft.parseMeetupAiDraftResponse({ draft: { ...meetup, ...change } }), /INVALID_AI_DRAFT/);
  for (const value of [null, [], {}, { draft: [] }]) assert.throws(() => aiDraft.parseMeetupAiDraftResponse(value), /INVALID_AI_DRAFT/);
  assert.throws(() => aiDraft.parseMeetupAiDraftResponse({ draft: { ...meetup, constructor: 'unexpected' } }), /INVALID_AI_DRAFT/);
});

test('meetup application includes the useful outline and only selected unchanged fields', () => {
  const fields = aiDraft.meetupAiDraftFields(meetup, 'ko');
  for (const text of [meetup.body, meetup.purpose, ...meetup.activities, meetup.fit]) assert.ok(fields.body.includes(text));
  assert.equal(fields.question, meetup.applicationQuestion);
  const baseline = { title: 0, body: 0, question: 0 };
  assert.deepEqual(aiDraft.meetupAiDraftChanges(fields, { title: true, body: false, question: true }, baseline, baseline), { title: meetup.title, question: meetup.applicationQuestion });
  assert.deepEqual(aiDraft.meetupAiDraftChanges(fields, { title: true, body: true, question: true }, baseline, { title: 1, body: 0, question: 2 }), { body: fields.body });
  assert.deepEqual(aiDraft.meetupAiDraftChanges(fields, { title: true, body: true, question: true }, baseline, { title: 1, body: 1, question: 1 }), {});
  assert.ok(aiDraft.meetupAiDraftFields({ ...meetup, preparation: ['물'] }, 'en').body.includes('Preparation\n• 물'));
});
