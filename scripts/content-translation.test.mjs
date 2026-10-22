import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const file = new URL('../supabase/functions/_shared/content-translation.ts', import.meta.url);
const id = '10000000-0000-4000-8000-000000000001';

test('stored posts and comments have a bounded, language-specific translation contract', async (t) => {
  assert.ok(existsSync(file), 'Content translation has not been implemented');
  const api = await import(file.href);
  await t.test('comments include replies; caller text is only an expected version', () => {
    assert.deepEqual(api.validateTranslationRequest({ kind: 'comment', id, language: 'en', source: { title: null, body: '댓글' } }),
      { kind: 'comment', id, language: 'en', source: { title: null, body: '댓글' } });
    for (const patch of [{ kind: 'message' }, { language: 'fr' }, { id: 'not-a-uuid' }, { source: { title: null, body: 'x'.repeat(12001) } }]) {
      assert.throws(() => api.validateTranslationRequest({ kind: 'comment', id, language: 'en', source: { title: null, body: '댓글' }, ...patch }));
    }
    assert.throws(() => api.validateTranslationRequest({ kind: 'post', id, language: 'ko', source: { title: null, body: 'hello' } }));
  });
  await t.test('map, event and photo metadata remain original and outside the model input', () => {
    const body = '함께 산책해요.\n\nGoogle 지도: https://www.google.com/maps/search/?api=1&query=49.28%2C-123.12\n위치: 공원\n\n사진 출처·이용 조건\nhttps://unsplash.com/photos/example';
    assert.deepEqual(api.visibleTranslationSource('post', '산책', body, false), { title: '산책', body: '함께 산책해요.' });
    assert.deepEqual(api.visibleTranslationSource('comment', null, '원래 댓글'), { title: null, body: '원래 댓글' });
    assert.deepEqual(api.visibleTranslationSource('post', '모임', '같이 가요.\n\n행사 ID: ABC\n장소: Hall', true), { title: '모임', body: '같이 가요.' });
  });
  await t.test('unambiguous same-language and number-only text do not need a model call', () => {
    assert.equal(api.needsContentTranslation({ title: null, body: 'Thanks!' }, 'ko'), true);
    assert.equal(api.needsContentTranslation({ title: '안녕', body: '고마워요' }, 'ko'), false);
    assert.equal(api.needsContentTranslation({ title: null, body: 'Thanks!' }, 'en'), false);
    assert.equal(api.needsContentTranslation({ title: null, body: '고마워요' }, 'en'), true);
    assert.equal(api.needsContentTranslation({ title: null, body: '👍 25 https://example.com' }, 'ko'), false);
    assert.equal(api.needsContentTranslation({ title: null, body: 'Thanks! 고마워요' }, 'en'), true);
    assert.equal(api.needsContentTranslation({ title: null, body: 'Thanks! 고마워요' }, 'ko'), true);
  });
  await t.test('prices, dates, links, email and hashtags cannot be altered or invented by the model', () => {
    const source = { title: '의자 $25', body: '10/15 3:30에 만나요. https://example.com/a?q=1 test@example.com #밴쿠버' };
    const protectedSource = api.protectTranslationSource(source);
    assert.ok(!protectedSource.source.body.includes('test@example.com'));
    const translated = { title: protectedSource.source.title.replace('의자', 'Chair'), body: protectedSource.source.body.replace('에 만나요.', ' — see you then.') };
    const restored = api.restoreTranslationSource(translated, protectedSource);
    assert.equal(restored.title, 'Chair $25');
    for (const token of ['10/15', '3:30', 'https://example.com/a?q=1', 'test@example.com', '#밴쿠버']) assert.ok(restored.body.includes(token));
    assert.throws(() => api.restoreTranslationSource({ ...translated, body: translated.body.replace(/⟦[^⟧]+⟧/, '') }, protectedSource));
    assert.throws(() => api.restoreTranslationSource({ ...translated, title: null }, protectedSource));
    assert.throws(() => api.restoreTranslationSource({ ...translated, body: translated.body + ' ⟦GLING_VALUE_999⟧' }, protectedSource));
    assert.throws(() => api.restoreTranslationSource({ ...translated, body: translated.body + ' 999' }, protectedSource));
    assert.throws(() => api.restoreTranslationSource({ ...translated, body: 'x'.repeat(12001) }, protectedSource));
    assert.equal(source.title, '의자 $25');
  });
});
