import assert from 'node:assert/strict';
import test from 'node:test';
import { servePreviewImage } from '../supabase/functions/_shared/preview-image.ts';

const id = 'e23c0000-0000-4000-8000-000000000001', other = 'e23c0000-0000-4000-8000-000000000002';
const path = 'PRIVATE-UPLOADER/first.webp', version = 'a'.repeat(32);
const url = `https://project.supabase.co/functions/v1/public-post?format=preview-image&id=${id}`;
function fixture({ preview = { id, imagePath: path }, previewError = null, media = { bucket: 'post-images', path, version }, mediaError = null, file = new Blob(['cover-bytes'], { type: 'image/webp' }), downloadError = null } = {}) {
  const calls = [];
  const anonymous = { rpc: async (name, args) => { calls.push(['anon', name, args]); return { data: preview, error: previewError }; } };
  const service = {
    auth: { getUser: async () => { throw Error('caller credentials must never be read'); } },
    rpc: async (name, args) => { calls.push(['service', name, args]); return { data: media, error: mediaError }; },
    storage: { from: bucket => ({ download: async object => { calls.push(['download', bucket, object]); return { data: file, error: downloadError }; } }) },
  };
  return { calls, serve: request => servePreviewImage(request, anonymous, service) };
}
function safeHeaders(response) {
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'GET, HEAD, OPTIONS');
  assert.equal(response.headers.get('Location'), null);
  assert.doesNotMatch(JSON.stringify([...response.headers]), /PRIVATE-|token=|storage\/|business-post/);
}

test('personal preview cover uses the anonymous getter then downloads exactly that first path as bytes', async () => {
  const h = fixture({ preview: { id, imagePath: path, imagePaths: ['PRIVATE-LATER/second.webp'], body: 'PRIVATE-BODY' } }), response = await h.serve(new Request(url, { headers: { Authorization: 'Bearer PRIVATE-SESSION', Cookie: 'PRIVATE-COOKIE=1' } }));
  assert.equal(response.status, 200); assert.equal(await response.text(), 'cover-bytes');
  assert.equal(response.headers.get('Content-Type'), 'image/webp'); safeHeaders(response);
  assert.deepEqual(h.calls, [['anon', 'get_shared_link_preview', { p_post_id: id }], ['download', 'post-images', path]]);
});
test('opaque business cover rechecks the existing current public media gate at anonymous index zero', async () => {
  const h = fixture({ preview: { id, imagePath: `business-post/${id}/0/${version}` } });
  const response = await h.serve(new Request(url, { headers: { Authorization: 'Bearer PRIVATE-SESSION' } }));
  assert.equal(response.status, 200); assert.equal(await response.text(), 'cover-bytes'); safeHeaders(response);
  assert.deepEqual(h.calls, [['anon', 'get_shared_link_preview', { p_post_id: id }],
    ['service', 'get_business_public_media', { p_id: id, p_kind: 'post', p_index: 0, p_viewer: null }], ['download', 'post-images', path]]);
});
test('methods and exact two-field query are bounded before any lookup or download', async () => {
  for (const query of [`format=preview-image`, `format=preview-image&id=bad`, `format=preview-image&id=${id}&id=${other}`,
    `format=preview-image&format=preview-image&id=${id}`, `format=other&id=${id}`, `format=preview-image&id=${id}&path=${path}`,
    `format=preview-image&id=${id}&bucket=post-images`, `format=preview-image&id=${id}&index=1`]) {
    const h = fixture(), response = await h.serve(new Request(url.split('?')[0] + '?' + query));
    assert.equal(response.status, 400, query); assert.deepEqual(h.calls, []); safeHeaders(response);
  }
  const h = fixture(); const denied = await h.serve(new Request(url, { method: 'POST' }));
  assert.equal(denied.status, 405); assert.equal(denied.headers.get('Allow'), 'GET, HEAD, OPTIONS');
  const options = await h.serve(new Request(url, { method: 'OPTIONS' })); assert.equal(options.status, 204); assert.deepEqual(h.calls, []);
});
test('HEAD has the same validated image headers and no bytes in its response', async () => {
  for (const imagePath of [path, `business-post/${id}/0/${version}`]) {
    const h = fixture({ preview: { id, imagePath } }), response = await h.serve(new Request(url, { method: 'HEAD' }));
    assert.equal(response.status, 200); assert.equal(await response.text(), ''); assert.equal(response.headers.get('Content-Type'), 'image/webp');
    assert.equal(h.calls.filter(call => call[0] === 'download').length, 1); safeHeaders(response);
  }
});
test('unavailable, mismatched, missing and unsafe covers never reach privileged media access', async () => {
  for (const preview of [null, [], { id: other, imagePath: path }, { id, imagePath: null }, { id },
    ...['../private.jpg', 'owner/../private.jpg', 'owner/%2e%2e/private.jpg', 'owner/private.jpg?token=PRIVATE', 'owner\\private.jpg',
      'https://evil.test/private.jpg', '/owner/private.jpg', 'owner/private.svg', 'owner/private.txt',
      `business-post/${other}/0/${version}`, `business-post/${id}/1/${version}`, `business-post/${id}/0/bad`,
      `business-profile/${id}/avatar/${version}`].map(imagePath => ({ id, imagePath }))]) {
    const h = fixture({ preview }), response = await h.serve(new Request(url));
    assert.equal(response.status, 404); assert.equal(await response.text(), '');
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0][0], 'anon'); safeHeaders(response);
  }
});

