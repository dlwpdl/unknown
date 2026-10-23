import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { toQR } from 'toqr';
import { sharedLinkTarget } from '../src/lib/sharing.ts';
import { publicWebTarget, publicWebFetch, publicMerchantId } from '../src/lib/public-web.ts';

const id = '12345678-1234-1234-1234-123456789abc';
test('only public post identifiers survive web to app handoff', () => {
  assert.equal(publicWebTarget('/post', id), `gling://post/${id}`);
  assert.equal(publicWebTarget(`/post/${id}`), `gling://post/${id}`);
  assert.equal(publicWebTarget('/chat', 'secret'), 'gling://chat');
  assert.equal(publicWebTarget('/profile/settings'), 'gling://');
  assert.equal(publicWebTarget('/post', 'https://evil.example'), 'gling://');
  assert.equal(publicWebTarget('/meetup-create'), 'gling://meetup-create');
});
test('public transport rejects writes and always uses anonymous credentials', async () => {
  const requests = [];
  const request = publicWebFetch('https://example.supabase.co', 'public-key', async (url, init) => {
    requests.push({ url, init }); return new Response('{}');
  });
  await request('https://example.supabase.co/rest/v1/rpc/get_public_post', {
    method: 'POST', headers: { Authorization: 'Bearer stored-user-token' }, body: '{}',
  });
  assert.equal(new Headers(requests[0].init.headers).get('Authorization'), 'Bearer public-key');
  await request('https://example.supabase.co/rest/v1/rpc/get_merchant_post_source', { method: 'POST', body: '{}' });
  await request('https://example.supabase.co/rest/v1/rpc/get_public_post_businesses', { method: 'POST', body: '{}' });
  await assert.rejects(() => request('https://example.supabase.co/rest/v1/rpc/record_merchant_source_click', { method: 'POST' }));
  await assert.rejects(() => request('https://example.supabase.co/rest/v1/rpc/send_message', { method: 'POST' }));
  for (const rpc of ['get_admin_user_businesses', 'change_profile_nickname', 'send_suggested_message', 'write_manner_review', 'get_my_manner_feedback', 'get_admin_trust_content', 'get_trust_safety_content', 'get_message_safety_context']) {
    await assert.rejects(request(`https://example.supabase.co/rest/v1/rpc/${rpc}`, { method: 'POST', body: '{}' }), /PUBLIC_WEB_READ_ONLY/);
  }
  await assert.rejects(() => request('https://example.supabase.co/auth/v1/token', { method: 'POST' }));
  await assert.rejects(() => request('https://other.example/rest/v1/rpc/get_public_post', { method: 'POST' }));
  assert.equal(requests.length, 3);
});

test('company query and path routes accept only a canonical UUID and hand off to the company screen', () => {
  assert.equal(publicMerchantId('/company', id), id);
  assert.equal(publicMerchantId('/company', id.toUpperCase()), id);
  assert.equal(publicMerchantId(`/company/${id}`), id);
  assert.equal(publicMerchantId('/company', 'https://evil.test'), null);
  assert.equal(publicMerchantId('/company', [id]), null);
  assert.equal(publicMerchantId('/profile', id), null);
  assert.equal(publicMerchantId(`/company/${id}/private`), null);
  assert.equal(publicWebTarget('/company', id), `gling://company/${id}`);
  assert.equal(publicWebTarget(`/company/${id}`), `gling://company/${id}`);
  assert.equal(publicWebTarget('/company', 'bad'), 'gling://');
});

