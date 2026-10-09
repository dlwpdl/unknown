import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

const { loadMerchantReviews, loadMyMerchantReviews, writeMerchantReview, uploadMerchantReviewReceipt } = await import('../src/lib/merchant-reviews.ts').catch(() => ({}));
const reviewId = '13100000-0000-0000-0000-000000000001';

test('every half-point score from 1 to 10 saves through the post relationship with no client-supplied author', async () => {
  assert.equal(typeof writeMerchantReview, 'function');
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: reviewId, error: null }; } };
  for (const score of [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]) {
    assert.equal(await writeMerchantReview(client, 'post', score, '  편하게 이용했어요.  '), reviewId);
    assert.deepEqual(calls.at(-1), ['write_merchant_review', { p_post_id: 'post', p_score: score, p_body: '편하게 이용했어요.' }]);
  }
  await writeMerchantReview(client, 'post', 6.5, '   ');
  assert.equal(calls.at(-1)[1].p_body, null);
});

test('invalid scores and oversized text cannot send a review RPC or round into an accepted value', async () => {
  assert.equal(typeof writeMerchantReview, 'function');
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: reviewId, error: null }; } };
  for (const score of [0, 0.5, 10.5, 1.25, 9.999, NaN, Infinity, -Infinity, null, '8']) {
    await assert.rejects(writeMerchantReview(client, 'post', score, ''), /INVALID_MERCHANT_SCORE/);
  }
  await assert.rejects(writeMerchantReview(client, 'post', 8, '가'.repeat(301)), /MERCHANT_REVIEW_TOO_LONG/);
  assert.equal(calls, 0);
});

test('only a server review id confirms saving; rejected or uncertain saves remain failures', async () => {
  assert.equal(typeof writeMerchantReview, 'function');
  for (const result of [{ data: null, error: null }, { data: {}, error: null }, { data: '', error: null }, { data: 'not-a-review-id', error: null }]) {
    await assert.rejects(writeMerchantReview({ rpc: async () => result }, 'post', 7.5, ''), /MERCHANT_REVIEW_SAVE_NOT_VERIFIED/);
  }
  await assert.rejects(writeMerchantReview({ rpc: async () => ({ data: null, error: { message: 'MERCHANT_REVIEW_REMOVED' } }) }, 'post', 7.5, ''), /MERCHANT_REVIEW_REMOVED/);
  await assert.rejects(writeMerchantReview({ rpc: async () => { throw new Error('offline'); } }, 'post', 7.5, ''), /offline/);
});

test('review pages keep canonical totals and own review supplied by the server; read errors are not empty reviews', async () => {
  assert.equal(typeof loadMerchantReviews, 'function');
  const page = { merchant_name: '시안 가게', rating_average: 8.25, review_count: 2, my_review: null, can_review: true, reviews: [], has_more: false };
  let actual;
  const client = { rpc: async (name, args) => { actual = [name, args]; return { data: page, error: null }; } };
  assert.deepEqual(await loadMerchantReviews(client, 'second-post', 20), page);
  assert.deepEqual(actual, ['get_merchant_reviews', { p_post_id: 'second-post', p_offset: 20 }]);
  assert.equal(await loadMerchantReviews({ rpc: async () => ({ data: null, error: null }) }, 'hidden-post'), null);
  await assert.rejects(loadMerchantReviews({ rpc: async () => ({ data: null, error: { message: 'offline' } }) }, 'post'), /offline/);
});

test('receipt changes are explicit; omission retains a receipt and no client may assign verified status', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: reviewId, error: null }; } };
  await writeMerchantReview(client, 'post', 8, '선택 후기글', 'account/receipt.webp');
  assert.deepEqual(calls.at(-1), ['write_merchant_review', { p_post_id: 'post', p_score: 8, p_body: '선택 후기글', p_receipt_path: 'account/receipt.webp' }]);
  await writeMerchantReview(client, 'post', 8, '', '');
  assert.equal(calls.at(-1)[1].p_receipt_path, '');
  await writeMerchantReview(client, 'post', 8, '');
  assert.equal('p_receipt_path' in calls.at(-1)[1], false);
});

