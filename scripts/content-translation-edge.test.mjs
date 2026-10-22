import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as core from '../supabase/functions/_shared/content-translation.ts';
import * as handler from '../supabase/functions/_shared/content-translation-handler.ts';

test('deployed Edge adapter reads posts and comments only with the current viewer JWT', async () => {
  const id = '10000000-0000-4000-8000-000000000001';
  const reads = [], cacheCalls = [];
  let serve, hidden = false;
  const source = { title: '원래 제목', body: '원래 본문' };
  const user = {
    auth: { getUser: async () => ({ data: { user: { id } }, error: null }) },
    from: table => {
      const read = { table, filters: [] }; reads.push(read);
      const query = {
        select: columns => { read.columns = columns; return query; },
        eq: (...values) => { read.filters.push(values); return query; },
        is: (...values) => { read.filters.push(values); return query; },
        maybeSingle: async () => ({ data: table === 'profiles' ? { account_status: 'active', ai_safety_consent_at: 'yes' }
          : hidden ? null : table === 'posts' ? source : { body: source.body }, error: null }),
      };
      return query;
    },
  };
  const cache = { from: () => { throw new Error('Service key must never read the source'); }, rpc: async (name, params) => {
    cacheCalls.push({ name, params });
    return { data: { state: 'cached', translation: { title: params.p_kind === 'comment' ? null : 'Original title', body: 'Original body' } }, error: null };
  } };
  const createClient = (_url, key, options) => {
    if (key === 'viewer-key') {
      assert.equal(options.global.headers.Authorization, 'Bearer viewer-only-token');
      assert.equal(options.auth.persistSession, false);
      return user;
    }
    assert.equal(key, 'server-only-key');
    assert.equal(options.auth.persistSession, false);
    return cache;
  };
  const script = ts.transpileModule(readFileSync(new URL('../supabase/functions/translate-content/index.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(script, {
    exports: {},
    Deno: { env: { get: key => ({ SUPABASE_URL: 'https://project.example.test', SUPABASE_ANON_KEY: 'viewer-key', SUPABASE_SERVICE_ROLE_KEY: 'server-only-key' })[key] }, serve: fn => { serve = fn; } },
    require: name => name.startsWith('npm:') ? { createClient } : name.endsWith('content-translation-handler.ts') ? handler : {
      ...core, generateContentTranslation: () => { throw new Error('No paid generation during a cache hit'); },
    },
  });
  for (const kind of ['post', 'comment']) {
    reads.length = 0;
    const response = await serve(new Request('https://project.example.test/translate-content', {
      method: 'POST', headers: { Authorization: 'Bearer viewer-only-token' },
      body: JSON.stringify({ kind, id, language: 'en', source: { title: kind === 'comment' ? null : source.title, body: source.body } }),
    }));
    assert.equal(response.status, 200);
    const sources = reads.filter(read => read.table !== 'profiles');
    assert.equal(sources.length, 2);
    assert.ok(sources.every(read => read.table === (kind === 'post' ? 'posts' : 'comments')));
    assert.ok(sources.every(read => read.filters.some(([name, value]) => name === 'id' && value === id)));
    assert.ok(sources.every(read => read.filters.some(([name, value]) => name === (kind === 'post' ? 'status' : 'deleted_at') && value === (kind === 'post' ? 'published' : null))));
  }
  hidden = true;
  const previous = cacheCalls.length;
  const response = await serve(new Request('https://project.example.test/translate-content', {
    method: 'POST', headers: { Authorization: 'Bearer viewer-only-token' },
    body: JSON.stringify({ kind: 'post', id, language: 'en', source }),
  }));
  assert.equal(response.status, 404);
  assert.equal(cacheCalls.length, previous);
});
