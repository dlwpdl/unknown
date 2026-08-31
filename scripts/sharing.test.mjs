import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSharedPostUrl } from '../src/lib/sharing.ts';

test('운영 주소가 있으면 HTTPS 글 링크를 만들고 없으면 앱 딥링크를 쓴다', () => {
  assert.equal(buildSharedPostUrl('post 1', 'https://gling.example/'), 'https://gling.example/post/post%201');
  assert.equal(buildSharedPostUrl('post 1'), 'gling://post/post%201');
});

test('공개 공유 함수 주소는 쿼리로 글 ID를 전달한다', () => {
  assert.equal(
    buildSharedPostUrl('post 1', undefined, 'https://project.supabase.co/functions/v1/public-post'),
    'https://project.supabase.co/functions/v1/public-post?id=post%201',
  );
});
