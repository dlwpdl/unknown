import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadMeetupProfilePhoto, loadMeetupProfilePhoto, removeUnsavedMeetupPhotos } from '../src/lib/chilling-profile-media.ts';

const user = '00000000-0000-4000-8000-000000000001';
const photo = { base64: btoa('RIFF\x08\x00\x00\x00WEBPimage'), mimeType: 'image/webp' };

test('meetup photos use immutable private objects and never touch the public avatar', async () => {
  const calls = [];
  const client = { storage: { from: bucket => ({ upload: async (path, bytes, options) => { calls.push({ bucket, path, bytes, options }); return { error: null }; } }) } };
  const first = await uploadMeetupProfilePhoto(client, user, photo);
  const second = await uploadMeetupProfilePhoto(client, user, photo);
  assert.notEqual(first, second);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.bucket === 'meetup-profiles' && call.path.startsWith(`${user}/`) && call.path.endsWith('.webp') && call.options.upsert === false));
  assert.ok(calls.every(call => call.options.cacheControl === '0'));
  assert.equal(calls[0].bytes.byteLength, atob(photo.base64).length);
});

test('authorized photo bytes stay in memory and every repeat read is reauthorized', async context => {
  const previous = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsDataURL() { this.result = `data:image/webp;base64,${photo.base64}`; this.onload(); }
  };
  context.after(() => { if (previous) globalThis.FileReader = previous; else delete globalThis.FileReader; });
  let reads = 0;
  const client = { storage: { from: () => ({ download: async () => { reads++; return { data: new Blob(['RIFFbytes'], { type: 'image/webp' }), error: null }; } }) } };
  for (let i = 0; i < 2; i++) assert.equal(await loadMeetupProfilePhoto(client, `${user}/one.webp`), `data:image/webp;base64,${photo.base64}`);
  assert.equal(reads, 2);
});

test('invalid media is rejected before upload, including content mismatch and traversal', async () => {
  const client = { storage: { from() { throw new Error('must not upload'); } } };
  for (const [id, asset] of [[`${user}/../another`, photo], [user, { ...photo, base64: 'bad' }], [user, { ...photo, mimeType: 'image/svg+xml' }], [user, { ...photo, base64: btoa('<script>') }], [user, { ...photo, base64: 'A'.repeat(3 * 1024 * 1024) }]]) {
    await assert.rejects(uploadMeetupProfilePhoto(client, id, asset), /INVALID_MEETUP_PHOTO|IMAGE_TOO_LARGE|UNSUPPORTED_IMAGE_TYPE/);
  }
});

test('even the smallest random value produces a path accepted by the server filename contract', async context => {
  context.mock.method(Math, 'random', () => 0);
  const client = { storage: { from: () => ({ upload: async () => ({ error: null }) }) } };
  const path = await uploadMeetupProfilePhoto(client, user, photo);
  assert.match(path, /\/[0-9]{10,16}-[a-f0-9]{8,64}\.webp$/);
});

test('each photo read is an authorized download; denial never yields a bearer URL', async () => {
  let reads = 0;
  const failure = new Error('denied');
  const client = { storage: { from: bucket => { assert.equal(bucket, 'meetup-profiles'); return { download: async path => { reads++; assert.equal(path, `${user}/photo.webp`); return { data: null, error: failure }; }, createSignedUrl() { assert.fail('bearer URLs are forbidden'); } }; } } };
  await assert.rejects(loadMeetupProfilePhoto(client, `${user}/photo.webp`), /denied/);
  await assert.rejects(loadMeetupProfilePhoto(client, `${user}/photo.webp`), /denied/);
  assert.equal(reads, 2);
  await assert.rejects(loadMeetupProfilePhoto(client, `${user}/../private.webp`), /INVALID_MEETUP_PHOTO/);
  assert.equal(reads, 2);
});

test('failed save cleanup removes only the just-uploaded objects, never saved snapshot paths', async () => {
  const calls = [];
  const client = { storage: { from: bucket => ({ remove: async paths => { calls.push([bucket, paths]); return { error: null }; } }) } };
  await removeUnsavedMeetupPhotos(client, [`${user}/new.webp`, `${user}/new.webp`]);
  assert.deepEqual(calls, [['meetup-profiles', [`${user}/new.webp`]]]);
  await removeUnsavedMeetupPhotos(client, []);
  assert.equal(calls.length, 1);
});
