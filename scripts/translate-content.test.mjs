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

// The web build's call: no user, the search build token, and only what a guest's public preview shows of a business post.
async function search({ token = true, preview = { id: ID, kind: 'post', title: '방 렌트', preview: '역 근처', teaser: '역 근처' }, business = [{ post_id: ID }], cached = null, usage = 0,
  body = { kind: 'post', id: ID, language: 'en', source: { title: '방 렌트', body: '역 근처' } } } = {}) {
  let handler;
  const rpcs = [], sent = [];
  const answers = {
    is_search_build_token: { data: token, error: null }, get_shared_link_preview: { data: preview, error: null }, get_public_post_businesses: { data: business, error: null },
    get_content_translation: { data: { translation: cached, usage }, error: null }, put_content_translation: { data: null, error: null },
  };
  const client = () => ({ auth: { getUser: async () => { throw new Error('no user in build mode'); } }, from: () => { throw new Error('no table reads in build mode'); },
    rpc: async (name, args) => { rpcs.push([name, JSON.parse(JSON.stringify(args))]); return answers[name] ?? { data: null, error: { message: name } }; } });
  vm.runInNewContext(source, {
    exports: {}, Request, Response, console, TextEncoder, crypto,
    Deno: { serve: fn => { handler = fn; }, env: { get: (key) => key } },
    require: () => ({ ...translationText, createClient: client }),
    fetch: async (_url, options) => {
      sent.push(JSON.parse(options.body));
      return Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ title: 'Room for rent', body: 'Near the station' }) }] }] });
    },
  });
  const response = await handler(new Request('https://example.test/translate-content', { method: 'POST', headers: { 'x-gling-search-token': 'build' }, body: JSON.stringify(body) }));
  return { status: response.status, json: await response.json(), rpcs, sent };
}

test('the build translates a business post’s public preview once and saves it with no requester', async () => {
  const result = await search();
  assert.equal(result.status, 200);
  assert.deepEqual(result.json, { translation: { title: 'Room for rent', body: 'Near the station' } });
  assert.deepEqual(result.rpcs[0], ['is_search_build_token', { p_token: 'build' }]);
  assert.equal(result.rpcs.find(([name]) => name === 'get_content_translation')[1].p_user, null);
  assert.equal(result.rpcs.find(([name]) => name === 'put_content_translation')[1].p_user, null);
  assert.equal(result.sent.length, 1);
  const again = await search({ cached: { title: 'Room for rent', body: 'Near the station' } });
  assert.equal(again.status, 200);
  assert.equal(again.sent.length, 0);
});

test('the build is refused without a valid token, for member or meetup posts, for text beyond the preview and past its daily cap', async () => {
  for (const [options, status] of [
    [{ token: false }, 403], [{ business: [] }, 404], [{ preview: { id: ID, kind: 'meetup', title: '방 렌트', preview: '역 근처' } }, 404], [{ preview: null }, 404],
    [{ body: { kind: 'post', id: ID, language: 'en', source: { title: '방 렌트', body: '로그인해야 보이는 본문' } } }, 409],
    [{ body: { kind: 'comment', id: ID, language: 'en', source: { title: null, body: '역 근처' } } }, 400],
    [{ body: { kind: 'post', id: ID, language: 'ko', source: { title: '방 렌트', body: '역 근처' } } }, 400], [{ usage: 200 }, 429],
  ]) {
    const result = await search(options);
    assert.equal(result.status, status, JSON.stringify(options));
    assert.equal(result.sent.length, 0);
    assert.ok(!result.rpcs.some(([name]) => name === 'put_content_translation'));
  }
});
