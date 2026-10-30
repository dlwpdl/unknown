import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServerDocument, useServerDocumentContext } from 'expo-router/build/server/ServerDocument';
import ts from 'typescript';
import * as seo from '../src/lib/public-seo.ts';
import * as mock from '../src/lib/mock.ts';
import * as legal from '../src/lib/legal-documents.ts';

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URLSearchParams, require(name) {
    assert.ok(name in imports, `Known import: ${name}`);
    return imports[name];
  } });
  return exports;
}
const metadata = load('components/public-web/metadata.ts', { '@/lib/public-seo': seo });
const require = createRequire(import.meta.url);
const cliRequire = createRequire(createRequire(require.resolve('expo/package.json')).resolve('@expo/cli/package.json'));
const routerServerRequire = createRequire(cliRequire.resolve('@expo/router-server/package.json'));
const { serializeMetadataToReact } = routerServerRequire('./build/utils/metadata/serialize.js');
const imports = {
  react: React, 'react/jsx-runtime': jsxRuntime, 'expo-router': {},
  '@/components/public-web/metadata': metadata, '@/lib/public-seo': seo, '@/lib/mock': mock, '@/lib/legal-documents': legal,
  '@/components/public-web/reader': { default: () => null }, '@/components/public-web/visited': { default: () => null },
  '@/components/public-web/faq': { default: () => null }, '@/components/public-web/business': { default: () => null },
  '@/components/public-web/shared-post-landing': { default: () => null }, '../app/[document].web': { default: () => null },
};

function renderDocument(pathname, schema = metadata.publicHomeSchema, headNodes = serializeMetadataToReact({ description: 'Generated route metadata' })) {
  const { default: RootHtml } = load('web/+html.tsx', {
    ...imports, '@/components/public-web/metadata': { ...metadata, publicHomeSchema: schema },
    'expo-router/html': { useServerDocumentContext, ScrollViewStyleReset: () => null },
    '@/constants/theme': { WebNightColors: { background: '#0D0C10' } },
  });
  return renderToStaticMarkup(React.createElement(ServerDocument, { data: {
    htmlAttributes: { dir: 'ltr', style: { color: '#fff' } },
    bodyAttributes: { className: 'server-body', style: { margin: 0 } },
    headNodes,
    bodyNodes: React.createElement('script', { src: '/_expo/hydration.js' }),
  } }, React.createElement(RootHtml, { pathname }, React.createElement('main', null, 'Public route'))));
}

