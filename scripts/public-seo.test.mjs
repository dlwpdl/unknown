import assert from 'node:assert/strict';
import test from 'node:test';
import { postSeo, jsonLd, PUBLIC_SITE, PUBLIC_SOURCE } from '../src/lib/public-seo.ts';
import * as publicSeo from '../src/lib/public-seo.ts';
import { parseLanguagePreference, resolveLanguage } from '../src/i18n/language.ts';
import { translateUi } from '../src/i18n/index.ts';

const post = { id: '682af685-1df0-404d-a245-12086221efb9', title: '동네 가게 소식', body: '  직접 만든 메뉴를 소개합니다.\n문의는 공개 계정으로 주세요.\n\nGoogle 지도: https://maps.google.com/?q=Vancouver', author: { nickname: '운영자', id: 'private-user-id' }, tag: { label: '비즈니스' }, createdAt: '2026-10-08T10:30:00Z', imageUris: ['https://example.com/photo.jpg'] };

test('public SEO contains discovery metadata, never the login-protected body or identity', () => {
  const seo = postSeo(post, '밴쿠버');
  assert.equal(seo.canonical, `${PUBLIC_SITE}/posts/${post.id}`);
  assert.equal(seo.source, `${PUBLIC_SOURCE}?format=markdown&id=${post.id}`);
  assert.ok(seo.description.startsWith('밴쿠버 · 비즈니스 · 로그인하면'));
  const main = seo.schema.mainEntity;
  assert.equal(main['@type'], 'WebPage');
  assert.ok(!('author' in main));
  assert.equal(main.datePublished, '2026-10-08T10:30:00.000Z');
  assert.equal(main.image[0], post.imageUris[0]);
  assert.ok(!JSON.stringify(seo).includes('직접 만든 메뉴'));
  assert.ok(!JSON.stringify(seo).includes('Google 지도:'));
  assert.ok(!JSON.stringify(seo).includes('private-user-id'));
  assert.equal(seo.schema.url, main.url);
});

test('JSON-LD를 탈출하는 글도 사용자 원문을 바꾸지 않고 안전하게 직렬화한다', () => {
  const title = '</script><script>alert(1)</script>\u2028\u2029';
  const seo = postSeo({ ...post, title, imageUris: undefined, createdAt: undefined }, '토론토');
  const serialized = jsonLd(seo.schema);
  assert.ok(!serialized.includes('<'));
  assert.ok(!serialized.includes('\u2028'));
  assert.equal(JSON.parse(serialized).mainEntity.headline, title);
  assert.ok(!('datePublished' in seo.schema.mainEntity));
  assert.ok(!('image' in seo.schema.mainEntity));
});

test('사진 서명 실패 자리의 빈 URL은 공개 검색 메타데이터에 넣지 않는다', () => {
  assert.deepEqual(postSeo({ ...post, imageUris: ['', post.imageUris[0], ''] }).schema.mainEntity.image, post.imageUris);
  assert.ok(!('image' in postSeo({ ...post, imageUris: ['', ''] }).schema.mainEntity));
});

test('the exact Korean and English web names follow the existing saved/device language priority', () => {
  assert.equal(typeof publicSeo.publicSiteName, 'function');
  for (const [saved, device, expected] of [
    ['system', ['ko-KR'], '글링 | 캐나다 한인 커뮤니티'],
    ['system', ['en-CA'], 'Gling | Korean Community in Canada'],
    ['en', ['ko-KR'], 'Gling | Korean Community in Canada'],
    ['ko', ['en-CA'], '글링 | 캐나다 한인 커뮤니티'],
    [null, ['fr-CA'], 'Gling | Korean Community in Canada'],
    ['invalid', ['ja-JP', 'ko_KR'], '글링 | 캐나다 한인 커뮤니티'],
  ]) {
    const language = resolveLanguage(parseLanguagePreference(saved), device);
    assert.equal(publicSeo.publicSiteName(language), expected);
    assert.equal(translateUi(language, '글링 | 캐나다 한인 커뮤니티'), expected);
  }
  assert.equal(publicSeo.publicSiteName(), '글링 | 캐나다 한인 커뮤니티');
});

test('localized post metadata keeps original post content and existing call compatibility without exposing the body', () => {
  const original = JSON.stringify(post);
  for (const language of ['ko', 'en']) {
    const seo = postSeo(post, '밴쿠버', language);
    const site = language === 'ko' ? '글링 | 캐나다 한인 커뮤니티' : 'Gling | Korean Community in Canada';
    assert.equal(seo.title, `${post.title} | ${language === 'ko' ? '글링' : 'Gling'}`);
    assert.equal(seo.schema.inLanguage, language);
    assert.equal(seo.schema.mainEntity.inLanguage, language);
    assert.equal(seo.schema.mainEntity.headline, post.title);
    assert.equal(seo.schema.breadcrumb.itemListElement[0].name, site);
    assert.match(seo.description, language === 'ko' ? /전체 본문을 웹에서/ : /full public post on the web/);
    assert.ok(!JSON.stringify(seo).includes('직접 만든 메뉴'));
    assert.ok(!JSON.stringify(seo).includes('private-user-id'));
    assert.equal(seo.canonical, `${PUBLIC_SITE}/posts/${post.id}`);
  }
  assert.equal(postSeo(post).schema.inLanguage, 'ko');
  assert.equal(JSON.stringify(post), original);
});
