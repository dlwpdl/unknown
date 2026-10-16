import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function app(error, posts = []) {
  const calls = [], exports = {}, signal = new AbortController().signal;
  const client = { rpc(name, args) { calls.push({ name, args }); return { abortSignal(value) { assert.equal(value, signal); return Promise.resolve({ data: null, error }); } }; } };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/discovery-data.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require(name) {
    if (name === './feed-data') return { loadPublicFeed: async (...args) => { calls.push(args); return posts; }, mapPublicFeed: value => value, attachSignedPostImages: async (_client, value) => value };
    if (name === './discovery') return { discoveryPost: post => post.hasPin ? { id: post.id } : null };
    throw Error(name);
  } });
  return { calls, run: (cursor = null) => exports.loadDiscoveryPosts(client, 'vancouver', 'used', ' table ', cursor, 'viewer-a', signal), client, signal };
}

test('missing map RPC reuses the authorized feed and advances the unfiltered page cursor', async () => {
  const posts = Array.from({ length: 30 }, (_, i) => ({ id: `post-${i}`, createdAt: '2026-10-15', sortAt: '2026-10-16', hasPin: i === 0 }));
  const view = app({ code: 'PGRST202' }, posts), cursor = { id: 'before', createdAt: '2026-10-14', sortAt: '2026-10-14' };
  const result = await view.run(cursor);
  assert.equal(view.calls[0].name, 'get_discovery_posts');
  assert.equal(view.calls[1][0], view.client);
  assert.deepEqual(Array.from(view.calls[1].slice(1, 5)), ['vancouver', 19, 'table', cursor]);
  assert.equal(view.calls[1][5].viewerScope, 'viewer-a');
  assert.equal(view.calls[1][5].signal, view.signal);
  assert.equal(result.items.length, 1);
  assert.equal(result.hasMore, true);
  assert.equal(result.cursor.id, 'post-29');
  assert.equal(result.cursor.sortAt, '2026-10-16');
});

test('empty compatibility pages finish; permission and network errors never trigger a fallback', async () => {
  const empty = await app({ code: 'PGRST202' }).run();
  assert.equal(empty.items.length, 0); assert.equal(empty.hasMore, false); assert.equal(empty.cursor, null);
  for (const error of [{ code: '42501' }, { code: 'NETWORK_ERROR' }, { code: 'PGRST301' }]) {
    const view = app(error);
    await assert.rejects(view.run(), value => value === error);
    assert.equal(view.calls.length, 1);
  }
});
