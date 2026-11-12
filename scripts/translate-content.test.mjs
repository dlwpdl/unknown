import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as translationText from '../supabase/functions/_shared/translation-text.ts';

const ID = '11111111-2222-4333-8444-555555555555';
const source = ts.transpileModule(fs.readFileSync(new URL('../supabase/functions/translate-content/index.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

// Runs the function against a fake viewer: `table` is what RLS lets them read from posts, `visible` what get_public_post returns.
async function translate({ table, visible }) {
  let handler;
  const calls = [], sent = [];
  const query = (name, result, args) => ({
    select: (columns) => ({ maybeSingle: async () => { calls.push([name, JSON.parse(JSON.stringify(args)), columns]); return result; } }),
    then: (resolve, reject) => { calls.push(name); return Promise.resolve(result).then(resolve, reject); },
  });
  const chain = (result) => ({ eq: () => chain(result), is: () => chain(result), maybeSingle: async () => result });
  // Only the client built with the viewer's Authorization header may read the post: the service key has no auth.uid(),
  // so block, report and guest checks would not apply to it.
  const client = (viewer) => ({
    auth: { getUser: async () => ({ data: { user: { id: 'member' } } }) },
    from: (name) => ({ select: () => { calls.push(`from:${name}`); return chain({ data: table, error: null }); } }),
    rpc: (name, args) => query(name, name !== 'get_public_post' ? { data: null, error: null }
      : viewer ? { data: visible, error: null } : { data: null, error: { message: 'service read' } }, args),
  });
  vm.runInNewContext(source, {
    exports: {}, Request, Response, console, TextEncoder, crypto,
    Deno: { serve: fn => { handler = fn; }, env: { get: (key) => key } },
    require: () => ({ ...translationText, createClient: (_url, _key, options) => client(!!options?.global?.headers?.Authorization) }),
    fetch: async (_url, options) => {
      sent.push(JSON.parse(options.body));
      return Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ title: 'Room for rent', body: 'Near the station' }) }] }] });
    },
  });
  const body = { kind: 'post', id: ID, language: 'en', source: { title: '방 렌트', body: '역 근처' } };
  const response = await handler(new Request('https://example.test/translate-content', { method: 'POST', headers: { Authorization: 'Bearer member' }, body: JSON.stringify(body) }));
  return { status: response.status, json: await response.json(), calls, sent };
}

test('a business post hidden from the posts table is read through the viewer’s public post read and translated', async () => {
  const result = await translate({ table: null, visible: { title: '방 렌트', body: '역 근처' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.json, { translation: { title: 'Room for rent', body: 'Near the station' } });
  assert.deepEqual(result.calls.slice(0, 2), ['from:posts', ['get_public_post', { p_post_id: ID }, 'title,body']]);
  assert.equal(result.sent.length, 1);
});

test('the public read must match the text the viewer was shown', async () => {
  const changed = await translate({ table: null, visible: { title: '방 렌트', body: '다른 본문' } });
  assert.equal(changed.status, 409);
  assert.equal(changed.sent.length, 0);
});

test('a post the viewer can read directly never takes the public read, and one they cannot see at all is not translated', async () => {
  const direct = await translate({ table: { title: '방 렌트', body: '역 근처' }, visible: null });
  assert.equal(direct.status, 200);
  assert.ok(!direct.calls.some(call => call[0] === 'get_public_post'));
  const hidden = await translate({ table: null, visible: null });
  assert.equal(hidden.status, 404);
  assert.deepEqual(hidden.json, { error: { code: 'NOT_FOUND' } });
  assert.equal(hidden.sent.length, 0);
});
