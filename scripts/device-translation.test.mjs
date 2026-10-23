import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { translationSource } from './test-meetup-source-imports.mjs';

function client(native, OS = 'ios') {
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    if (!fs.existsSync(file)) return {};
    const exports = {};
    modules.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(source, { exports, AbortController, setTimeout, clearTimeout, fetch() { throw new Error('Remote translation is forbidden'); }, require(name) {
      if (name === 'react-native') return { Platform: { OS } };
      if (name === 'expo-modules-core') return { requireOptionalNativeModule(id) { assert.equal(id, 'GlingTranslation'); return native; } };
      if (name === './translation-source.ts') return translationSource;
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name.replace(/\.ts$/, '') + '.ts'));
      throw new Error(`Unexpected dependency ${name}`);
    } });
    return exports;
  }
  return load(new URL('../src/lib/content-translation.ts', import.meta.url).pathname);
}
const request = (body = 'Hello world', language = 'ko') => ({
  kind: 'post', id: '11111111-1111-4111-8111-111111111111', language, source: { title: 'Hello', body },
});
const plain = value => JSON.parse(JSON.stringify(value));

test('unsupported web and old native builds never fall back to paid translation', async () => {
  for (const [native, OS] of [[null, 'ios'], [{ translate() { assert.fail(); } }, 'web']]) {
    const api = client(native, OS);
    assert.equal(typeof api.isDeviceTranslationSupported, 'function');
    assert.equal(api.isDeviceTranslationSupported(), false);
    await assert.rejects(api.requestContentTranslation('member', request()), /TRANSLATION_NOT_SUPPORTED/);
  }
});

