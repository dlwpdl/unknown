import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const worker = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../supabase/functions/safety-monitor/index.ts', import.meta.url), 'utf8') + '\nexports.loadContent = loadContent;', {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: worker, Deno: { serve() {} }, require: () => ({}) });

test('merchant reviews use the service-only content RPC including score-only reviews', async () => {
  const review = { authorId: 'review-author', text: '업체 후기 · 검사 업체\n점수 7.5/10', score: 7.5, body: null };
  const content = await worker.loadContent({ rpc: async (name, args) => {
    assert.equal(name, 'get_merchant_review_safety_content');
    assert.deepEqual(JSON.parse(JSON.stringify(args)), { p_target_id: 'review-id' });
    return { data: review, error: null };
  } }, 'merchant_review', 'review-id');
  assert.equal(content, review);
});

test('merchant safety content preserves missing/deleted results and propagates service errors', async () => {
  assert.equal(await worker.loadContent({ rpc: async () => ({ data: null, error: null }) }, 'merchant_review', 'gone'), null);
  await assert.rejects(worker.loadContent({ rpc: async () => ({ data: null, error: new Error('SERVICE_ROLE_REQUIRED') }) }, 'merchant_review', 'private'), /SERVICE_ROLE_REQUIRED/);
});

test('company replies use their own protected content RPC and are attributed to the replying actor', async () => {
  const reply = { authorId: 'actual-merchant-operator', text: '업체 답변\n답변 원문', body: '답변 원문', reviewId: 'customer-review' };
  const content = await worker.loadContent({ rpc: async (name, args) => {
    assert.equal(name, 'get_merchant_review_reply_safety_content');
    assert.deepEqual(JSON.parse(JSON.stringify(args)), { p_target_id: 'customer-review' });
    return { data: reply };
  } }, 'merchant_review_reply', 'customer-review');
  assert.equal(content.authorId, 'actual-merchant-operator');
  assert.equal(content.text, reply.text);
  await assert.rejects(worker.loadContent({ rpc: async () => ({ error: new Error('SERVICE_ROLE_REQUIRED') }) }, 'merchant_review_reply', 'private'), /SERVICE_ROLE_REQUIRED/);
});
