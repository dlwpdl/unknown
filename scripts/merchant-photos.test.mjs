import assert from 'node:assert/strict';
import test from 'node:test';
import { saveMerchantDraftImages } from '../src/lib/merchant-posts.ts';

test('an operator retains the saved draft photos uploaded by its owner', async () => {
  const t = clientFor();
  const saved = { ...draft, image_paths: ['owner/saved.webp'] };
  assert.deepEqual(await saveMerchantDraftImages(t.client, 'merchant', 'operator', saved, [{ path: 'owner/saved.webp' }]), saved.image_paths);
  await assert.rejects(saveMerchantDraftImages(t.client, 'merchant', 'operator', saved, [{ path: 'owner/other.webp' }]), /INVALID_IMAGE_PATH/);
});

const draft = { id: 'draft', channel: 'gling', title: '사진 안내', body: '확인한 안내', original_url: null, tag_slug: 'life', kind: 'story' };
function clientFor(outcome = { data: 'draft', error: null }) {
  const uploaded = [], removed = [], calls = [];
  return { uploaded, removed, calls, client: {
    storage: { from: () => ({ upload: async path => { uploaded.push(path); return { error: null }; }, remove: async paths => { removed.push(...paths); return { error: null }; } }) },
    rpc: async (name, args) => { calls.push({ name, args }); return outcome; },
  } };
}
test('draft photos preserve retained objects, append only new uploads and save their exact order', async () => {
  const t = clientFor();
  const paths = await saveMerchantDraftImages(t.client, 'merchant', 'owner', draft, [{ path: 'owner/second.webp' }, { base64: 'AQ==', mimeType: 'image/webp' }, { path: 'owner/first.webp' }]);
  assert.deepEqual(paths, ['owner/second.webp', t.uploaded[0], 'owner/first.webp']);
  assert.equal(t.uploaded.length, 1);
  assert.deepEqual(t.calls[0].args.p_image_paths, paths);
  assert.equal(t.calls[0].args.p_merchant_id, 'merchant');
  assert.deepEqual(t.removed, []);
  assert.deepEqual(await saveMerchantDraftImages(t.client, 'merchant', 'owner', draft, []), []);
  assert.deepEqual(t.calls.at(-1).args.p_image_paths, []);
});
test('draft photo validation rejects other accounts and more than ten before uploading', async () => {
  const t = clientFor();
  for (const path of ['other/photo.webp', 'owner/../photo.webp', 'owner/nested/photo.webp']) await assert.rejects(saveMerchantDraftImages(t.client, 'merchant', 'owner', draft, [{ path }]), /INVALID_IMAGE_PATH/);
  await assert.rejects(saveMerchantDraftImages(t.client, 'merchant', 'owner', draft, Array(11).fill({ base64: 'AQ==', mimeType: 'image/webp' })), /TOO_MANY_IMAGES/);
  assert.deepEqual(t.uploaded, []);
  assert.deepEqual(t.calls, []);
});
test('merchant drafts save ten photos in order with existing ownership validation', async () => {
  const t = clientFor();
  const images = Array.from({ length: 10 }, (_, i) => ({ path: `owner/${i}.webp` }));
  const paths = await saveMerchantDraftImages(t.client, 'merchant', 'owner', draft, images);
  assert.deepEqual(paths, images.map(image => image.path));
  assert.deepEqual(t.calls[0].args.p_image_paths, paths);
  assert.deepEqual(t.uploaded, []);
});
test('definite draft rejection removes only new uploads; uncertain saves retain possibly referenced photos', async () => {
  const rejected = clientFor({ data: null, error: { code: 'P0001', message: 'MERCHANT_DRAFT_CHANGED' } });
  const images = [{ path: 'owner/existing.webp' }, { base64: 'AQ==', mimeType: 'image/webp' }];
  await assert.rejects(saveMerchantDraftImages(rejected.client, 'merchant', 'owner', draft, images), /MERCHANT_DRAFT_CHANGED/);
  assert.ok(rejected.removed.includes(rejected.uploaded[0]));
  assert.ok(!rejected.removed.includes('owner/existing.webp'));
  const uncertain = clientFor({ data: null, error: { message: 'Failed to fetch' } });
  await assert.rejects(saveMerchantDraftImages(uncertain.client, 'merchant', 'owner', draft, images), /Failed to fetch/);
  assert.deepEqual(uncertain.removed, []);
  const wrongReceipt = clientFor({ data: 'wrong-id', error: null });
  await assert.rejects(saveMerchantDraftImages(wrongReceipt.client, 'merchant', 'owner', draft, images), /MERCHANT_DRAFT_SAVE_NOT_VERIFIED/);
  assert.deepEqual(wrongReceipt.removed, []);
});
