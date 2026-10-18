import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import worker, { handleSharePreview } from '../infra/share-preview-worker.ts';

const id = '123e4567-e89b-42d3-a456-426614174000';
const short = 'Ej5FZ-ibQtOkVkJmFBdAAA';
const env = {
  APP_URL: 'https://gling.example',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
};
const preview = {
  id, title: '서울에서 <함께> & "가요"', kind: 'meetup', city: '밴쿠버', label: '같이 가요',
  schedule: { startsAt: '2026-10-18T02:00:00Z', endsAt: null, timezone: 'America/Vancouver', cadence: 'once' },
  imagePath: null, closed: false,
};
const request = (suffix = '', method = 'GET') => new Request(`https://gling.example/share/${id}${suffix}`, { method });
const json = (value, status = 200) => Response.json(value, { status });
const noFetch = async () => { throw new Error('must not fetch'); };

test('HTML carries escaped Korean OG metadata and invitation CTA without private content', async () => {
  const incoming = new Request(request('?next=https://evil.example&kind=post&invite=999'), { headers: { Authorization: 'Bearer caller-private-session', Cookie: 'caller-private-cookie=1' } });
  const response = await handleSharePreview(incoming, env, async (url, init) => {
    assert.equal(String(url), 'https://project.supabase.co/rest/v1/rpc/get_shared_link_preview');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.apikey, 'sb_publishable_fixture');
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.headers.Cookie, undefined);
    assert.deepEqual(JSON.parse(init.body), { p_post_id: id });
    return json({ ...preview, body: 'PRIVATE-BODY', comments: ['PRIVATE-COMMENT'], reviewer: 'PRIVATE-REVIEWER', preciseLocation: 'PRIVATE-PLACE' });
  });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(response.headers.get('content-security-policy').includes('script-src https://gling.example;'));
  assert.ok(html.includes('<meta property="og:title" content="서울에서 &lt;함께&gt; &amp; &quot;가요&quot;">'));
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(html.includes('https://gling.example/share-covers/meetup.png'));
  assert.ok(html.includes('https://gling.example/post?id=' + id + '&amp;shared=1&amp;invite=1'));
  assert.ok(html.includes('로그인'));
  assert.ok(html.includes('2026'));
  assert.doesNotMatch(html, /PRIVATE-|evil\.example|invite=999|서울에서 <함께>/);
});

