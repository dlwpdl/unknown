import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAiDraftResponse } from '../src/lib/ai-draft.ts';

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

test('알 수 없는 카테고리나 빈 본문은 거부한다', () => {
  assert.throws(() => parseAiDraftResponse({ draft: { categorySlug: 'sale', title: '제목', body: '본문', hashtags: [] } }));
  assert.throws(() => parseAiDraftResponse({ draft: { categorySlug: 'life', title: '제목', body: ' ', hashtags: [] } }));
});
