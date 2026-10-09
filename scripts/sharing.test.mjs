import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSharedPostUrl } from '../src/lib/sharing.ts';

test('공개 웹의 실제 정적 글 경로로 ID를 전달한다', () => {
  assert.equal(buildSharedPostUrl('post 1', 'https://gling.example/'), 'https://gling.example/post?id=post%201');
  assert.equal(buildSharedPostUrl('post 1'), 'https://gling.ej-entertainment.com/post?id=post%201');
});

test('HTML을 텍스트로 반환하는 Supabase 공유 함수 대신 공개 글 화면을 쓴다', () => {
  assert.equal(buildSharedPostUrl('post 1', undefined, 'https://project.supabase.co/functions/v1/public-post'), 'https://gling.ej-entertainment.com/post?id=post%201');
});

test('별도로 설정한 공개 공유 주소는 유지한다', () => {
  assert.equal(buildSharedPostUrl('post 1', undefined, 'https://gling.example/share/'), 'https://gling.example/share?id=post%201');
});