test('company profile transport permits anonymous public getters and only saved profile image signing', async () => {
  const calls = [];
  const request = publicWebFetch('https://example.supabase.co', 'public-key', async (url, init) => { calls.push({ url, init }); return new Response('{}'); });
  for (const path of ['/rest/v1/rpc/get_merchant_profile', '/rest/v1/rpc/get_merchant_reviews', '/rest/v1/rpc/get_merchant_profile_posts', '/storage/v1/object/sign/merchant-profile-images']) {
    await request(`https://example.supabase.co${path}`, { method: 'POST', headers: { Authorization: 'Bearer private-user' }, body: '{}' });
  }
  for (const path of ['/rest/v1/rpc/get_my_merchant_profile', '/rest/v1/rpc/save_my_merchant_profile', '/rest/v1/rpc/get_my_merchant_reviews', '/rest/v1/rpc/write_merchant_review', '/rest/v1/rpc/get_admin_merchant_review_content', '/rest/v1/rpc/get_admin_merchant_receipt_reviews', '/rest/v1/rpc/set_admin_merchant_review_receipt', '/storage/v1/object/sign/merchant-review-receipts', '/storage/v1/object/merchant-profile-images']) {
    await assert.rejects(request(`https://example.supabase.co${path}`, { method: 'POST', body: '{}' }), /PUBLIC_WEB_READ_ONLY/);
  }
  await assert.rejects(request('https://example.supabase.co/rest/v1/rpc/get_merchant_profile', { method: 'GET' }), /PUBLIC_WEB_READ_ONLY/);
  await assert.rejects(request('https://other.example/rest/v1/rpc/get_merchant_profile', { method: 'POST' }), /PUBLIC_WEB_READ_ONLY/);
  await assert.rejects(request('https://example.supabase.co/rest/v1/rpc/get_merchant_profile_posts', { method: 'GET' }), /PUBLIC_WEB_READ_ONLY/);
  await assert.rejects(request('https://example.supabase.co/rest/v1/rpc/get_merchant_profile_posts_private', { method: 'POST' }), /PUBLIC_WEB_READ_ONLY/);
  await assert.rejects(request('https://other.example/rest/v1/rpc/get_merchant_profile_posts', { method: 'POST' }), /PUBLIC_WEB_READ_ONLY/);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(({ init }) => new Headers(init.headers).get('Authorization') === 'Bearer public-key' && init.credentials === 'omit'));
});

test('public city catalog permits only the exact anonymous read and retains transport boundaries', async () => {
  const calls = [];
  const request = publicWebFetch('https://example.supabase.co', 'public-key', async (url, init) => { calls.push({ url, init }); return new Response('{}'); });
  await request('https://example.supabase.co/rest/v1/rpc/get_city_place_catalog', { method: 'POST', body: '{}', credentials: 'include', headers: { Authorization: 'Bearer private-user' } });
  assert.equal(calls.length, 1);
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer public-key');
  assert.equal(calls[0].init.credentials, 'omit');
  for (const path of ['/rest/v1/rpc/get_city_place_catalog_private', '/rest/v1/rpc/save_city_place_catalog', '/rest/v1/city_place_catalog']) {
    await assert.rejects(request(`https://example.supabase.co${path}`, { method: 'POST', body: '{}' }), /PUBLIC_WEB_READ_ONLY/);
  }
  await assert.rejects(request('https://example.supabase.co/rest/v1/rpc/get_city_place_catalog', { method: 'GET' }), /PUBLIC_WEB_READ_ONLY/);
  await assert.rejects(request('https://other.example/rest/v1/rpc/get_city_place_catalog', { method: 'POST', body: '{}' }), /PUBLIC_WEB_READ_ONLY/);
  assert.equal(calls.length, 1);
});

test('shared preview permits the exact anonymous getter while retaining the public transport boundary', async () => {
  const calls=[];const request=publicWebFetch('https://example.supabase.co','public-key',async(url,init)=>{calls.push({url,init});return new Response('{}');});
  await request('https://example.supabase.co/rest/v1/rpc/get_shared_link_preview',{method:'POST',credentials:'include',headers:{Authorization:'Bearer private-user'},body:'{}'});
  assert.equal(calls.length,1);assert.equal(calls[0].init.credentials,'omit');assert.equal(new Headers(calls[0].init.headers).get('Authorization'),'Bearer public-key');
  for(const name of ['get_shared_link_preview_private','get_shared_link_preview/extra','set_shared_link_preview'])await assert.rejects(request(`https://example.supabase.co/rest/v1/rpc/${name}`,{method:'POST'}),/PUBLIC_WEB_READ_ONLY/);
  await assert.rejects(request('https://other.example/rest/v1/rpc/get_shared_link_preview',{method:'POST'}),/PUBLIC_WEB_READ_ONLY/);
  await assert.rejects(request('https://example.supabase.co/rest/v1/rpc/get_shared_link_preview',{method:'GET'}),/PUBLIC_WEB_READ_ONLY/);
});