test('only text goes to the device; protected values and line breaks remain exact', async () => {
  const calls = [];
  const api = client({ async translate(texts, language) { calls.push([plain(texts), language]); return texts.map(text => '번역 ' + text); } });
  const result = await api.requestContentTranslation('member', request('Hello @sam, pay CA$25.50\n\nEmail a@example.com or https://example.com?q=2 #Toronto'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'ko');
  const sent = calls[0][0].join('');
  for (const value of ['@sam', '25', 'a@example.com', 'https://', '#Toronto', '\n']) assert.equal(sent.includes(value), false, value);
  for (const value of ['@sam', 'CA$25.50', '\n\n', 'a@example.com', 'https://example.com?q=2', '#Toronto']) assert.ok(result.body.includes(value), value);
});

test('cache/dedup includes viewer, source and language rather than only post ID', async () => {
  let count = 0;
  const api = client({ async translate(texts) { count++; return texts.map(text => '번역 ' + text); } });
  assert.equal(typeof api.requestContentTranslation, 'function');
  const [first, duplicate] = await Promise.all([api.requestContentTranslation('a', request()), api.requestContentTranslation('a', request())]);
  assert.deepEqual(plain(first), plain(duplicate));
  assert.equal(count, 1);
  await api.requestContentTranslation('a', request());
  assert.equal(count, 1);
  await api.requestContentTranslation('b', request());
  await api.requestContentTranslation('a', request('Edited source'));
  await api.requestContentTranslation('a', request('안녕하세요', 'en'));
  assert.equal(count, 4);
});

test('invalid requests and cancelled readers do not start native translation', async () => {
  const api = client({ translate() { assert.fail('Should not run'); } });
  assert.equal(typeof api.requestContentTranslation, 'function');
  await assert.rejects(api.requestContentTranslation('', request()), /AUTH_REQUIRED/);
  await assert.rejects(api.requestContentTranslation('a', { ...request(), language: 'fr' }), /INVALID_INPUT/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.requestContentTranslation('a', request(), controller.signal), /TRANSLATION_CANCELLED/);
});

test('bad native output is rejected while the caller retains its untouched original', async () => {
  const input = request('Original CA$20.50');
  const api = client({ async translate() { return []; } });
  assert.equal(typeof api.requestContentTranslation, 'function');
  await assert.rejects(api.requestContentTranslation('a', input), /TRANSLATION_UNAVAILABLE/);
  assert.equal(input.source.body, 'Original CA$20.50');
});

const tick = () => new Promise(setImmediate);
test('native jobs run one at a time and a cancelled queued card never reaches the device', async () => {
  const calls = [];
  const api = client({ translate(texts) { return new Promise(resolve => calls.push({ texts, resolve })); } });
  const first = api.requestContentTranslation('a', request());
  const controller = new AbortController();
  const queued = api.requestContentTranslation('a', request('Queued text'), controller.signal);
  const cancelled = assert.rejects(queued, /TRANSLATION_CANCELLED/);
  await tick();
  assert.equal(calls.length, 1);
  controller.abort(); await cancelled;
  calls[0].resolve(calls[0].texts.map(text => '번역 ' + text));
  await first; await tick();
  assert.equal(calls.length, 1);
});

test('cancelling one duplicate reader preserves another reader and caches only valid current work', async () => {
  let finish, count = 0;
  const api = client({ translate(texts) { count++; return new Promise(resolve => { finish = () => resolve(texts.map(text => '번역 ' + text)); }); } });
  const controller = new AbortController();
  const first = api.requestContentTranslation('a', request(), controller.signal);
  const cancelled = assert.rejects(first, /TRANSLATION_CANCELLED/);
  const remaining = api.requestContentTranslation('a', request());
  await tick(); controller.abort(); await cancelled; finish();
  const result = await remaining;
  assert.equal((await api.requestContentTranslation('a', request())).body, result.body);
  assert.equal(count, 1);
  api.resetContentTranslations();
  const next = api.requestContentTranslation('a', request());
  await tick(); finish(); await next;
  assert.equal(count, 2, 'account reset removes cached translations');
});

test('an account reset discards an in-flight result before it can populate the cache', async () => {
  const calls = [];
  const api = client({ translate(texts) { return new Promise(resolve => calls.push(() => resolve(texts.map(text => '번역 ' + text)))); } });
  const work = api.requestContentTranslation('a', request());
  const cancelled = assert.rejects(work, /TRANSLATION_CANCELLED/);
  await tick(); api.resetContentTranslations(); calls[0](); await cancelled;
  const retry = api.requestContentTranslation('a', request());
  await tick(); assert.equal(calls.length, 2); calls[1](); await retry;
});

test('spaces around protected values survive native translators that trim segment edges', async () => {
  const api = client({ async translate(texts) { return texts.map(text => '번역 ' + text.trim()); } });
  const result = await api.requestContentTranslation('a', request(' \tHello @sam CA$25  '));
  assert.equal(result.body, ' \t번역 Hello @sam CA$25  ');
});

test('fast scrolling during a language-pack download waits for capacity instead of stranding the next visible card', async () => {
  let releaseFirst, calls = 0;
  const api = client({ async translate(texts) {
    calls++;
    if (calls === 1) await new Promise(resolve => { releaseFirst = resolve; });
    return texts.map(text => 'Translated ' + text);
  } });
  for (let i = 0; i < 32; i++) {
    const controller = new AbortController();
    const stale = api.requestContentTranslation('viewer', request('Card ' + i), controller.signal);
    const cancelled = assert.rejects(stale, /TRANSLATION_CANCELLED/);
    await tick(); controller.abort(); await cancelled; await tick();
  }
  let failure;
  const visible = Promise.all([
    api.requestContentTranslation('viewer', request('Current visible card')),
    api.requestContentTranslation('viewer', request('Current visible card')),
  ]).catch(error => { failure = error; });
  await tick();
  releaseFirst();
  const results = await visible;
  assert.equal(failure, undefined, 'a full queue of cancelled cards must not fail the currently visible card');
  assert.ok(results[0].body.includes('Current visible card'));
  assert.deepEqual(plain(results[0]), plain(results[1]), 'waiting readers still share the same translation');
  assert.equal(calls, 2, 'cancelled queued cards do not run native inference');
});

test('capacity waiters cancel on leaving the screen or changing accounts without starting native work', async () => {
  let releaseFirst, calls = 0;
  const api = client({ async translate(texts) {
    calls++;
    if (calls === 1) await new Promise(resolve => { releaseFirst = resolve; });
    return texts.map(text => 'Translated ' + text);
  } });
  const queued = Promise.allSettled(Array.from({ length: 32 }, (_, index) => api.requestContentTranslation('old-account', request('Card ' + index))));
  await tick();
  const controller = new AbortController();
  const leaving = assert.rejects(api.requestContentTranslation('old-account', request('Leaving card'), controller.signal), /TRANSLATION_CANCELLED/);
  await tick(); controller.abort(); await leaving;
  const accountChanged = assert.rejects(api.requestContentTranslation('old-account', request('Old account waiting card')), /TRANSLATION_CANCELLED/);
  await tick(); api.resetContentTranslations(); releaseFirst();
  await accountChanged;
  assert.ok((await queued).every(result => result.status === 'rejected'));
  assert.equal(calls, 1);
});
