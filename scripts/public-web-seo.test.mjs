import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finishPublicWeb } from './finish-public-web.mjs';
import { CITIES } from '../src/lib/mock.ts';
import { PUBLIC_SITE, PUBLIC_SOURCE } from '../src/lib/public-seo.ts';

test('기존 export는 공개 도시별 라이브 sitemap/AI 탐색과 보호 경로 robots를 생성한다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gling-seo-export-'));
  try {
    mkdirSync(join(directory, 'auth'));
    writeFileSync(join(directory, '+not-found.html'), 'existing-fallback');
    writeFileSync(join(directory, 'post.html'), 'public-reader-route');
    writeFileSync(join(directory, 'company.html'), 'exported-company-route');
    writeFileSync(join(directory, 'auth', 'keep.html'), 'preserved');
    finishPublicWeb(directory);
    assert.equal(readFileSync(join(directory, '404.html'), 'utf8'), 'existing-fallback');
    assert.equal(readFileSync(join(directory, 'company.html'), 'utf8'), 'exported-company-route');
    assert.equal(readFileSync(join(directory, 'auth', 'keep.html'), 'utf8'), 'preserved');
    const robots = readFileSync(join(directory, 'robots.txt'), 'utf8');
    const llms = readFileSync(join(directory, 'llms.txt'), 'utf8');
    for (const city of CITIES.filter(c => c.state === 'open')) {
      assert.ok(!robots.includes(`${PUBLIC_SOURCE}?format=sitemap`), 'post URLs come from the static sitemap');
      assert.ok(llms.includes(`${PUBLIC_SOURCE}?format=markdown&city=${city.id}`));
    }
    for (const path of ['/merchant/', '/auth/', '/admin', '/chat', '/profile']) assert.ok(robots.includes(`Disallow: ${path}`));
    assert.ok(robots.includes(`Sitemap: ${PUBLIC_SITE}/sitemap.xml`));
    assert.ok(!robots.includes('User-agent: GPTBot'), 'AI 학습의 별도 정책을 임의로 바꾸지 않는다');
    const sitemap = readFileSync(join(directory, 'sitemap.xml'), 'utf8');
    assert.ok(!sitemap.includes('/merchant'));
    assert.ok(!sitemap.includes('/admin'));
    assert.ok(sitemap.includes(`${PUBLIC_SITE}/privacy`));
    assert.ok(!sitemap.includes('?city='), 'city filters canonicalize to the home page');
    assert.ok(!llms.includes('sb_publishable_'));
    assert.ok(llms.startsWith('# 글링 Gling: 캐나다 한인 커뮤니티 (밴쿠버·토론토·몬트리올)'));
    assert.ok(llms.includes('Gling is a free community app for Koreans in Vancouver, Toronto and Montreal'));
    assert.doesNotMatch(llms, /캘거리|에드먼/);
    for (const city of ['vancouver', 'toronto', 'montreal']) {
      assert.ok(sitemap.includes(`<loc>${PUBLIC_SITE}/${city}</loc>`));
      assert.ok(llms.includes(`${PUBLIC_SITE}/${city}`));
    }
    assert.match(llms, /대표 이미지 한 장.*짧은 소개/);
    assert.match(llms, /로그인하거나 정상 가입.*전체 본문을 웹에서/);
    assert.match(llms, /댓글 작성·대화·모임 참여는 앱에서/);
    assert.doesNotMatch(llms, /전체 본문.*앱에서만|원문의 링크는 글링 로그인 화면/);
  } finally { rmSync(directory, { recursive: true }); }
});

