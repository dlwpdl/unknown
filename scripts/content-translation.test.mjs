import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { translationSource } from './test-meetup-source-imports.mjs';

function client(invoke) {
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(source, { exports, AbortController, setTimeout, clearTimeout, require(name) {
      if (name === '@/lib/supabase') return { supabase: { functions: { invoke } } };
      if (name === './translation-source.ts') return translationSource;
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
const tick = () => new Promise(setImmediate);
const translated = body => ({ data: { translation: { title: '안녕', body: '번역 ' + body.source.body } }, error: null });
// Resolves only when released, and rejects like fetch when its signal aborts.
function held() {
  const calls = [];
  const invoke = (name, { body, signal }) => new Promise((resolve, reject) => {
    calls.push({ body, release: () => resolve(translated(body)) });
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  return { calls, invoke };
}

test('sends the visible source to translate-content once and returns the server translation', async () => {
  const calls = [];
  const api = client(async (name, options) => { calls.push([name, plain(options.body)]); return translated(options.body); });
  const result = await api.requestContentTranslation('member', request('Hello @sam\n\nhttps://example.com'));
  assert.deepEqual(calls, [['translate-content', plain(request('Hello @sam\n\nhttps://example.com'))]]);
  assert.deepEqual(plain(result), { title: '안녕', body: '번역 Hello @sam\n\nhttps://example.com' });
});

test('cache and dedup include viewer, source and language rather than only post ID', async () => {
  let count = 0;
  const api = client(async (name, { body }) => { count++; return translated(body); });
  const [first, duplicate] = await Promise.all([api.requestContentTranslation('a', request()), api.requestContentTranslation('a', request())]);
  assert.deepEqual(plain(first), plain(duplicate));
  await api.requestContentTranslation('a', request());
  assert.equal(count, 1);
  await api.requestContentTranslation('b', request());
  await api.requestContentTranslation('a', request('Edited source'));
  await api.requestContentTranslation('a', request('안녕하세요', 'en'));
  assert.equal(count, 4);
});

test('guests, invalid requests and cancelled readers never reach the server', async () => {
  const api = client(() => assert.fail('Should not run'));
  await assert.rejects(api.requestContentTranslation('', request()), /AUTH_REQUIRED/);
  await assert.rejects(api.requestContentTranslation('a', { ...request(), language: 'fr' }), /INVALID_INPUT/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.requestContentTranslation('a', request(), controller.signal), /TRANSLATION_CANCELLED/);
});

test('server errors and malformed translations are rejected without touching the original', async () => {
  const input = request('Original CA$20.50');
  for (const response of [
    { data: null, error: new Error('500') },
    { data: { translation: { title: '안녕', body: ' ' } }, error: null },
    { data: { translation: { title: null, body: '번역' } }, error: null },
  ]) {
    const api = client(async () => response);
    await assert.rejects(api.requestContentTranslation('a', input), /TRANSLATION_UNAVAILABLE/);
  }
  assert.equal(input.source.body, 'Original CA$20.50');
});

test('cancelling one duplicate reader keeps the other, and an account reset clears the cache', async () => {
  const { calls, invoke } = held();
  const api = client(invoke);
  const controller = new AbortController();
  const cancelled = assert.rejects(api.requestContentTranslation('a', request(), controller.signal), /TRANSLATION_CANCELLED/);
  const remaining = api.requestContentTranslation('a', request());
  await tick(); controller.abort(); await cancelled; calls[0].release();
  const result = await remaining;
  assert.equal((await api.requestContentTranslation('a', request())).body, result.body);
  assert.equal(calls.length, 1);
  api.resetContentTranslations();
  const next = api.requestContentTranslation('a', request());
  await tick(); calls[1].release(); await next;
  assert.equal(calls.length, 2, 'account reset removes cached translations');
});

test('leaving the card aborts the network request, and a reset discards an in-flight result', async () => {
  const { calls, invoke } = held();
  const api = client(invoke);
  const controller = new AbortController();
  const leaving = assert.rejects(api.requestContentTranslation('a', request('Scrolled past'), controller.signal), /TRANSLATION_CANCELLED/);
  await tick(); controller.abort(); await leaving; await tick();
  const work = api.requestContentTranslation('a', request());
  const discarded = assert.rejects(work, /TRANSLATION_CANCELLED/);
  await tick(); api.resetContentTranslations(); calls[1].release(); await discarded;
  const retry = api.requestContentTranslation('a', request());
  await tick(); assert.equal(calls.length, 3); calls[2].release(); await retry;
});

test('business disclosure lines are translated for display only and kept out of machine translation', async () => {
  const { translateUi } = await import('../src/i18n/index.ts');
  const { visibleTranslationSource, needsContentTranslation, businessDisclosureLines, localizeBusinessDisclosure } = translationSource;
  const body = 'Fresh pasta every Friday.\n\n비즈니스에서 직접 게시한 안내입니다.';
  const source = plain(visibleTranslationSource('post', 'Pasta night', body));
  assert.deepEqual(source, { title: 'Pasta night', body: 'Fresh pasta every Friday.' });
  assert.equal(needsContentTranslation(source, 'en'), false, 'an English business post is not offered for translation because of the marker');
  assert.deepEqual(plain(businessDisclosureLines(body)), ['비즈니스에서 직접 게시한 안내입니다.']);
  assert.equal(localizeBusinessDisclosure(body, text => translateUi('en', text)), 'Fresh pasta every Friday.\n\nPosted by the business.');
  assert.equal(localizeBusinessDisclosure(body, text => translateUi('ko', text)), body);
  assert.equal(plain(visibleTranslationSource('post', '제목', '일반 글 ')).body, '일반 글 ', 'posts without a marker keep their exact source');
});
