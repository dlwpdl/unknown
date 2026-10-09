import assert from 'node:assert/strict';
import test from 'node:test';
import { postSeo, jsonLd, PUBLIC_SITE, PUBLIC_SOURCE } from '../src/lib/public-seo.ts';

const post = { id: '682af685-1df0-404d-a245-12086221efb9', title: '동네 가게 소식', body: '  직접 만든 메뉴를 소개합니다.\n문의는 공개 계정으로 주세요.\n\nGoogle 지도: https://maps.google.com/?q=Vancouver', author: { nickname: '운영자', id: 'private-user-id' }, tag: { label: '비즈니스' }, createdAt: '2026-10-08T10:30:00Z', imageUris: ['https://example.com/photo.jpg'] };

test('공개 글 SEO는 실제 본문·작성자·날짜·사진과 동일한 canonical을 사용한다', () => {
  const seo = postSeo(post, '밴쿠버');
  assert.equal(seo.canonical, `${PUBLIC_SITE}/post?id=${post.id}`);
  assert.equal(seo.source, `${PUBLIC_SOURCE}?format=markdown&id=${post.id}`);
  assert.ok(seo.description.startsWith('밴쿠버 · 비즈니스 · 직접 만든 메뉴'));
  const main = seo.schema.mainEntity;
  assert.equal(main['@type'], 'SocialMediaPosting');
  assert.equal(main.author.name, '운영자');
  assert.equal(main.datePublished, '2026-10-08T10:30:00.000Z');
  assert.equal(main.image[0], post.imageUris[0]);
  assert.ok(!main.text.includes('Google 지도:'));
  assert.ok(!JSON.stringify(seo).includes('private-user-id'));
  assert.equal(seo.schema.url, main.url);
});

test('JSON-LD를 탈출하는 글도 사용자 원문을 바꾸지 않고 안전하게 직렬화한다', () => {
  const body = '</script><script>alert(1)</script>\u2028\u2029';
  const seo = postSeo({ ...post, body, imageUris: undefined, createdAt: undefined }, '토론토');
  const serialized = jsonLd(seo.schema);
  assert.ok(!serialized.includes('<'));
  assert.ok(!serialized.includes('\u2028'));
  assert.equal(JSON.parse(serialized).mainEntity.text, body);
  assert.ok(!('datePublished' in seo.schema.mainEntity));
  assert.ok(!('image' in seo.schema.mainEntity));
});