test('public root HTML retains SDK 58 metadata, hydration scripts and document attributes', () => {
  const html = renderDocument('/');
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  assert.match(html, /<html[^>]*dir="ltr"[^>]*lang="ko"/);
  assert.match(html, /color:#fff/);
  assert.match(html, /<body[^>]*class="server-body"/);
  assert.match(html, /margin:0/);
  assert.match(head, /name="description" content="Generated route metadata"/);
  assert.ok(html.indexOf('/_expo/hydration.js') > html.indexOf('</main>'), 'hydration assets follow the route content');
  const schema = JSON.parse(head.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(schema['@graph'].map(node => node['@type']), ['WebSite', 'Organization', 'MobileApplication']);
  const [site, organization, app] = schema['@graph'];
  assert.equal(site.url, 'https://gling.ej-entertainment.com/');
  assert.equal(site.inLanguage, 'ko');
  assert.match(site.description, /로그인하면 전체 글/);
  assert.equal(site.publisher['@id'], organization['@id']);
  assert.equal(app.url, 'https://apps.apple.com/ca/app/id6809273242');
});

test('public root escapes JSON-LD script boundaries and omits the home schema on protected routes', () => {
  const name = '</script><script>alert(1)</script>\u2028\u2029';
  const html = renderDocument('/', { ...metadata.publicHomeSchema, name });
  const serialized = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.ok(!serialized.includes('<') && !serialized.includes('\u2028') && !serialized.includes('\u2029'));
  assert.equal(JSON.parse(serialized).name, name);
  for (const path of ['/post', '/chat', '/auth/callback', '/profile/membership']) {
    assert.ok(!renderDocument(path).includes('application/ld+json'), `${path} must not inherit a public home schema`);
  }
});

test('public home, business and Visited routes export initial title, canonical and preview metadata', () => {
  for (const [file, title, canonical] of [
    ['index', `${seo.publicSiteName()} · 밴쿠버·토론토·몬트리올`, 'https://gling.ej-entertainment.com/'],
    ['business', '글링 비즈니스 등록 · 캐나다 한인 고객에게 가게 알리기', 'https://gling.ej-entertainment.com/business'],
    ['visited', '밴쿠버 Gling Visited | 글링', 'https://gling.ej-entertainment.com/visited?city=vancouver'],
    ['faq', '글링 자주 묻는 질문 | 캐나다 한인 커뮤니티', 'https://gling.ej-entertainment.com/faq'],
  ]) {
    const value = load(`web/${file}.tsx`, imports).generateMetadata();
    assert.equal(value.title, title);
    assert.equal(value.alternates.canonical, canonical);
    assert.match(value.robots, /^index, follow/);
    assert.ok(value.description.length > 20);
    assert.equal(value.openGraph.title, title);
    assert.equal(value.openGraph.url, canonical);
    assert.equal(value.twitter.card, 'summary_large_image');
  }
  // Business profiles are prerendered at /company/<id>; the id-less shell must not canonicalize every business to one page.
  const company = load('web/company.tsx', imports).generateMetadata();
  assert.equal(company.robots, 'noindex, follow');
  assert.equal(company.alternates, undefined);
});

test('legal metadata follows the matched policy while malformed and unknown document routes stay noindex', () => {
  const { generateMetadata } = load('web/[document].tsx', imports);
  for (const [document, title] of [
    ['terms', '이용약관 | gling'], ['privacy', '개인정보처리방침 | gling'],
    ['account-deletion', '계정 삭제 안내 | gling'], ['child-safety', '아동 안전 표준 | gling'],
  ]) {
    const value = generateMetadata(undefined, { document });
    assert.equal(value.title, title);
    assert.equal(value.description, legal.LEGAL_DOCUMENTS[document].summary);
    assert.equal(value.alternates.canonical, `https://gling.ej-entertainment.com/${document}`);
  }
  for (const document of ['missing', '__proto__', 'constructor', ['privacy'], undefined]) {
    assert.equal(generateMetadata(undefined, { document }).robots, 'noindex, nofollow');
  }
});

test('login-protected shared posts and unknown pages remain noindex in their initial metadata', () => {
  const post = load('web/post.tsx', imports).generateMetadata();
  assert.equal(post.robots, 'noindex, follow');
  assert.equal(post.title, `글링 공유 | ${seo.publicSiteName()}`);
  assert.match(post.openGraph.description, /로그인 후 전체 내용/);
  assert.equal(load('web/+not-found.tsx', imports).generateMetadata().robots, 'noindex, nofollow');
});


test('static metadata adopts legacy Head ownership without giving Helmet control of document settings or resources', () => {
  const generated = serializeMetadataToReact({
    title: 'Route title', description: 'Route description', robots: 'noindex, follow', referrer: 'no-referrer',
    alternates: { canonical: 'https://gling.example/current', types: { 'text/markdown': 'https://gling.example/source' } },
    openGraph: { type: 'article', title: 'Preview title', publishedTime: '2026-10-23T00:00:00Z' },
    twitter: { title: 'Social title', card: 'summary' },
  });
  const resources = [
    React.createElement('link', { key: 'style', rel: 'stylesheet', href: '/app.css' }),
    React.createElement('link', { key: 'font', rel: 'preload', href: '/font.woff2', as: 'font' }),
    React.createElement('link', { key: 'preload', rel: 'preload', href: '/app.js', as: 'script' }),
    React.createElement('link', { key: 'icon', rel: 'icon', href: '/icon.png' }),
    React.createElement('style', { key: 'inline', id: 'rn-web-style' }, 'body{color:white}'),
    React.createElement(React.Fragment, { key: 'fragment' }, React.createElement('meta', { name: 'custom-policy', content: 'retained' })),
    React.createElement(() => React.createElement('meta', { name: 'custom-component', content: 'retained' }), { key: 'component' }),
  ];
  const html = renderDocument('/', metadata.publicHomeSchema, [...generated, ...resources]);
  const tags = [...html.matchAll(/<(?:meta|link|title|style|script)\b[^>]*>/g)].map(match => match[0]);
  for (const attribute of ['name="description"', 'name="robots"', 'name="twitter:title"', 'name="twitter:card"',
    'property="og:title"', 'property="og:type"', 'property="article:published_time"', 'rel="canonical"', 'rel="alternate"']) {
    const tag = tags.find(tag => tag.includes(attribute));
    assert.ok(tag, `Generated ${attribute} survives server rendering`);
    assert.match(tag, /data-rh="true"/, `Legacy Head must replace ${attribute} after hydration`);
  }
  for (const attribute of ['name="referrer"', 'charSet="utf-8"', 'name="viewport"', 'name="theme-color"',
    'href="/app.css"', 'href="/font.woff2"', 'href="/app.js"', 'href="/icon.png"', 'id="rn-web-style"',
    'name="custom-policy"', 'name="custom-component"', 'src="/_expo/hydration.js"', '<title>']) {
    const tag = tags.find(tag => tag.includes(attribute));
    assert.ok(tag, `${attribute} survives server rendering`);
    assert.ok(!tag.includes('data-rh'), `Helmet must not remove ${attribute}`);
  }
});