test('gateway immediately continues through one fixed same-origin script and retains raw OG metadata', async () => {
  const response = await handleSharePreview(request(), env, async () => json({ ...preview, title: '</h1><script src="https://attack.example/x.js"></script>' }));
  const html = await response.text();
  assert.ok(html.includes(`<a id="share-primary-cta" class="cta" href="https://gling.example/post?id=${id}&amp;shared=1&amp;invite=1">`));
  assert.ok(html.includes('<script src="https://gling.example/share-redirect.js" defer></script>'));
  assert.equal((html.match(/<script\b/g) || []).length, 1);
  assert.ok(html.indexOf('<meta property="og:title"') < html.indexOf('<script src='));
  assert.ok(html.includes('&lt;script src=&quot;https://attack.example/x.js&quot;&gt;'));
  assert.doesNotMatch(html, /<script src="https:\/\/attack\.example/);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /script-src[^;]*unsafe-inline/);
});

test('recurring meetup cards show cadence while one-off cards show their date', async () => {
  for (const [eventKind, expected] of [['group', '매주 토요일'], ['once', '2026']]) {
    const response = await handleSharePreview(request(), env, async () => json({ ...preview, schedule: { ...preview.schedule, eventKind, cadence: '매주 토요일' } }));
    const html = await response.text();
    assert.ok(html.includes(expected));
    assert.equal(html.includes('2026'), eventKind === 'once');
    assert.equal(html.includes('매주 토요일'), eventKind === 'group');
  }
});

const redirectScript = () => fs.readFileSync(new URL('../public/share-redirect.js', import.meta.url), 'utf8');
function runRedirect(href, options = {}) {
  const replacements = [];
  const location = { origin: 'https://gling.ej-entertainment.com', href: `https://gling.ej-entertainment.com/share/${id}`, pathname: `/share/${id}`, replace: value => replacements.push(value), ...options.location };
  const anchor = options.missing ? null : { tagName: options.tagName || 'A', href };
  vm.runInNewContext(redirectScript(), {
    URL, btoa, atob,
    document: { getElementById: name => { assert.equal(name, 'share-primary-cta'); return anchor; } },
    location,
  });
  return replacements;
}

test('static continuation script preserves the same-origin UUID and invitation intent', () => {
  for (const suffix of ['&shared=1', '&shared=1&invite=1']) {
    const href = `https://gling.ej-entertainment.com/post?id=${id}${suffix}`;
    assert.deepEqual(runRedirect(href), [href]);
  }
});

test('a configured preview origin changes only canonical metadata, never login or asset destinations', async () => {
  const configured = { ...env, APP_URL: 'https://gling.ej-entertainment.com', SHARE_ORIGIN: 'https://gling-share-preview.vercel.app' };
  const response = await handleSharePreview(new Request(`https://evil.example/share/${id}?APP_URL=https://evil.example&SHARE_ORIGIN=https://evil.example`), configured, async () => json(preview));
  const html = await response.text();
  assert.ok(html.includes(`<link rel="canonical" href="${configured.SHARE_ORIGIN}/share/${id}">`));
  assert.ok(html.includes(`<meta property="og:url" content="${configured.SHARE_ORIGIN}/share/${id}">`));
  assert.ok(html.includes(`${configured.APP_URL}/post?id=${id}&amp;shared=1&amp;invite=1`));
  assert.ok(html.includes(`${configured.APP_URL}/share-covers/meetup.png`));
  assert.ok(html.includes(`${configured.APP_URL}/share-redirect.js`));
  assert.doesNotMatch(response.headers.get('content-security-policy'), /vercel\.app|evil\.example/);
  assert.doesNotMatch(html, /evil\.example/);
  for (const origin of ['http://gling-share-preview.vercel.app', 'https://gling-share-preview.vercel.app/path', 'https://user:password@gling-share-preview.vercel.app', 'https://gling-share-preview.vercel.app?next=1']) {
    assert.equal((await handleSharePreview(request(), { ...configured, SHARE_ORIGIN: origin }, noFetch)).status, 503);
  }
});

test('cross-origin continuation trusts only the fixed Gling app and exact shared UUID', () => {
  const app = 'https://gling.ej-entertainment.com', gateway = 'https://gling-share-preview.vercel.app';
  const options = { location: { origin: gateway, href: `${gateway}/share/${id}` } };
  for (const suffix of ['&shared=1', '&shared=1&invite=1']) {
    const target = `${app}/post?id=${id}${suffix}`;
    assert.deepEqual(runRedirect(target, options), [target]);
  }
  for (const target of [`${gateway}/post?id=${id}&shared=1`, `https://gling.ej-entertainment.com.evil.example/post?id=${id}&shared=1`, `https://user:password@gling.ej-entertainment.com/post?id=${id}&shared=1`, `${app}/post?id=123e4567-e89b-42d3-a456-426614174999&shared=1`, `${app}/post?id=${id}&shared=1&next=https://evil.example`]) {
    assert.deepEqual(runRedirect(target, options), []);
  }
});

test('static continuation rejects external, forged and ambiguous destinations', () => {
  for (const href of [
    `https://evil.example/post?id=${id}&shared=1`, `https://gling.ej-entertainment.com.evil.example/post?id=${id}&shared=1`,
    `http://gling.ej-entertainment.com/post?id=${id}&shared=1`, `https://user:pass@gling.ej-entertainment.com/post?id=${id}&shared=1`,
    `https://gling.ej-entertainment.com/admin?id=${id}&shared=1`, `https://gling.ej-entertainment.com/post/private?id=${id}&shared=1`,
    'https://gling.ej-entertainment.com/post?id=not-a-uuid&shared=1', `https://gling.ej-entertainment.com/post?id=${id}&id=${id}&shared=1`,
    `https://gling.ej-entertainment.com/post?id=${id}&shared=1&next=https://evil.example`, `https://gling.ej-entertainment.com/post?id=${id}&shared=1#redirect`,
    `https://gling.ej-entertainment.com/post?id=${id}&shared=1&invite=999`, `https://gling.ej-entertainment.com/post?id=${id}&shared=1&shared=1`,
    `https://gling.ej-entertainment.com/post?id=123e4567-e89b-42d3-a456-426614174999&shared=1`, `javascript:alert(1)`,
  ]) {
    assert.deepEqual(runRedirect(href), [], href);
    assert.deepEqual(runRedirect(href, { location: { pathname: `/s/${short}` } }), [], href);
  }
  const valid = `https://gling.ej-entertainment.com/post?id=${id}&shared=1`;
  assert.deepEqual(runRedirect(valid, { missing: true }), []);
  assert.deepEqual(runRedirect(valid, { tagName: 'DIV' }), []);
  assert.deepEqual(runRedirect(valid, { location: { pathname: '/forged' } }), []);
});

test('every kind gets its own cover and fixed same-origin destination', async () => {
  for (const kind of ['post', 'festival', 'meetup']) {
    const response = await handleSharePreview(new Request(`https://evil.example/share/${id}?next=https://evil.example`), env, async () => json({ ...preview, kind }));
    const html = await response.text();
    assert.ok(html.includes(`https://gling.example/share-covers/${kind}.png`));
    assert.ok(html.includes(`<meta property="og:url" content="https://gling.example/share/${id}">`));
    assert.equal(html.includes('&amp;invite=1'), kind === 'meetup');
    assert.doesNotMatch(html, /evil\.example/);
  }
});

test('only the returned post-images cover can be signed on the configured Supabase origin', async () => {
  let count = 0;
  const response = await handleSharePreview(request(), env, async (url, init) => {
    if (count++ === 0) return json({ ...preview, imagePath: 'owner/cover.jpg' });
    assert.equal(String(url), 'https://project.supabase.co/storage/v1/object/sign/post-images/owner/cover.jpg');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
    assert.deepEqual(JSON.parse(init.body), { expiresIn: 86400 });
    return json({ signedURL: '/object/sign/post-images/owner/cover.jpg?token=signed' });
  });
  const html = await response.text();
  assert.equal(count, 2);
  assert.ok(html.includes('https://project.supabase.co/storage/v1/object/sign/post-images/owner/cover.jpg?token=signed'));
});

test('invalid cover paths never trigger a second request', async () => {
  for (const imagePath of ['https://evil.example/cover.jpg', '../private.jpg', 'owner/../private.jpg', '/other-bucket/a.jpg', 'owner/%2e%2e/private.jpg', 'owner/a.jpg?x=1', 'owner\\private.jpg']) {
    let count = 0;
    const response = await handleSharePreview(request(), env, async () => {
      count++;
      return json({ ...preview, imagePath });
    });
    assert.equal(count, 1, imagePath);
    assert.ok((await response.text()).includes('/share-covers/meetup.png'));
  }
});

test('external or wrong signed paths and signing failure fall back to the source-owned cover', async () => {
  for (const signed of [json({ signedURL: 'https://evil.example/photo.jpg' }), json({ signedURL: '/object/sign/post-images/another/private.jpg?token=x' }), json({}, 403), new Error('offline')]) {
    let count = 0;
    const response = await handleSharePreview(request(), env, async () => {
      if (count++ === 0) return json({ ...preview, imagePath: 'owner/cover.jpg' });
      if (signed instanceof Error) throw signed;
      return signed;
    });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.ok(html.includes('/share-covers/meetup.png'));
    assert.doesNotMatch(html, /evil\.example|another\/private/);
  }
});

test('bad origins, secret keys and non-UUID routes fail before any network access', async () => {
  for (const field of ['APP_URL', 'SUPABASE_URL']) {
    for (const value of ['http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://example.com/private', 'https://user:pass@example.com', 'https://example.com/?next=evil', 'https://example.com/#fragment']) {
      const response = await handleSharePreview(request(), { ...env, [field]: value }, noFetch);
      assert.equal(response.status, 503, field + ': ' + value);
    }
  }
  for (const key of ['', 'sb_secret_notpublic', 'not-a-publishable-key']) {
    assert.equal((await handleSharePreview(request(), { ...env, SUPABASE_PUBLISHABLE_KEY: key }, noFetch)).status, 503);
  }
  for (const path of ['/share/not-a-uuid', '/share/https://evil.example', '/share/' + id + '/private', '/share/' + id + '%2fprivate', '/post?id=' + id]) {
    assert.equal((await handleSharePreview(new Request('https://gling.example' + path), env, noFetch)).status, 404, path);
  }
});

test('the legacy anon JWT is accepted while a service-role JWT is rejected', async () => {
  const jwt = role => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'signature'].join('.');
  assert.equal((await handleSharePreview(request(), { ...env, SUPABASE_PUBLISHABLE_KEY: jwt('service_role') }, noFetch)).status, 503);
  const key = jwt('anon');
  const response = await handleSharePreview(request(), { ...env, SUPABASE_PUBLISHABLE_KEY: key }, async (_url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    return json(preview);
  });
  assert.equal(response.status, 200);
});

