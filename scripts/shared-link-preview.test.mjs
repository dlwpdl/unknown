import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const id = 'c8f9cd5e-b0a8-46e3-a9d5-462f0c3a24b8';
const other = '70000000-0000-4000-8000-000000000001';
const origin = 'https://project.supabase.co/functions/v1/public-post';
const expected = `${origin}?format=preview-image&id=${id}`;
function setup(result) {
  const calls = [], mapped = [];
  const modules = {
    './public-seo.ts': { PUBLIC_SOURCE: origin },
    './feed-data.ts': { mapPublicFeed(rows, comments) {
      mapped.push({ rows, comments });
      return rows.map(row => ({ id: row.id, title: row.title, body: row.body, room: row.room_preview ?? undefined,
        imagePaths: row.image_paths, author: { id: row.author_id }, commentList: comments }));
    } },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/shared-link-preview.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, URLSearchParams, require: name => {
    assert.ok(name in modules, `Known read-only dependency: ${name}`); return modules[name];
  } });
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return result; },
    get storage() { throw Error('Shared reads must not sign arbitrary private storage objects'); } };
  return { ...exports, client, calls, mapped };
}

test('personal and opaque business covers use the id-only first-preview endpoint without Storage signing', async () => {
  for (const imagePath of ['PRIVATE_ACTOR/first.webp', `business-post/${id}/0/${'a'.repeat(32)}`]) {
    const api = setup({ data: { id, title: 'Public title', imagePath }, error: null });
    const value = await api.loadSharedLinkPreview(api.client, id);
    assert.equal(value.imageUrl, expected);
    assert.equal(value.imageUrl.includes('PRIVATE_ACTOR'), false);
    assert.deepEqual(api.calls.map(call => call.name), ['get_shared_link_preview']);
    assert.equal(api.calls[0].args.p_post_id, id);
  }
});

test('missing preview or cover never invents an image or reads another attachment', async () => {
  for (const data of [null, { id, title: 'No cover', imagePath: null }]) {
    const api = setup({ data, error: null });
    const result = await api.loadSharedLinkPreview(api.client, id);
    assert.equal(result?.imageUrl, undefined); assert.equal(api.calls.length, 1);
  }
});

test('preview errors and mismatched identities do not become image handoffs', async () => {
  const failed = setup({ data: null, error: Error('READ_FAILED') });
  await assert.rejects(failed.loadSharedLinkPreview(failed.client, id), /READ_FAILED/);
  const wrong = setup({ data: { id: other, imagePath: 'PRIVATE/cover.webp' }, error: null });
  await assert.rejects(wrong.loadSharedLinkPreview(wrong.client, id), /SHARED_POST/);
});

test('authenticated read-only article reads one exact post, no comments and only its first photo', async () => {
  const row = { id, title: 'Article', body: 'Authorized public body', room_preview: null,
    author_id: 'PUBLIC_AUTHOR', image_paths: ['first.webp', 'second-private.webp', 'third-private.webp'] };
  const api = setup({ data: [row], error: null });
  const post = await api.loadSharedLinkPost(api.client, id);
  assert.deepEqual(api.calls.map(call => call.name), ['get_public_post']);
  assert.equal(api.calls[0].args.p_post_id, id);
  assert.equal(post.body, row.body);
  assert.equal(post.imagePaths.length, 1); assert.equal(post.imagePaths[0], row.image_paths[0]);
  assert.equal(post.imageUris.length, 1); assert.equal(post.imageUris[0], expected);
  assert.equal(post.commentList.length, 0); assert.equal(api.mapped[0].comments.length, 0);
});

test('meetup projection omits raw body and private host/application fields before article mapping', async () => {
  const row = { id, title: 'Meetup', body: 'PRIVATE_DESTINATION_AND_CONTACT', image_paths: [],
    room_preview: { id: 'room', title: 'Meetup', memberCount: 3, verifiedOnly: true,
      startsAt: '2026-11-01T19:00:00Z', hostDisplayName: 'PRIVATE_HOST', applicationQuestion: 'PRIVATE_QUESTION', secret: 'PRIVATE_OTHER' } };
  const api = setup({ data: [row], error: null });
  const post = await api.loadSharedLinkPost(api.client, id);
  assert.equal(post.body, '');
  assert.equal(post.room.memberCount, 3); assert.equal(post.room.startsAt, row.room_preview.startsAt);
  assert.equal(JSON.stringify(api.mapped).includes('PRIVATE_'), false);
  assert.equal(post.imageUris.length, 0);
});

test('removed, mismatched and invalid post reads fail safely before presentation', async () => {
  const empty = setup({ data: [], error: null });
  assert.equal(await empty.loadSharedLinkPost(empty.client, id), null);
  for (const data of [{}, [null], [{ id: other }], [{ id }, { id: other }]]) {
    const api = setup({ data, error: null });
    await assert.rejects(api.loadSharedLinkPost(api.client, id), /SHARED_POST/);
    assert.equal(api.mapped.length, 0);
  }
  const invalid = setup({ data: [], error: null });
  await assert.rejects(invalid.loadSharedLinkPost(invalid.client, '../private'), /SHARED_POST/);
  assert.equal(invalid.calls.length, 0);
});
