import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const file = new URL('../src/lib/content-translation.ts', import.meta.url);
const input = { kind: 'comment', id: '10000000-0000-4000-8000-000000000001', language: 'en', source: { title: null, body: '고마워요' } };
const translation = { title: null, body: 'Thank you.' };
const response = { ...input, translation };

test('translation client binds responses to the current content and language', async () => {
  assert.ok(existsSync(file), 'Translation client is missing');
  const { requestContentTranslation } = await import(file.href);
  const client = { functions: { invoke: async (name, options) => {
    assert.equal(name, 'translate-content');
    assert.deepEqual(options.body, input);
    assert.equal(options.timeout, 25000);
    return { data: response, error: null };
  } } };
  assert.deepEqual(await requestContentTranslation(client, 'viewer-a', input), translation);
  for (const patch of [{ language: 'ko' }, { id: 'other' }, { source: { title: null, body: 'edited' } }, { translation: { title: null, body: 'Invented price 999' } }]) {
    const forged = { functions: { invoke: async () => ({ data: { ...response, ...patch }, error: null }) } };
    await assert.rejects(requestContentTranslation(forged, 'viewer-a', input));
  }
});

test('translation client keeps errors useful without displaying server internals', async () => {
  const { requestContentTranslation } = await import(file.href);
  const pending = { functions: { invoke: async () => ({ data: { error: { code: 'TRANSLATION_PENDING' } }, error: null }) } };
  await assert.rejects(requestContentTranslation(pending, 'viewer-a', input), { message: 'TRANSLATION_PENDING' });
  const unavailable = { functions: { invoke: async () => ({ data: null, error: { message: 'private error', context: new Response('not deployed', { status: 404 }) } }) } };
  await assert.rejects(requestContentTranslation(unavailable, 'viewer-a', input), { message: 'TRANSLATION_UNAVAILABLE' });
});

test('only two translations run at once and a queued request cannot run after cancellation', async () => {
  const { requestContentTranslation } = await import(file.href);
  let calls = 0;
  const release = [];
  const client = { functions: { invoke: () => { calls++; return new Promise(resolve => release.push(() => resolve({ data: response, error: null }))); } } };
  const first = requestContentTranslation(client, 'viewer-a', input), second = requestContentTranslation(client, 'viewer-b', input);
  const controller = new AbortController();
  const third = requestContentTranslation(client, 'viewer-c', input, controller.signal);
  controller.abort();
  const cancelled = assert.rejects(third, { message: 'TRANSLATION_CANCELLED' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 2);
  release.forEach(resolve => resolve());
  await Promise.all([first, second]);
  await cancelled;
  assert.equal(calls, 2);
});


test('feed and detail share an in-flight translation only within the same account', async () => {
  const { requestContentTranslation } = await import(file.href);
  let calls = 0;
  let release;
  const client = { functions: { invoke: () => { calls++; return new Promise(resolve => { release = () => resolve({ data: response, error: null }); }); } } };
  const first = requestContentTranslation(client, 'viewer-a', input);
  const second = requestContentTranslation(client, 'viewer-a', input);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [translation, translation]);
});
