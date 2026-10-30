import assert from 'node:assert/strict';
import * as meetupSections from '../src/lib/meetup-sections.ts';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { toQR } from 'toqr';
import { sharedLinkTarget } from '../src/lib/sharing.ts';
import { publicCitySubpage, publicCitySubpageMeta, publicPostDescription, publicPostSchema, publicSiteName } from '../src/lib/public-seo.ts';
import { instagramPostLink, splitPostAttachments, splitPostLinks } from '../supabase/functions/_shared/post-links.ts';
import { publicWebTarget, publicWebFetch, publicMerchantId } from '../src/lib/public-web.ts';
import { ControlMetrics, ControlMotion, Typography } from '../src/constants/design-system.ts';
import { translationSource } from './test-meetup-source-imports.mjs';

const id = '12345678-1234-1234-1234-123456789abc';
test('only public post identifiers survive web to app handoff', () => {
  assert.equal(publicWebTarget('/post', id), `gling://post/${id}`);
  assert.equal(publicWebTarget(`/post/${id}`), `gling://post/${id}`);
  assert.equal(publicWebTarget('/chat', 'secret'), 'gling://chat');
  assert.equal(publicWebTarget('/profile/settings'), 'gling://');
  assert.equal(publicWebTarget('/post', 'https://evil.example'), 'gling://');
  assert.equal(publicWebTarget('/meetup-create'), 'gling://meetup-create');
});
test('web meetup invitations continue in the app with only a validated post identifier', () => {
  assert.equal(publicWebTarget('/meetup-join', id), `gling://meetup-join?postId=${id}`);
  for (const value of [undefined, 'secret', `${id}&action=join`, 'https://evil.example']) {
    assert.equal(publicWebTarget('/meetup-join', value), 'gling://meetups');
  }
  assert.equal(publicWebTarget('/meetup-join', undefined, { postId: id }), `gling://meetup-join?postId=${id}`);
  assert.equal(publicWebTarget('/meetup-profile', undefined, { postId: id, userId: id, returnPostId: id, email: 'private@example.com' }), `gling://meetup-profile?postId=${id}&userId=${id}&returnPostId=${id}`);
  assert.equal(publicWebTarget('/meetup-application', undefined, { requestId: id, approve: 'true' }), `gling://meetup-application?requestId=${id}`);
  assert.equal(publicWebTarget('/meetup-application', undefined, { requestId: 'bad' }), 'gling://chat');
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
function readerMarkup(path, { mounted = false, search = '', directPost = false, articlePost = null, language = 'ko' } = {}) {
  const dark = {}, window = { location: { pathname: path, search } };
  const hooks = mounted ? { ...React, useSyncExternalStore: (_subscribe, snapshot) => snapshot() } : React;
  const modules = {
    react: hooks, 'react/jsx-runtime': jsxRuntime,
    'expo-router': { usePathname: () => path, useLocalSearchParams: () => Object.fromEntries(new URLSearchParams(search)) },
    'expo-router/head': { __esModule: true, default: React.Fragment },
    'expo-asset': { Asset: { fromModule: () => ({ uri: 'local-wordmark' }) } }, toqr: { toQR },
    '@/constants/theme': { WebNightColors: {}, Colors: { dark }, Spacing: { two: 8, three: 12, four: 16 } },
    '@/constants/design-system': { ControlMetrics, ControlMotion, Typography },
    '@/hooks/use-language': { useLanguage: () => ({ language, locale: language === 'ko' ? 'ko-KR' : 'en-CA', tr: value => value }) },
    '@/hooks/use-theme': { useTheme: () => dark },
    '@/lib/auth': { useAuth: () => ({ isAuthed: false, isAuthLoading: false, me: { id: 'guest' } }) },
    '@/hooks/use-content-visibility': { useContentVisibility: () => () => false },
    '../../../supabase/functions/_shared/post-links': { instagramPostLink, splitPostAttachments, splitPostLinks },
    '@/components/post-attachment-link': { PostAttachmentLink: () => null },
    '@/lib/post-maps': { postMapBody: body => ({ body }) }, '@/lib/meetup-sections': meetupSections, '@/lib/translation-source': translationSource,
    '@/lib/chilling': { chillingSchedule: () => '공개 일정' },
    '@/lib/interaction-feedback': { InteractionFeedbackProvider: React.Fragment, useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버', state: 'open' }], TAGS: [] },
    '@/lib/public-web': { publicMerchantId, publicWebTarget },
    '@/lib/sharing': { sharedLinkTarget },
    '@/lib/public-seo': { PUBLIC_SITE: 'https://gling.ej-entertainment.com', jsonLd: JSON.stringify, publicSiteName, publicCitySubpage, publicCitySubpageMeta, publicPostDescription, publicPostSchema },
    './static-slot': { adoptStatic: () => () => {} }, './metadata': { publicHomeSchema: { '@type': 'WebSite' } },
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
  const article = load('../src/components/public-web/shared-post-article.tsx');
  modules['./shared-post-article'] = article;
  const landing = load('../src/components/public-web/shared-post-landing.tsx');
  modules['./shared-post-landing'] = { __esModule: true, default: landing.default };
  modules['./app-store-choices'] = load('../src/components/public-web/app-store-choices.tsx');
  modules['./meetup-list'] = load('../src/components/public-web/meetup-list.tsx');
  const component = articlePost ? article.SharedPostArticle : directPost ? landing.default : load('../src/components/public-web/reader.tsx').default;
  return renderToStaticMarkup(React.createElement(component, articlePost ? { post: articlePost } : undefined));
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
    assert.ok(mounted.includes(`https://gling.ej-entertainment.com/posts/${id}`), 'QR/copy canonical destination preserves that same post');
    assert.doesNotMatch(mounted, /Google로 로그인|카카오 로그인/);
  }
});

test('canonical post document retains its direct landing SSR and mounted post destination', () => {
  const options = { search: `?id=${id}` };
  assert.equal(readerMarkup('/post', options), readerMarkup('/post', { ...options, directPost: true }));
  assert.match(readerMarkup('/post', options), /class="shared-post-landing"/);
  assert.ok(readerMarkup('/post', { ...options, mounted: true }).includes(`href="gling://post/${id}"`));
  assert.match(readerMarkup('/'), /<h1 id="stories">캐나다 한인 커뮤니티 글링<\/h1>/);
});


test('authorized shared article renders read-only text and only the first attachment, without private interaction fields', () => {
  const post={id,cityId:'vancouver',title:'전체 공개 글',body:'읽을 수 있는 전체 본문',tag:{label:'이야기'},author:{id:'author',nickname:'이웃'},createdAtLabel:'지금',
    imageUris:['https://example.test/first-photo','PRIVATE_SECOND_PHOTO'],imagePaths:['PRIVATE_ACTOR_PATH','PRIVATE_SECOND_PATH'],commentList:[{body:'PRIVATE_COMMENT'}]};
  const markup=readerMarkup('/post',{articlePost:post});
  assert.match(markup,/읽을 수 있는 전체 본문/);assert.equal((markup.match(/<img /g)||[]).length,1);assert.match(markup,/first-photo/);
  assert.doesNotMatch(markup,/PRIVATE_|<button|<textarea|<input/);
  const meetup=readerMarkup('/post',{articlePost:{...post,body:'PRIVATE_ROOM_BODY',room:{cadence:'PUBLIC_SCHEDULE',destination:'PRIVATE_DESTINATION',hostContact:'PRIVATE_CONTACT'}}});
  assert.match(meetup,/공개 일정/);assert.doesNotMatch(meetup,/PRIVATE_|읽을 수 있는 전체 본문/);
});


test('reader title, metadata and language follow KO/EN while authored post text stays original', () => {
  const ko=readerMarkup('/',{language:'ko'}),en=readerMarkup('/',{language:'en'});
  assert.match(ko,/<title>글링 \| 캐나다 한인 커뮤니티 · 밴쿠버·토론토·몬트리올<\/title>/);
  assert.match(en,/<title>Gling \| Korean Community in Canada · Vancouver, Toronto, Montreal<\/title>/);
  assert.match(en,/property="og:site_name" content="Gling \| Korean Community in Canada"/);
  assert.match(en,/class="reader"[^>]+lang="en"/);assert.match(en,/"@type":"WebSite"/, 'home keeps the shared WebSite/Organization graph after hydration');
  const post={id,cityId:'vancouver',title:'작성한 제목은 원문 그대로',body:'회원이 쓴 원문 본문',tag:{label:'원문 분류'},author:{id:'author',nickname:'원문 닉네임'}};
  const article=readerMarkup('/post',{language:'en',articlePost:post});assert.match(article,/작성한 제목은 원문 그대로/);assert.match(article,/회원이 쓴 원문 본문/);
});
test('web meetup discovery explains app participation and keeps a visible public reading path', () => {
  const markup = readerMarkup('/meetups', { language: 'en' });
  assert.doesNotMatch(markup, /reader-showcase/);
  assert.match(markup, /<h1 id="stories">Meetups<\/h1>/);
  assert.match(markup, /To join, create a meetup or chat, use the Gling app/);
  assert.match(markup, /href="gling:\/\/meetup-create"/);
  assert.match(markup, /action="\/meetups"/);
  assert.match(markup, /href="\/merchant\/"/);
  assert.match(markup, /Choose your phone/);
});


test('home opens with the Today feed and visible account entry while meetup discovery stays in its own tab', () => {
  for (const language of ['ko', 'en']) {
    const markup = readerMarkup('/', { language });
    assert.doesNotMatch(markup, /reader-showcase|public-meetups-list|public-meetups-heading/);
    assert.match(markup, /class="reader-header-account" href="\/merchant\/"/);
    assert.match(markup, language === 'ko' ? />비즈니스 로그인<\/a>/ : />Business sign-in<\/a>/);
    assert.match(markup, /<div class="reader-intro"><p>[^<]+<\/p><a data-analytics="web.install.desktop" class="reader-primary" href="#app">/);
    assert.match(markup, /<a href="\/business">/);
    assert.match(markup, /href="\/meetups\?city=vancouver"/);
    assert.match(markup, language === 'ko' ? /<h1 id="stories">캐나다 한인 커뮤니티 글링<\/h1>/ : /<h1 id="stories">Gling, the Korean community in Canada<\/h1>/);
  }
});
