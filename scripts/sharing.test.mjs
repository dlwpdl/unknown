import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSharedPostUrl, sharedLinkTarget, sharedLinkInMessage, sharedPostMessage, sharedPostReturnPath } from '../src/lib/sharing.ts';

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

const id = '12345678-1234-1234-1234-123456789abc';
test('only owned Gling links become internal preview cards', () => {
  assert.deepEqual(sharedLinkTarget(`https://gling.ej-entertainment.com/share/${id}`), { id, invite: false });
  assert.deepEqual(sharedLinkTarget(`https://gling.ej-entertainment.com/post?id=${id}&invite=1`), { id, invite: true });
  assert.deepEqual(sharedLinkTarget(`https://gling.ej-entertainment.com/post/${id}`), { id, invite: false });
  for (const url of [`https://gling.ej-entertainment.com.evil.test/share/${id}`, `https://evil.test/share/${id}`, `http://gling.ej-entertainment.com/share/${id}`, `https://user@glig.ej-entertainment.com/share/${id}`, `https://gling.ej-entertainment.com/share/${id}/private`, `https://gling.ej-entertainment.com/post?id=${id}&id=other`]) assert.equal(sharedLinkTarget(url), null);
  assert.equal(sharedLinkInMessage(`같이 가요\nhttps://evil.test\nhttps://gling.ej-entertainment.com/share/${id}`), `https://gling.ej-entertainment.com/share/${id}`);
});
test('outbound sharing never copies the post body or private meetup location', () => {
  const post = { id, title: '페스티벌 같이 가요', body: '비공개 상세 집결 장소', room: {} };
  const text = sharedPostMessage(post);
  assert.ok(text.includes('페스티벌 같이 가요'));
  assert.ok(text.includes(`/post?id=${id}`));
  assert.ok(!text.includes(post.body));
});
test('login resumes only a validated local post, never an external redirect', () => {
  assert.equal(sharedPostReturnPath(`/post?id=${id}&invite=1`), `/post?id=${id}&invite=1`);
  for (const path of [`//evil.test/post?id=${id}`, `https://evil.test/post?id=${id}`, `/auth/callback?next=${id}`, `/post?id=${id}&id=other`, '/post?id=invalid', null]) assert.equal(sharedPostReturnPath(path), '/');
  assert.equal(sharedPostReturnPath(`/post?id=${id}&next=https://evil.test`), `/post?id=${id}`);
});