test('thrown anonymous and storage failures stay generic and never fall back to another image', async () => {
  for (const failAt of ['preview', 'download']) {
    const calls = [];
    const anonymous = { rpc: async () => { calls.push('preview'); if (failAt === 'preview') throw Error('PRIVATE-URL-TOKEN'); return { data: { id, imagePath: path }, error: null }; } };
    const service = { storage: { from: bucket => ({ download: async object => { calls.push([bucket, object]); throw Error('PRIVATE-URL-TOKEN'); } }) } };
    const response = await servePreviewImage(new Request(url), anonymous, service);
    assert.equal(response.status, 503); assert.equal(await response.text(), ''); safeHeaders(response);
    assert.equal(calls.length, failAt === 'preview' ? 1 : 2);
  }
});
test('revoked, paused or consent-withdrawn business media cannot be downloaded after the initial gate', async () => {
  for (const media of [null, { bucket: 'merchant-profile-images', path, version }, { bucket: 'post-images', path, version: 'b'.repeat(32) }]) {
    const h = fixture({ preview: { id, imagePath: `business-post/${id}/0/${version}` }, media }), response = await h.serve(new Request(url));
    assert.equal(response.status, 404); assert.equal(h.calls.some(call => call[0] === 'download'), false); assert.equal(await response.text(), '');
  }
});
test('only bounded JPEG, PNG and WebP bytes are returned; lookup and download errors contain no private details', async () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    const h = fixture({ file: new Blob(['image-bytes'], { type }) }), response = await h.serve(new Request(url));
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), type);
  }
  for (const file of [new Blob(['PRIVATE-HTML'], { type: 'text/html' }), new Blob(['PRIVATE-SVG'], { type: 'image/svg+xml' }),
    new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'image/jpeg' })]) {
    const h = fixture({ file }), response = await h.serve(new Request(url)); assert.equal(response.status, 404); assert.equal(await response.text(), ''); safeHeaders(response);
  }
  for (const options of [{ previewError: { message: path } }, { downloadError: { message: 'PRIVATE-KEY-TOKEN' } }, { file: null }]) {
    const h = fixture(options), response = await h.serve(new Request(url)); assert.ok([404, 503].includes(response.status));
    assert.equal(await response.text(), ''); safeHeaders(response);
    if (options.previewError) assert.equal(h.calls.length, 1);
  }
});