test('공개 글은 검색용 정적 페이지와 sitemap 항목으로 만들고 모임·비공개는 뺀다', async () => {
  const { prerenderPublicPosts } = await import('./prerender-public-posts.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'gling-seo-posts-'));
  const visible = '11111111-1111-4111-8111-111111111111', meetup = '22222222-2222-4222-8222-222222222222', removed = '33333333-3333-4333-8333-333333333333';
  const calls = [];
  const fetcher = async (url, init) => {
    const name = url.split('/rpc/')[1], args = JSON.parse(init.body);
    calls.push([name, init.headers.apikey, args.p_post_id]);
    const data = name === 'get_public_feed_page_v2'
      ? args.p_city_id === 'vancouver' ? [visible, meetup, removed, '20000000-0000-0000-0000-000000000014'].map(id => ({ id, created_at: '2026-10-20T00:00:00Z' })) : []
      : args.p_post_id === visible ? { id: visible, kind: 'post', title: '코퀴틀람 <카페>', teaser: '창가 자리가 예뻐요 & 조용해요', city: '밴쿠버', label: '맛집', imagePath: 'p/1.jpg' }
        : args.p_post_id === meetup ? { id: meetup, kind: 'meetup', title: '모임', city: '밴쿠버', label: '모임' } : null;
    return { ok: true, json: async () => data };
  };
  try {
    writeFileSync(join(directory, '+not-found.html'), '<html><head><meta charSet="utf-8"/><title data-rh="true">old</title><meta name="robots" content="noindex, nofollow" data-rh="true"/></head><body><div id="root">app</div></body></html>');
    const posts = await prerenderPublicPosts(directory, { url: 'https://db.example', key: 'anon', cities: ['vancouver', 'toronto'], fetcher });
    assert.deepEqual(posts.map(post => post.id), [visible]);
    assert.ok(calls.every(([, key]) => key === 'anon'));
    const page = readFileSync(join(directory, 'posts', `${visible}.html`), 'utf8');
    assert.ok(!page.includes('noindex') && !page.includes('>old<'));
    assert.ok(page.includes(`<link rel="canonical" href="${PUBLIC_SITE}/posts/${visible}"`));
    assert.ok(page.includes('코퀴틀람 &#60;카페&#62;') && page.includes('창가 자리가 예뻐요 &#38; 조용해요') && !page.includes('<카페>'));
    assert.ok(page.includes('id="gling-static-post"') && page.includes('<div id="root">app</div>'));
    assert.ok(page.includes(`"item":"${PUBLIC_SITE}/vancouver"`) && page.includes('href="/vancouver"') && page.includes('<title data-rh="true">코퀴틀람 &#60;카페&#62; | 글링</title>'));
    assert.ok(!calls.some(([name, , id]) => id === '20000000-0000-0000-0000-000000000014'), 'seed fixtures are never prerendered');
    finishPublicWeb(directory, posts);
    const sitemap = readFileSync(join(directory, 'sitemap.xml'), 'utf8');
    assert.ok(sitemap.includes(`<loc>${PUBLIC_SITE}/posts/${visible}</loc><lastmod>2026-10-20</lastmod>`) && !sitemap.includes(meetup));
    assert.ok(readFileSync(join(directory, 'llms.txt'), 'utf8').includes(`${PUBLIC_SITE}/posts/${visible}`));
    writeFileSync(join(directory, 'index.html'), '<html><head></head><body class="x"><div id="root">app</div></body></html>');
    writeFileSync(join(directory, 'vancouver.html'), '<html><head></head><body><div id="root">app</div></body></html>');
    writeFileSync(join(directory, 'toronto.html'), '<html><head></head><body><div id="root">app</div></body></html>');
    finishPublicWeb(directory, posts.map(post => ({ ...post, cityId: 'vancouver' })));
    const home = readFileSync(join(directory, 'index.html'), 'utf8'), vancouver = readFileSync(join(directory, 'vancouver.html'), 'utf8'), toronto = readFileSync(join(directory, 'toronto.html'), 'utf8');
    assert.match(home, /<body class="x"><section id="gling-static-home"[^]*한인을 위한 무료 커뮤니티 앱[^]*href="\/posts\/11111111/);
    assert.ok(home.includes('href="/montreal"') && vancouver.includes('밴쿠버 한인 최근 이야기') && vancouver.includes(`/posts/${visible}`));
    assert.ok(toronto.includes('id="gling-static-home"') && !toronto.includes(`/posts/${visible}`), 'city hubs list only their own posts');
  } finally { rmSync(directory, { recursive: true }); }
});
