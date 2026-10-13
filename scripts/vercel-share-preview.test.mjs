import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, request as httpRequest } from 'node:http';
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
  assert.equal(settings.runtime, 'nodejs22.x');
  assert.equal(settings.launcherType, 'Nodejs');
  assert.equal(settings.handler, 'node-share-preview.js');
  assert.ok(existsSync(join(output, 'functions/_gling-share-preview.func', settings.handler)));
  assert.equal(JSON.parse(readFileSync(join(output, 'functions/_gling-share-preview.func/package.json'))).type, 'module');
});

test('compiled shared Web adapter retains the original or captured UUID and fixed-origin public boundary', async context => {
  const folder = join(output, 'functions/_gling-share-preview.func');
  const { default: handler } = await import(pathToFileURL(join(folder, 'vercel-share-preview.js')));
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

test('native Node HTTP adapter preserves HTML, HEAD,405 and request privacy', async context => {
  const folder = join(output, 'functions/_gling-share-preview.func');
  const settings = JSON.parse(readFileSync(join(folder, '.vc-config.json')));
  assert.equal(settings.handler, 'node-share-preview.js', 'native Node handler must be declared');
  const { default: handler } = await import(pathToFileURL(join(folder, settings.handler)));
  const env = { APP_URL: 'https://gling.ej-entertainment.com', SHARE_ORIGIN: 'https://gling-share-preview.vercel.app', SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  context.after(() => { for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++; assert.equal(url, `${env.SUPABASE_URL}/rest/v1/rpc/get_shared_link_preview`);
    assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(Object.keys(init.headers).sort(), ['Content-Type', 'apikey']);
    assert.equal(init.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
    return Response.json({ id, title: 'Shared title', kind: 'meetup', city: 'Vancouver', closed: false, body: 'PRIVATE-BODY' });
  });
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const send = (path, method = 'GET') => new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method, headers: { Host: 'evil.example', Authorization: 'Bearer PRIVATE-SESSION', Cookie: 'PRIVATE-COOKIE=1' } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    request.on('error', reject); request.end();
  });
  const get = await send(`/share/${id}`);
  assert.equal(get.status, 200); assert.equal(get.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(get.headers['cache-control'], 'no-store'); assert.equal(get.headers['x-frame-options'], 'DENY');
  assert.ok(get.body.includes(`${env.SHARE_ORIGIN}/share/${id}`));
  assert.ok(get.body.includes(`${env.APP_URL}/post?id=${id}&amp;shared=1&amp;invite=1`));
  assert.doesNotMatch(get.body, /PRIVATE-|evil\.example|127\.0\.0\.1/);
  const head = await send(`/share/${id}`, 'HEAD'); assert.equal(head.status, 200); assert.equal(head.body, '');
  for (const method of ['POST', 'DELETE', 'TRACE']) {
    const rejected = await send(`/share/${id}`, method); assert.equal(rejected.status, 405); assert.equal(rejected.headers.allow, 'GET, HEAD');
  }
  // Node parses CONNECT as a tunnel and rejects TRACK before the ordinary HTTP handler.
  for (const method of ['CONNECT', 'TRACK']) {
    const response = { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = body.toString(); } };
    await handler({ url: `/share/${id}`, method }, response);
    assert.equal(response.statusCode, 405); assert.equal(response.headers.allow, 'GET, HEAD');
    assert.equal(response.body, '지원하지 않는 요청이에요.');
  }
  assert.equal((await send(`https://evil.example/share/${id}`)).status, 404);
  assert.equal((await send(`//evil.example/share/${id}`)).status, 404);
  const rewritten = await send(route(`/share/${id}`).dest); assert.equal(rewritten.status, 200);
  assert.equal(calls, 3);
});
