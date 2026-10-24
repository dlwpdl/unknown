import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

let api;
const id = 'd2400000-0000-4000-8000-000000000001';
const scope = { cityId: 'vancouver', query: '', industry: null, offset: 0 };
const item = { id, name: 'Coffee', city_id: 'vancouver', industry: '카페', services: 'Coffee', address: '',
  avatar_path: `business-profile/${id}/avatar/${'a'.repeat(32)}`, banner_path: null, saved: false, has_webshop: true };
const page = (items = [item], patch = {}) => ({ city_id: 'vancouver', query: '', industry: null, offset: 0,
  items, industries: ['카페', '기타'], has_more: false, next_offset: items.length, ...patch });
function client(data = page(), error = null) {
  const calls = [], signals = [];
  return { calls, signals, rpc(name, args) {
    calls.push([name, args]);
    const request = Promise.resolve({ data, error });
    request.abortSignal = signal => { signals.push(signal); return request; };
    return request;
  }, storage: { from() { assert.fail('Public directory images must not request private storage'); } } };
}

test('directory client API exists', async () => {
  assert.ok(existsSync(new URL('../src/lib/business-directory.ts', import.meta.url)), 'directory implementation is missing');
  api = await import('../src/lib/business-directory.ts');
  assert.equal(typeof api.loadBusinessDirectory, 'function');
});

test('request is bounded, normalized and abortable; public media reuses hydration without profile RPCs', async () => {
  const abort = new AbortController();
  const db = client(page([item], { query: '100%_\\', industry: '카페', offset: 20, next_offset: 21 }));
  const result = await api.loadBusinessDirectory(db, { ...scope, query: ' 100%_\\ ', industry: '카페', offset: 20, signal: abort.signal });
  assert.deepEqual(db.calls, [['get_public_business_directory', { p_city_id: 'vancouver', p_query: '100%_\\', p_industry: '카페', p_offset: 20 }]]);
  assert.deepEqual(db.signals, [abort.signal]);
  assert.equal(result.items[0].id, id);
  assert.match(result.items[0].avatarUri, /format=business-image/);
  assert.equal(result.items[0].imageLoadFailed, false);
  assert.equal(result.hasMore, false); assert.equal(result.nextOffset, 21);
  assert.deepEqual(result.industries, ['카페', '기타']);
});

test('20 rows and the lookahead flag preserve deterministic offset; empty pages stay empty', async () => {
  const rows = Array.from({ length: 20 }, (_, n) => ({ ...item, id: `d2400000-0000-4000-8000-${String(n).padStart(12, '0')}`, avatar_path: null }));
  const result = await api.loadBusinessDirectory(client(page(rows, { has_more: true })), scope);
  assert.equal(result.items.length, 20); assert.equal(result.hasMore, true); assert.equal(result.nextOffset, 20);
  assert.deepEqual((await api.loadBusinessDirectory(client(page([])), scope)).items, []);
});

test('invalid requests fail before any RPC', async () => {
  const db = client();
  for (const patch of [{ cityId: '' }, { cityId: 'x'.repeat(101) }, { query: 'x'.repeat(201) }, { query: '\u0000' }, { query: null },
    { industry: '' }, { industry: 'x'.repeat(201) }, { offset: null }, { offset: -1 }, { offset: 1.2 }, { offset: 10001 }]) {
    await assert.rejects(api.loadBusinessDirectory(db, { ...scope, ...patch }), /INVALID_BUSINESS_DIRECTORY_REQUEST/);
  }
  assert.equal(db.calls.length, 0);
});

test('registered multiline services and address remain public display data', async () => {
  const result = await api.loadBusinessDirectory(client(page([{ ...item, services: 'Coffee\nTea', address: 'Unit 1\nVancouver' }])), scope);
  assert.equal(result.items[0].services, 'Coffee\nTea');
  assert.equal(result.items[0].address, 'Unit 1\nVancouver');
});

test('public character limits match PostgreSQL for emoji and other supplementary characters', async () => {
  const row = { ...item, name: '가'.repeat(199) + '😀', services: '가'.repeat(1499) + '😀', address: '가'.repeat(299) + '😀' };
  const result = await api.loadBusinessDirectory(client(page([row])), scope);
  assert.equal(result.items[0].services, row.services);
  assert.equal(result.items[0].name, row.name);
  assert.equal(result.items[0].address, row.address);
  await assert.rejects(api.loadBusinessDirectory(client(page([{ ...row, services: row.services + '가' }])), scope), /INVALID_BUSINESS_DIRECTORY_RESPONSE/);
});

test('malformed, private, duplicate and out-of-scope responses fail closed', async () => {
  const badItems = [null, { ...item, id: 'invalid' }, { ...item, city_id: 'toronto' }, { ...item, saved: 1 },
    { ...item, has_webshop: null }, { ...item, owner_id: 'private' }, { ...item, contact: 'private' },
    { ...item, industry: ' ' }, { ...item, avatar_path: '../private' }, { ...item, banner_path: item.avatar_path },
    { ...item, avatar_path: item.avatar_path.replace(id, 'd2400000-0000-4000-8000-000000000002') }];
  const badPages = [null, [], { ...page(), city_id: 'toronto' }, { ...page(), query: 'old' }, { ...page(), industry: 'wrong' },
    { ...page(), offset: 20 }, { ...page(), next_offset: 100 }, { ...page(), has_more: true },
    { ...page(), owner_id: 'private' }, { ...page(), industries: ['카페', '카페'] }, { ...page(), industries: ['other'] },
    page([item, item]), page(Array(21).fill(item)), ...badItems.map(row => page([row]))];
  for (const data of badPages) await assert.rejects(api.loadBusinessDirectory(client(data), scope), /INVALID_BUSINESS_DIRECTORY_RESPONSE/);
  await assert.rejects(api.loadBusinessDirectory(client(page()), { ...scope, industry: 'other' }), /INVALID_BUSINESS_DIRECTORY_RESPONSE/);
});

test('abort and server failures never become a successful empty page', async () => {
  const abort = new AbortController(); abort.abort();
  const db = client();
  await assert.rejects(api.loadBusinessDirectory(db, { ...scope, signal: abort.signal }), { name: 'AbortError' });
  assert.equal(db.calls.length, 0);
  await assert.rejects(api.loadBusinessDirectory(client(null, new Error('offline')), scope), /offline/);
  await assert.rejects(api.loadBusinessDirectory(client(null, { code: 'PGRST202' }), scope));
  const late = new AbortController(); const lateDb = client();
  const pending = api.loadBusinessDirectory(lateDb, { ...scope, signal: late.signal }); late.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
