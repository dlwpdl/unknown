import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildVercelOutput } from '../infra/build-vercel-output.mjs';

const temporary = mkdtempSync(join(tmpdir(), 'gling-vercel-'));
after(() => rmSync(temporary, { recursive: true, force: true }));
const dist = join(temporary, 'dist'), output = join(temporary, 'output');
const files = ['index.html', 'post.html', '404.html', 'auth/callback.html', 'merchant/index.html', 'merchant/auth/callback.html', '_expo/app.js', 'share-redirect.js', 'share-covers/meetup.png'];
for (const file of files) { mkdirSync(join(dist, file, '..'), { recursive: true }); writeFileSync(join(dist, file), `fixture:${file}`); }
buildVercelOutput(dist, output);
const config = JSON.parse(readFileSync(join(output, 'config.json')));
const id = '123e4567-e89b-42d3-a456-426614174000';
const route = input => {
  const url = new URL(input, 'https://gling.ej-entertainment.com');
  const available = path => existsSync(join(output, 'static', path)) && statSync(join(output, 'static', path)).isFile();
  for (const rule of config.routes) {
    if (rule.handle === 'filesystem') { if (available(url.pathname)) return { dest: url.pathname, status: 200 }; continue; }
    if (rule.missing?.some(condition => url.searchParams.has(condition.key))) continue;
    const match = new RegExp(rule.src).exec(url.pathname); if (!match) continue;
    const dest = rule.dest.replace(/\$(\d+)/g, (_, index) => match[index]);
    if (rule.check && !available(dest)) continue;
    return { dest, status: rule.status ?? 200 };
  }
};

test('prebuilt output preserves static assets and routes while authentication stays on the primary site', () => {
  assert.equal(config.version, 3);
  for (const file of files) assert.equal(readFileSync(join(output, 'static', file), 'utf8'), `fixture:${file}`);
  for (const [path, dest] of [['/', '/index.html'], ['/post', '/post.html'], ['/post.html', '/post.html'], ['/merchant', '/merchant/index.html'], ['/merchant/', '/merchant/index.html'], ['/_expo/app.js', '/_expo/app.js']]) {
    assert.deepEqual(route(path), { dest, status: 200 }, path);
  }
  assert.deepEqual(route('/missing'), { dest: '/404.html', status: 404 });
  for (const path of ['/auth/callback', '/auth/callback.html', '/auth/kakao', '/merchant/auth/callback', '/merchant/auth/callback.html']) {
    assert.deepEqual(route(path), { dest: '/404.html', status: 404 });
  }
  assert.deepEqual(route('/_gling-share-preview'), { dest: '/404.html', status: 404 });
  assert.deepEqual(route(`/share/${id}?__gling_share_id=other`), { dest: '/404.html', status: 404 });
  const settings = JSON.parse(readFileSync(join(output, 'functions/_gling-share-preview.func/.vc-config.json')));
  assert.equal(settings.runtime, 'edge');
  assert.deepEqual(settings.envVarsInUse, ['APP_URL', 'SHARE_ORIGIN', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']);
  assert.ok(existsSync(join(output, 'functions/_gling-share-preview.func', settings.entrypoint)));
});

test('compiled Edge adapter retains the original or captured UUID and same-origin public boundary', async context => {
  const folder = join(output, 'functions/_gling-share-preview.func');
  const settings = JSON.parse(readFileSync(join(folder, '.vc-config.json')));
  const { default: handler } = await import(pathToFileURL(join(folder, settings.entrypoint)));
  const env = { APP_URL: 'https://gling.ej-entertainment.com', SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' };
  const before = Object.fromEntries([...Object.keys(env), 'SHARE_ORIGIN'].map(key => [key, process.env[key]]));
  delete process.env.SHARE_ORIGIN;
  Object.assign(process.env, env);
  context.after(() => { for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++; assert.equal(url, `${env.SUPABASE_URL}/rest/v1/rpc/get_shared_link_preview`);
    assert.deepEqual(JSON.parse(init.body), { p_post_id: id });
    assert.equal(init.headers.Authorization, undefined); assert.equal(init.headers.Cookie, undefined);
    return Response.json({ id, kind: 'meetup', title: 'Shared title', city: 'Vancouver', closed: false, body: 'PRIVATE-BODY', preciseLocation: 'PRIVATE-PLACE' });
  });
  const mapped = route(`/share/${id}?kind=post`);
  for (const url of [`${env.APP_URL}/share/${id}?__gling_share_id=wrong`, `${env.APP_URL}${mapped.dest}`]) {
    const response = await handler(new Request(url, { headers: { Authorization: 'Bearer caller-session', Cookie: 'private=1' } }));
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    const html = await response.text();
    assert.ok(html.includes(`${env.APP_URL}/share/${id}`));
    assert.ok(html.includes(`${env.APP_URL}/post?id=${id}&amp;shared=1&amp;invite=1`));
    assert.ok(html.includes(`${env.APP_URL}/share-redirect.js`)); assert.doesNotMatch(html, /PRIVATE-/);
  }
  process.env.SHARE_ORIGIN = 'https://gling-share-preview.vercel.app';
  const crossOrigin = await handler(new Request(`https://forged.example${mapped.dest}`));
  const crossHtml = await crossOrigin.text();
  assert.ok(crossHtml.includes(`https://gling-share-preview.vercel.app/share/${id}`));
  assert.ok(crossHtml.includes(`${env.APP_URL}/post?id=${id}&amp;shared=1&amp;invite=1`));
  assert.ok(crossHtml.includes(`${env.APP_URL}/share-redirect.js`));
  assert.doesNotMatch(crossHtml, /forged\.example/);
  assert.equal((await handler(new Request(`${env.APP_URL}/_gling-share-preview?__gling_share_id=${id}&__gling_share_id=wrong`))).status, 404);
  assert.equal((await handler(new Request(`${env.APP_URL}/share/${id}`, { method: 'POST' }))).status, 405);
  assert.equal(calls, 3);
});