test('empty or hidden RPC results produce a generic 404 and malformed results fail closed', async () => {
  for (const value of [null, [], { ...preview, kind: 'private' }, { ...preview, id: 'other-id' }, { ...preview, title: null }, { ...preview, closed: 'false' }]) {
    const response = await handleSharePreview(request(), env, async () => json(value));
    assert.equal(response.status, value === null ? 404 : 503);
    assert.doesNotMatch(await response.text(), /서울에서|PRIVATE|private/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('upstream network, status and JSON failures return 503 without backend details', async () => {
  for (const fetcher of [async () => { throw new Error('SECRET-UPSTREAM-DETAIL'); }, async () => json({ error: 'SECRET-UPSTREAM-DETAIL' }, 403), async () => new Response('SECRET-UPSTREAM-DETAIL')]) {
    const response = await handleSharePreview(request(), env, fetcher);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /SECRET/);
  }
});

test('503 diagnostic logs contain only fixed stages and a numeric upstream status', async context => {
  const logs = [];
  context.mock.method(console, 'warn', line => logs.push(JSON.parse(line)));
  const secret = 'PRIVATE-KEY-TOKEN-CONTENT';
  const failures = [
    ['APP_ORIGIN', { ...env, APP_URL: `https://user:${secret}@gling.example` }, noFetch],
    ['SHARE_ORIGIN', { ...env, SHARE_ORIGIN: `https://share.example/?${secret}` }, noFetch],
    ['SUPABASE_ORIGIN', { ...env, SUPABASE_URL: `https://user:${secret}@project.supabase.co` }, noFetch],
    ['PUBLISHABLE_KEY', { ...env, SUPABASE_PUBLISHABLE_KEY: secret }, noFetch],
    ['PREVIEW_FETCH', env, async () => { throw new Error(secret); }],
    ['UPSTREAM_STATUS', env, async () => new Response(secret, { status: 401 })],
    ['PREVIEW_JSON', env, async () => new Response(secret)],
    ['PREVIEW_SCHEMA', env, async () => json({ ...preview, id: secret, body: secret })],
  ];
  for (const [stage, configured, fetcher] of failures) {
    assert.equal((await handleSharePreview(request(), configured, fetcher)).status, 503);
    assert.deepEqual(logs.at(-1), { event: 'share_preview_unavailable', stage, ...(stage === 'UPSTREAM_STATUS' ? { status: 401 } : {}), ...(stage === 'PREVIEW_FETCH' ? { error_kind: 'OTHER' } : {}) });
  }
  context.mock.method(AbortSignal, 'timeout', () => { throw new Error(secret); });
  assert.equal((await handleSharePreview(request(), env, noFetch)).status, 503);
  assert.deepEqual(logs.at(-1), { event: 'share_preview_unavailable', stage: 'PREVIEW_TIMEOUT' });
  assert.equal(logs.length, failures.length + 1);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE-|https:|123e4567|APP_URL|SUPABASE_PUBLISHABLE_KEY/);
});

test('fetch diagnostics classify transport and timeout failures without exposing exception data', async context => {
  const logs = [], secret = 'PRIVATE-ERROR-URL-TOKEN';
  context.mock.method(console, 'warn', line => logs.push(JSON.parse(line)));
  for (const [error, kind] of [[new TypeError(secret), 'NETWORK'], [new DOMException(secret, 'TimeoutError'), 'TIMEOUT'], [new DOMException(secret, 'AbortError'), 'TIMEOUT'], [{ name: secret, message: secret, cause: { code: secret } }, 'OTHER']]) {
    assert.equal((await handleSharePreview(request(), env, async () => { throw error; })).status, 503);
    assert.deepEqual(logs.at(-1), { event: 'share_preview_unavailable', stage: 'PREVIEW_FETCH', error_kind: kind });
  }
  context.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort(secret));
  assert.equal((await handleSharePreview(request(), env, async () => { throw new Error(secret); })).status, 503);
  assert.equal(logs.at(-1).error_kind, 'TIMEOUT');
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE-|https:|123e4567|message|cause/);
});