// renderToStaticMarkup uses the same getServerSnapshot contract as initial hydration.
// The mounted pass supplies browser snapshots; actual browser hydration is verified separately.
function readerMarkup(path, { mounted = false, search = '', directPost = false } = {}) {
  const dark = {}, window = { location: { pathname: path, search } };
  const hooks = mounted ? { ...React, useSyncExternalStore: (_subscribe, snapshot) => snapshot() } : React;
  const modules = {
    react: hooks, 'react/jsx-runtime': jsxRuntime,
    'expo-router': { usePathname: () => path, useLocalSearchParams: () => Object.fromEntries(new URLSearchParams(search)) },
    'expo-router/head': { __esModule: true, default: React.Fragment },
    'expo-asset': { Asset: { fromModule: () => ({ uri: 'local-wordmark' }) } }, toqr: { toQR },
    '@/constants/theme': { WebNightColors: {}, Colors: { dark }, Spacing: { three: 12, four: 16 } },
    '@/constants/design-system': { ControlMetrics: { touch: 44, action: 48 }, Typography: { sheetTitle: { fontSize: 22 }, menu: { fontSize: 16 } } },
    '@/hooks/use-language': { useLanguage: () => ({ language: 'ko', tr: value => value }) },
    '@/hooks/use-theme': { useTheme: () => dark },
    '@/lib/interaction-feedback': { InteractionFeedbackProvider: React.Fragment, useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버', state: 'open' }], TAGS: [] },
    '@/lib/public-web': { publicMerchantId, publicWebTarget },
    '@/lib/sharing': { sharedLinkTarget },
    '@/lib/public-seo': { PUBLIC_SITE: 'https://gling.ej-entertainment.com', jsonLd: JSON.stringify },
    '@/lib/public-web-client': { publicWebClient: {} },
    './analytics': { useReaderAnalytics() {} },
  };
  function load(file) {
    const exports = {};
    const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, { exports, window, URLSearchParams, require: name => modules[name] ?? {} });
    return exports;
  }
  const landing = load('../src/components/public-web/shared-post-landing.tsx');
  modules['./shared-post-landing'] = { __esModule: true, default: landing.default };
  const component = directPost ? landing.default : load('../src/components/public-web/reader.tsx').default;
  return renderToStaticMarkup(React.createElement(component));
}

test('legacy static 404 and initial client render agree before the exact post handoff mounts', () => {
  const fallback = readerMarkup('/+not-found');
  assert.match(fallback, /앱에서 이어가세요/);
  for (const path of [`/share/${id}`, `/post/${id}`]) {
    const initialClient = readerMarkup(path);
    assert.ok(initialClient === fallback, `${path} must hydrate the static 404 markup before selecting its shared landing`);
    const mounted = readerMarkup(path, { mounted: true });
    assert.match(mounted, /class="shared-post-landing"/);
    assert.ok(mounted.includes(`href="gling://post/${id}"`), 'Mounted legacy route preserves the original native post destination');
    assert.ok(mounted.includes(`https://gling.ej-entertainment.com/post?id=${id}`), 'QR/copy canonical destination preserves that same post');
    assert.doesNotMatch(mounted, /Google로 로그인|카카오 로그인/);
  }
});

test('canonical post document retains its direct landing SSR and mounted post destination', () => {
  const options = { search: `?id=${id}` };
  assert.equal(readerMarkup('/post', options), readerMarkup('/post', { ...options, directPost: true }));
  assert.match(readerMarkup('/post', options), /class="shared-post-landing"/);
  assert.ok(readerMarkup('/post', { ...options, mounted: true }).includes(`href="gling://post/${id}"`));
  assert.match(readerMarkup('/'), /큰 페스티벌부터/);
});
