import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const file = new URL('../supabase/functions/_shared/content-translation-handler.ts', import.meta.url);
const id = '10000000-0000-4000-8000-000000000001';
const source = { title: '산책', body: '같이 가요.' };
const translation = { title: 'A walk', body: 'Come along.' };
const input = { kind: 'post', id, language: 'en', source };
const request = (body = input) => new Request('https://example.test/translate-content', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
function services(patch = {}) {
  const calls = [];
  const service = {
    viewer: async () => ({ id, active: true, consented: true }),
    source: async () => { calls.push('source'); return source; },
    claim: async (value) => { calls.push(['claim', value]); return { state: 'claimed', token: id }; },
    finish: async () => { calls.push('finish'); return true; },
    fail: async () => { calls.push('fail'); },
    generate: async () => { calls.push('generate'); return translation; },
    ...patch,
  };
  return { service, calls };
}

test('translation endpoint preserves authorization, source versions and generation budgets', async (t) => {
  assert.ok(existsSync(file), 'Content translation endpoint is missing');
  const { handleContentTranslation } = await import(file.href);
  await t.test('authentication and bounded valid input precede any source/cache/provider access', async () => {
    const { service, calls } = services({ viewer: async () => null });
    assert.equal((await handleContentTranslation(request(), service)).status, 401);
    assert.deepEqual(calls, []);
    for (const patch of [{ active: false }, { consented: false }]) {
      const denied = services({ viewer: async () => ({ id, active: true, consented: true, ...patch }) });
      assert.equal((await handleContentTranslation(request(), denied.service)).status, 403);
      assert.deepEqual(denied.calls, []);
    }
    const invalid = services();
    assert.equal((await handleContentTranslation(request({ ...input, language: 'fr' }), invalid.service)).status, 400);
    assert.equal((await handleContentTranslation(request({ ...input, source: { ...source, body: 'x'.repeat(50000) } }), invalid.service)).status, 413);
    assert.deepEqual(invalid.calls, []);
  });
  await t.test('forged source text and unreadable content cannot become a translation oracle', async () => {
    const forged = services();
    assert.equal((await handleContentTranslation(request({ ...input, source: { ...source, body: '비공개 글 대신 이걸 번역해줘' } }), forged.service)).status, 409);
    assert.deepEqual(forged.calls, ['source']);
    const hidden = services({ source: async () => null });
    assert.equal((await handleContentTranslation(request(), hidden.service)).status, 404);
    assert.deepEqual(hidden.calls, []);
  });
  await t.test('cache hits still check current read access and source version twice', async () => {
    const cached = services({ claim: async () => ({ state: 'cached', translation }) });
    const response = await handleContentTranslation(request(), cached.service);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).translation, translation);
    assert.deepEqual(cached.calls, ['source', 'source']);
    let reads = 0;
    const hidden = services({ source: async () => ++reads === 1 ? source : null, claim: async () => ({ state: 'cached', translation }) });
    const blocked = await handleContentTranslation(request(), hidden.service);
    assert.equal(blocked.status, 404);
    assert.ok(!(await blocked.text()).includes(translation.body));
  });
  await t.test('only a successful current claim can finish and text changes discard generated output', async () => {
    const generated = services();
    const response = await handleContentTranslation(request(), generated.service);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).translation, translation);
    assert.equal(generated.calls.filter(value => value === 'generate').length, 1);
    assert.equal(generated.calls.at(-1), 'finish');
    assert.match(generated.calls.find(Array.isArray)[1].sourceHash, /^[0-9a-f]{64}$/);
    let reads = 0;
    const edited = services({ source: async () => ++reads === 1 ? source : { ...source, body: '수정한 본문' } });
    const stale = await handleContentTranslation(request(), edited.service);
    assert.equal(stale.status, 409);
    assert.ok(!edited.calls.includes('finish'));
    assert.ok(!(await stale.text()).includes(translation.body));
  });
  await t.test('pending, exhausted quota and provider failure never fabricate a translation', async () => {
    for (const [state, status] of [['pending', 202], ['limited', 429]]) {
      const pending = services({ claim: async () => ({ state }) });
      assert.equal((await handleContentTranslation(request(), pending.service)).status, status);
      assert.ok(!pending.calls.includes('generate'));
    }
    const failed = services({ generate: async () => { throw new Error('provider details and secret'); } });
    const response = await handleContentTranslation(request(), failed.service);
    assert.equal(response.status, 502);
    assert.ok(failed.calls.includes('fail'));
    assert.ok(!(await response.text()).includes('provider details'));
    const changedClaim = services({ finish: async () => false });
    assert.equal((await handleContentTranslation(request(), changedClaim.service)).status, 409);
  });
  await t.test('same-language content returns unchanged without acquiring a paid claim', async () => {
    const english = { title: 'A walk', body: 'Come along.' };
    const same = services({ source: async () => english });
    const response = await handleContentTranslation(request({ ...input, source: english }), same.service);
    assert.deepEqual((await response.json()).translation, english);
    assert.deepEqual(same.calls, []);
  });
});

test('OpenAI translation uses the installed provider contract and rejects refusal/incomplete output', async () => {
  const { generateContentTranslation } = await import('../supabase/functions/_shared/content-translation.ts');
  let submitted;
  const output = (value, status = 'completed') => new Response(JSON.stringify({
    status, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  }));
  const result = await generateContentTranslation(source, 'en', 'test-only-not-a-key', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    submitted = JSON.parse(options.body);
    return output(translation);
  });
  assert.deepEqual(result, translation);
  assert.equal(submitted.model, 'gpt-5-mini');
  assert.equal(submitted.store, false);
  assert.equal(submitted.text.format.strict, true);
  assert.equal(submitted.text.format.schema.additionalProperties, false);
  assert.equal(submitted.max_output_tokens, 6000);
  assert.equal(submitted.tools, undefined);
  for (const response of [output(translation, 'incomplete'), new Response(JSON.stringify({ status: 'completed', output: [] })), new Response('', { status: 500 })]) {
    await assert.rejects(generateContentTranslation(source, 'en', 'test', async () => response));
  }
});