test('receipt uploads use private immutable objects and refuse unsupported or oversized content', async () => {
  assert.equal(typeof uploadMerchantReviewReceipt, 'function');
  const uploads = [];
  const client = { storage: { from: bucket => ({ upload: async (path, bytes, options) => { uploads.push({ bucket, path, bytes: [...new Uint8Array(bytes)], options }); return { error: null }; } }) } };
  const owner = '13100000-0000-0000-0000-000000000002';
  const path = await uploadMerchantReviewReceipt(client, owner, { base64: 'AQI=', mimeType: 'image/webp' });
  assert.match(path, /^13100000-0000-0000-0000-000000000002\/[0-9a-f-]{36}\.webp$/);
  assert.deepEqual(uploads[0], { bucket: 'merchant-review-receipts', path, bytes: [1, 2], options: { contentType: 'image/webp', upsert: false } });
  await assert.rejects(uploadMerchantReviewReceipt(client, owner, { base64: 'AQI=', mimeType: 'image/svg+xml' }), /IMAGE_UNSUPPORTED/);
  await assert.rejects(uploadMerchantReviewReceipt(client, owner, { base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'), mimeType: 'image/webp' }), /IMAGE_TOO_LARGE/);
  assert.equal(uploads.length, 1);
  await assert.rejects(uploadMerchantReviewReceipt({ storage: { from: () => ({ upload: async () => ({ error: { message: 'offline' } }) }) } }, owner, { base64: 'AQI=', mimeType: 'image/webp' }), /offline/);
});

test('merchant-private feedback is loaded through the owner-authorized API, never a public query', async () => {
  assert.equal(typeof loadMyMerchantReviews, 'function');
  const inbox = { reviews: [{ id: reviewId, receipt_status: 'none', body: '업체에만 보낼 의견' }], has_more: false };
  let actual;
  const client = { rpc: async (name, args) => { actual = [name, args]; return { data: inbox, error: null }; } };
  assert.deepEqual(await loadMyMerchantReviews(client, 'merchant', 20), inbox);
  assert.deepEqual(actual, ['get_my_merchant_reviews', { p_merchant_id: 'merchant', p_offset: 20 }]);
  await assert.rejects(loadMyMerchantReviews({ rpc: async () => ({ data: null, error: { message: 'MERCHANT_OWNER_REQUIRED' } }) }, 'other-merchant'), /MERCHANT_OWNER_REQUIRED/);
});

test('employment pages and writes select their own review kind without changing legacy usage calls', async () => {
  const calls = [];
  const page = { review_kind: 'employment', reviews: [], rating_average: 8.833333333, review_count: 3 };
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: name === 'get_merchant_reviews' ? page : reviewId, error: null }; } };
  assert.deepEqual(await loadMerchantReviews(client, 'job-post', 20, 'employment'), page);
  assert.deepEqual(calls.at(-1), ['get_merchant_reviews', { p_post_id: 'job-post', p_offset: 20, p_review_kind: 'employment' }]);
  await writeMerchantReview(client, 'job-post', 9.5, '근무 경험', 'account/proof.webp', 'employment');
  assert.deepEqual(calls.at(-1), ['write_merchant_review', { p_post_id: 'job-post', p_score: 9.5, p_body: '근무 경험', p_receipt_path: 'account/proof.webp', p_review_kind: 'employment' }]);
  await writeMerchantReview(client, 'job-post', 7, '', undefined, 'employment');
  assert.equal(calls.at(-1)[1].p_receipt_path, null);
  assert.equal('receipt_status' in calls.at(-1)[1], false);
});

test('unknown kinds and mismatched employment responses cannot reveal another domain or send a write', async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: { review_kind: 'usage' }, error: null }; } };
  await assert.rejects(loadMerchantReviews(client, 'post', 0, 'other'), /INVALID_REVIEW_KIND/);
  await assert.rejects(writeMerchantReview(client, 'post', 8, '', '', 'other'), /INVALID_REVIEW_KIND/);
  assert.equal(calls, 0);
  await assert.rejects(loadMerchantReviews(client, 'post', 0, 'employment'), /MERCHANT_REVIEW_KIND_MISMATCH/);
});
