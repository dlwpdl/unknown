import assert from 'node:assert/strict';
import test from 'node:test';

const implementation = await import('../src/lib/naver-cafe.ts').catch(() => ({}));
test('카페 발행 클라이언트는 검토한 저장 revision·게시판·사진 순서와 요청 ID만 전달한다', async () => {
  assert.equal(typeof implementation.publishMerchantNaverCafe, 'function');
  const input = { requestId: 'request', draftId: 'draft', expectedUpdatedAt: '2026-10-09T00:00:00Z', boardUrl: 'https://cafe.naver.com/f-e/cafes/123/menus/4', imagePaths: ['owner/b.webp', 'owner/a.webp'], confirmed: true };
  let actual;
  const client = { functions: { invoke: async (name, value) => { actual = [name, value.body]; return { data: { request: { status: 'succeeded' } }, error: null }; } } };
  await implementation.publishMerchantNaverCafe(client, 'merchant', { ...input, observedArticleUrl: 'https://cafe.naver.com/receipt/17' });
  assert.deepEqual(actual, ['naver-cafe', { action: 'publish', merchantId: 'merchant', ...input }]);
});
test('상태·시작·해제·OAuth 완료는 서버 기능만 호출하고 비밀키를 받지 않는다', async () => {
  assert.equal(typeof implementation.loadMerchantNaverCafe, 'function');
  const calls = [];
  const client = { functions: { invoke: async (name, value) => { calls.push([name, value.body]); return { data: { configured: false }, error: null }; } } };
  assert.equal((await implementation.loadMerchantNaverCafe(client, 'merchant')).configured, false);
  await implementation.startMerchantNaverCafe(client, 'merchant');
  await implementation.disconnectMerchantNaverCafe(client, 'merchant');
  await implementation.completeMerchantNaverCafe(client, 's'.repeat(64), 'provider-code');
  assert.deepEqual(calls.at(-1)[1], { action: 'complete', state: 's'.repeat(64), code: 'provider-code' });
  await implementation.cancelMerchantNaverPreparation(client, 'merchant', 'request');
  assert.deepEqual(calls.map(([, value]) => value.action), ['status', 'start', 'disconnect', 'complete', 'cancel']);
  await assert.rejects(implementation.loadMerchantNaverCafe({ functions: { invoke: async () => ({ data: null, error: { context: { json: async () => ({ error: 'MERCHANT_ACCESS_REQUIRED' }) } } }) } }, 'merchant'), /MERCHANT_ACCESS_REQUIRED/);
});