test('HEAD has metadata headers but no body, methods are bounded and malformed dates remain safe', async () => {
  const head = await handleSharePreview(request('', 'HEAD'), env, async () => json(preview));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await head.text(), '');
  const post = await handleSharePreview(request('', 'POST'), env, noFetch);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  const closed = await handleSharePreview(request(), env, async () => json({ ...preview, closed: true, schedule: { startsAt: 'bad-date', timezone: '<script>' } }));
  const html = await closed.text();
  assert.ok(html.includes('모집 마감'));
  assert.doesNotMatch(html, /Invalid Date|bad-date|<script>/);
  assert.equal(typeof worker.fetch, 'function');
});

test('short gateway routes preserve the legacy preview, privacy headers and UUID RPC input', async () => {
  const gateway = 'https://gling-share-preview.vercel.app';
  const configured = { ...env, SHARE_ORIGIN: gateway };
  let calls = 0;
  const fetcher = async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(init.body), { p_post_id: id });
    assert.equal(init.headers.Authorization, undefined); assert.equal(init.headers.Cookie, undefined);
    return json({ ...preview, body: 'PRIVATE-BODY' });
  };
  const legacy = await handleSharePreview(request(), configured, fetcher);
  const compact = await handleSharePreview(new Request(`${gateway}/s/${short}/?token=PRIVATE-TOKEN`, { headers: { Authorization: 'Bearer PRIVATE-SESSION', Cookie: 'private=1' } }), configured, fetcher);
  assert.equal(compact.status, 200);
  assert.deepEqual([...compact.headers], [...legacy.headers]);
  assert.equal((await compact.text()).replaceAll(`/s/${short}`, `/share/${id}`), await legacy.text());
  const head = await handleSharePreview(new Request(`${gateway}/s/${short}`, { method: 'HEAD' }), configured, fetcher);
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal(calls, 3);
  for (const invalid of [short.slice(0, -1) + 'B', short + '=', short.slice(1), short + 'A', short.replace('-', '+'), '%45' + short.slice(1), id, short + '/private']) {
    assert.equal((await handleSharePreview(new Request(`${gateway}/s/${invalid}`), configured, noFetch)).status, 404, invalid);
  }
});

test('static continuation matches canonical short UUIDs and rejects aliases or mismatched posts', () => {
  const href = `https://gling.ej-entertainment.com/post?id=${id}&shared=1&invite=1`;
  for (const path of [`/s/${short}`, `/s/${short}/`]) assert.deepEqual(runRedirect(href, { location: { origin: 'https://gling-share-preview.vercel.app', href: `https://gling-share-preview.vercel.app${path}`, pathname: path } }), [href]);
  for (const value of [short.slice(0, -1) + 'B', short + '=', short.slice(1), short + 'A', '%45' + short.slice(1), short + '/private']) assert.deepEqual(runRedirect(href, { location: { pathname: `/s/${value}` } }), []);
  assert.deepEqual(runRedirect(href.replace(id, '123e4567-e89b-42d3-a456-426614174999'), { location: { pathname: `/s/${short}` } }), []);
});
