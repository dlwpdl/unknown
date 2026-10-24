import assert from 'node:assert/strict';
import test from 'node:test';
import { SHARED_POST_RETURN_KEY } from '../src/lib/sharing.ts';
import { rememberSharedPostReturn, readSharedPostReturn, clearSharedPostReturn } from '../src/lib/shared-post-return.ts';

const id = 'e23b0000-0000-4000-8000-000000000001';
const other = 'e23b0000-0000-4000-8000-000000000002';
const path = `/post?id=${id}&invite=1`, next = `/post?id=${other}`;
const native = `/post/${id}?invite=1`, nativeNext = `/post/${other}`;
const key = SHARED_POST_RETURN_KEY + '.native';
const now = 1_792_788_000_000, day = 24 * 60 * 60 * 1000;
function storage() {
  const values = new Map(), calls = [];
  return { values, calls,
    async getItem(key) { calls.push(['get', key]); return values.get(key) ?? null; },
    async setItem(key, value) { calls.push(['set', key]); values.set(key, value); },
    async removeItem(key) { calls.push(['remove', key]); values.delete(key); },
  };
}

test('native return stores only canonical path/time and survives a cold module reload', async t => {
  t.mock.method(Date, 'now', () => now);
  const store = storage();
  await rememberSharedPostReturn(store, path);
  const record = JSON.parse(store.values.get(key));
  assert.deepEqual(record, { path, savedAt: now });
  assert.deepEqual([...store.values.keys()], [key]);
  assert.equal(await readSharedPostReturn(store), native);
  assert.equal(await readSharedPostReturn(store), native, 'read does not consume the intent');
  const reloaded = await import('../src/lib/shared-post-return.ts?reload=shared-post-test');
  assert.equal(await reloaded.readSharedPostReturn(store), native);
  await reloaded.clearSharedPostReturn(store, path);
  assert.equal(await reloaded.readSharedPostReturn(store), null);
});

test('remember rejects external, native, duplicate-id and malformed paths without losing a valid intent', async t => {
  t.mock.method(Date, 'now', () => now);
  const store = storage();
  await rememberSharedPostReturn(store, path);
  for (const invalid of ['/', `/post/${id}`, 'not a path', `/post?id=invalid`, `/post?id=${id}&id=${other}`, `https://evil.test/post?id=${id}`, `https://gling.ej-entertainment.com/post?id=${id}`, `//evil.test/post?id=${id}`]) {
    await assert.rejects(rememberSharedPostReturn(store, invalid), /INVALID_SHARED_POST_RETURN/);
    assert.equal(await readSharedPostReturn(store), native);
  }
  await rememberSharedPostReturn(store, `/post?id=${other}&token=must-not-persist`);
  assert.deepEqual(JSON.parse(store.values.get(key)), { path: next, savedAt: now });
});

test('missing, malformed, expired and future records cannot become navigation destinations', async t => {
  t.mock.method(Date, 'now', () => now);
  const store = storage();
  assert.equal(await readSharedPostReturn(store), null);
  for (const raw of ['{broken', 'null', JSON.stringify(path), JSON.stringify({ path: '/', savedAt: now }), JSON.stringify({ path: `https://evil.test/post?id=${id}`, savedAt: now }),
    JSON.stringify({ path: `/post?id=${id}&id=${other}`, savedAt: now }), JSON.stringify({ path, savedAt: now - day }), JSON.stringify({ path, savedAt: now + 1 }), JSON.stringify({ path, savedAt: String(now) }),
    JSON.stringify({ path: path + '&token=do-not-keep', savedAt: now })]) {
    store.values.set(key, raw);
    assert.equal(await readSharedPostReturn(store), null);
    assert.equal(store.values.has(key), false, 'invalid records are removed');
  }
  store.values.set(key, JSON.stringify({ path, savedAt: now - day + 1 }));
  assert.equal(await readSharedPostReturn(store), native, 'less than 24h remains valid');
});

test('latest remember wins and a stale matching-clear cannot delete a newer target', async t => {
  t.mock.method(Date, 'now', () => now);
  const store = storage();
  await Promise.all([rememberSharedPostReturn(store, path), rememberSharedPostReturn(store, next), clearSharedPostReturn(store, path)]);
  assert.equal(await readSharedPostReturn(store), nativeNext);
  await clearSharedPostReturn(store, next);
  assert.equal(await readSharedPostReturn(store), null);
});

test('an old read then matching cleanup cannot remove a later queued remember', async t => {
  t.mock.method(Date, 'now', () => now);
  const store = storage();
  await rememberSharedPostReturn(store, path);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { started = resolve; });
  const get = store.getItem.bind(store);
  let pause = true;
  store.getItem = async key => { if (pause) { pause = false; started(); await gate; } return get(key); };
  const read = readSharedPostReturn(store);
  await waiting;
  const save = rememberSharedPostReturn(store, next);
  release();
  assert.equal(await read, native);
  await clearSharedPostReturn(store, path);
  await save;
  assert.equal(await readSharedPostReturn(store), nativeNext);
});

test('storage failures propagate and do not poison subsequent reads, remembers or matching clears', async t => {
  t.mock.method(Date, 'now', () => now);
  const store = storage(), set = store.setItem.bind(store), get = store.getItem.bind(store), remove = store.removeItem.bind(store);
  store.setItem = async () => { throw new Error('set failed'); };
  await assert.rejects(rememberSharedPostReturn(store, path), /set failed/);
  store.setItem = set;
  await rememberSharedPostReturn(store, path);
  store.getItem = async () => { throw new Error('get failed'); };
  await assert.rejects(readSharedPostReturn(store), /get failed/);
  store.getItem = get;
  store.removeItem = async () => { throw new Error('remove failed'); };
  await assert.rejects(clearSharedPostReturn(store, path), /remove failed/);
  store.removeItem = remove;
  assert.equal(await readSharedPostReturn(store), native, 'failed cleanup leaves a retryable intent');
  await clearSharedPostReturn(store, path);
  await rememberSharedPostReturn(store, next);
  assert.equal(await readSharedPostReturn(store), nativeNext);
});
