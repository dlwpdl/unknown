import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

const publicApi = await import('../src/lib/merchant-profile.ts').catch(() => ({}));
const editorApi = await import('../src/lib/merchant-profile-editor.ts').catch(() => ({}));
const user = '13400000-0000-4000-8000-000000000001';
const merchant = '13410000-0000-4000-8000-000000000001';
const asset = `${user}/${merchant}_13420000-0000-4000-8000-000000000001.webp`;
const profile = { id: merchant, name: '동네 가게', city_id: 'vancouver', city_name: '밴쿠버', industry: '카페', services: '커피와 작은 식사', address: '123 Main St', avatar_path: asset, banner_path: null, review_post_id: 'post' };
const ownProfile = { ...profile, updated_at: '2026-10-08T18:00:00Z', can_edit: true };
function client(result = profile, signs = [{ path: asset, signedUrl: 'https://example.test/logo.webp' }]) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push([name, args]); return { data: result, error: null }; },
    storage: { from: bucket => ({ createSignedUrls: async (paths, duration) => { calls.push(['sign', bucket, paths, duration]); return { data: signs, error: null }; } }) } };
}

test('public company profile uses only the public getter and signs only saved profile images', async () => {
  assert.equal(typeof publicApi.loadMerchantProfile, 'function');
  const db = client();
  const loaded = await publicApi.loadMerchantProfile(db, merchant);
  assert.equal(loaded.avatarUri, 'https://example.test/logo.webp');
  assert.equal(loaded.bannerUri, null);
  assert.equal(loaded.imageLoadFailed, false);
  assert.deepEqual(db.calls, [['get_merchant_profile', { p_merchant_id: merchant }], ['sign', 'merchant-profile-images', [asset], 3600]]);
  const missing = client(null);
  assert.equal(await publicApi.loadMerchantProfile(missing, merchant), null);
  assert.equal(missing.calls.length, 1);
});

test('public profile normalizes only safe registered source links and tolerates older RPCs', async () => {
  const loaded = await publicApi.loadMerchantProfile(client({ ...profile, source_urls: [
    'https://www.instagram.com/real_shop/', 'https://shop.example.com/#about', 'https://shop.example.com/',
    'javascript:alert(1)', 'https://shop.local/', 'https://instagram.com.evil.test/real_shop/', null,
  ] }), merchant);
  assert.deepEqual(loaded.links, [
    { url: 'https://www.instagram.com/real_shop/', label: 'Instagram' },
    { url: 'https://shop.example.com/', label: 'shop.example.com' },
  ]);
  assert.deepEqual((await publicApi.loadMerchantProfile(client(), merchant)).links, []);
});

test('profile image failures preserve saved paths and company information for retry', async () => {
  assert.equal(typeof publicApi.attachMerchantProfileImages, 'function');
  const db = client(profile, []);
  const loaded = await publicApi.attachMerchantProfileImages(db, profile);
  assert.equal(loaded.avatar_path, asset);
  assert.equal(loaded.avatarUri, null);
  assert.equal(loaded.name, profile.name);
  assert.equal(loaded.imageLoadFailed, true);
  const failed = { storage: { from: () => ({ createSignedUrls: async () => { throw new Error('offline'); } }) } };
  assert.equal((await publicApi.attachMerchantProfileImages(failed, profile)).imageLoadFailed, true);
});

test('wrong-company or rejected profile reads fail instead of becoming an editable empty profile', async () => {
  assert.equal(typeof publicApi.loadMerchantProfile, 'function');
  await assert.rejects(publicApi.loadMerchantProfile(client({ ...profile, id: 'other' }), merchant), /MERCHANT_PROFILE_READ_FAILED/);
  await assert.rejects(publicApi.loadMerchantProfile({ rpc: async () => ({ error: { message: 'offline' } }) }, merchant), /offline/);
  assert.equal(typeof editorApi.loadMyMerchantProfile, 'function');
  const db = client(ownProfile);
  assert.equal((await editorApi.loadMyMerchantProfile(db, merchant)).can_edit, true);
  assert.equal(db.calls[0][0], 'get_my_merchant_profile');
  await assert.rejects(editorApi.loadMyMerchantProfile(client(null), merchant), /MERCHANT_PROFILE_READ_FAILED/);
});

test('owner photo changes carry server revision and only a matching server readback confirms saving', async () => {
  assert.equal(typeof editorApi.saveMyMerchantProfile, 'function');
  const patch = { avatarPath: null, bannerPath: asset, updatedAt: ownProfile.updated_at };
  const db = client({ ...ownProfile, avatar_path: null, banner_path: asset, updated_at: '2026-10-08T18:01:00Z' });
  const saved = await editorApi.saveMyMerchantProfile(db, merchant, patch);
  assert.equal(saved.banner_path, asset);
  assert.deepEqual(db.calls[0], ['save_my_merchant_profile', { p_merchant_id: merchant, p_avatar_path: null, p_banner_path: asset, p_expected_updated_at: patch.updatedAt }]);
  for (const result of [null, merchant, { ...ownProfile }, { ...ownProfile, id: 'other', avatar_path: null, banner_path: asset }]) {
    await assert.rejects(editorApi.saveMyMerchantProfile(client(result), merchant, patch), /MERCHANT_PROFILE_SAVE_NOT_VERIFIED/);
  }
  await assert.rejects(editorApi.saveMyMerchantProfile({ rpc: async () => ({ error: { message: 'MERCHANT_PROFILE_CHANGED' } }) }, merchant, patch), /MERCHANT_PROFILE_CHANGED/);
});

test('profile uploads use immutable merchant-scoped WebP objects with a 2MiB bound', async () => {
  assert.equal(typeof editorApi.uploadMerchantProfileImage, 'function');
  const calls = [];
  const db = { storage: { from: bucket => ({ upload: async (path, bytes, options) => { calls.push({ bucket, path, bytes: [...new Uint8Array(bytes)], options }); return { error: null }; } }) } };
  const path = await editorApi.uploadMerchantProfileImage(db, user, merchant, { base64: 'AQI=', mimeType: 'image/webp' });
  assert.match(path, new RegExp(`^${user}/${merchant}_[0-9a-f-]{36}\\.webp$`));
  assert.deepEqual(calls[0], { bucket: 'merchant-profile-images', path, bytes: [1, 2], options: { contentType: 'image/webp', upsert: false } });
  await assert.rejects(editorApi.uploadMerchantProfileImage(db, user, merchant, { base64: 'AQI=', mimeType: 'image/svg+xml' }), /IMAGE_UNSUPPORTED/);
  await assert.rejects(editorApi.uploadMerchantProfileImage(db, user, merchant, { base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'), mimeType: 'image/webp' }), /IMAGE_TOO_LARGE/);
  assert.equal(calls.length, 1);
});
