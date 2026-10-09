import assert from 'node:assert/strict';
import test from 'node:test';
import { publicWebTarget, publicWebFetch, publicMerchantId } from '../src/lib/public-web.ts';

const id = '12345678-1234-1234-1234-123456789abc';
test('only public post identifiers survive web to app handoff', () => {
  assert.equal(publicWebTarget('/post', id), `gling://post/${id}`);
  assert.equal(publicWebTarget(`/post/${id}`), `gling://post/${id}`);
  assert.equal(publicWebTarget('/chat', 'secret'), 'gling://chat');
  assert.equal(publicWebTarget('/profile/settings'), 'gling://');
  assert.equal(publicWebTarget('/post', 'https://evil.example'), 'gling://');
  assert.equal(publicWebTarget('/meetup-create'), 'gling://meetup-create');
});
test('public transport rejects writes and always uses anonymous credentials', async () => {
  const requests = [];
  const request = publicWebFetch('https://example.supabase.co', 'public-key', async (url, init) => {
    requests.push({ url, init }); return new Response('{}');
  });
  await request('https://example.supabase.co/rest/v1/rpc/get_public_post', {
    method: 'POST', headers: { Authorization: 'Bearer stored-user-token' }, body: '{}',
  });
  assert.equal(new Headers(requests[0].init.headers).get('Authorization'), 'Bearer public-key');
  await request('https://example.supabase.co/rest/v1/rpc/get_merchant_post_source', { method: 'POST', body: '{}' });
  await assert.rejects(() => request('https://example.supabase.co/rest/v1/rpc/record_merchant_source_click', { method: 'POST' }));
  await assert.rejects(() => request('https://example.supabase.co/rest/v1/rpc/send_message', { method: 'POST' }));
  await assert.rejects(() => request('https://example.supabase.co/auth/v1/token', { method: 'POST' }));
  await assert.rejects(() => request('https://other.example/rest/v1/rpc/get_public_post', { method: 'POST' }));
  assert.equal(requests.length, 2);
});

test('company query and path routes accept only a canonical UUID and hand off to the company screen', () => {
  assert.equal(publicMerchantId('/company', id), id);
  assert.equal(publicMerchantId('/company', id.toUpperCase()), id);
  assert.equal(publicMerchantId(`/company/${id}`), id);
  assert.equal(publicMerchantId('/company', 'https://evil.test'), null);
  assert.equal(publicMerchantId('/company', [id]), null);
  assert.equal(publicMerchantId('/profile', id), null);
  assert.equal(publicMerchantId(`/company/${id}/private`), null);
  assert.equal(publicWebTarget('/company', id), `gling://company/${id}`);
  assert.equal(publicWebTarget(`/company/${id}`), `gling://company/${id}`);
  assert.equal(publicWebTarget('/company', 'bad'), 'gling://');
});

test('company profile transport permits anonymous public getters and only saved profile image signing', async () => {
  const calls = [];
  const request = publicWebFetch('https://example.supabase.co', 'public-key', async (url, init) => { calls.push({ url, init }); return new Response('{}'); });
  for (const path of ['/rest/v1/rpc/get_merchant_profile', '/rest/v1/rpc/get_merchant_reviews', '/rest/v1/rpc/get_merchant_profile_posts', '/storage/v1/object/sign/merchant-profile-images']) {
    await request(`https://example.supabase.co${path}`, { method: 'POST', headers: { Authorization: 'Bearer private-user' }, body: '{}' });
  }
  for (const path of ['/rest/v1/rpc/get_my_merchant_profile', '/rest/v1/rpc/save_my_merchant_profile', '/rest/v1/rpc/get_my_merchant_reviews', '/rest/v1/rpc/write_merchant_review', '/rest/v1/rpc/get_admin_merchant_review_content', '/rest/v1/rpc/get_admin_merchant_receipt_reviews', '/rest/v1/rpc/set_admin_merchant_review_receipt', '/storage/v1/object/sign/merchant-review-receipts', '/storage/v1/object/merchant-profile-images']) {
    await assert.rejects(request(`https://example.supabase.co${path}`, { method: 'POST', body: '{}' }), /PUBLIC_WEB_READ_ONLY/);
  }
  await assert.rejects(request('https://example.supabase.co/rest/v1/rpc/get_merchant_profile', { method: 'GET' }), /PUBLIC_WEB_READ_ONLY/);
  await assert.rejects(request('https://other.example/rest/v1/rpc/get_merchant_profile', { method: 'POST' }), /PUBLIC_WEB_READ_ONLY/);
  await assert.rejects(request('https://example.supabase.co/rest/v1/rpc/get_merchant_profile_posts', { method: 'GET' }), /PUBLIC_WEB_READ_ONLY/);
  await assert.rejects(request('https://example.supabase.co/rest/v1/rpc/get_merchant_profile_posts_private', { method: 'POST' }), /PUBLIC_WEB_READ_ONLY/);
  await assert.rejects(request('https://other.example/rest/v1/rpc/get_merchant_profile_posts', { method: 'POST' }), /PUBLIC_WEB_READ_ONLY/);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(({ init }) => new Headers(init.headers).get('Authorization') === 'Bearer public-key' && init.credentials === 'omit'));
});
