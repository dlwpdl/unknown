import assert from 'node:assert/strict';
import test from 'node:test';
import { publicWebTarget, publicWebFetch } from '../src/lib/public-web.ts';

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
  await assert.rejects(() => request('https://example.supabase.co/rest/v1/rpc/send_message', { method: 'POST' }));
  await assert.rejects(() => request('https://example.supabase.co/auth/v1/token', { method: 'POST' }));
  await assert.rejects(() => request('https://other.example/rest/v1/rpc/get_public_post', { method: 'POST' }));
  assert.equal(requests.length, 1);
});
