import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { safePostLink, splitPostLinks, postLinksHtml } from '../supabase/functions/_shared/post-links.ts';
import * as publicSeo from '../src/lib/public-seo.ts';

test('본문 링크는 실제 HTTPS 목적지만 활성화한다', () => {
  assert.equal(safePostLink('https://www.instagram.com/ofyoft.official/?igsh=abc'), 'https://www.instagram.com/ofyoft.official/?igsh=abc');
  assert.equal(safePostLink('https://thegreen.ca/menu#lunch'), 'https://thegreen.ca/menu#lunch');
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'http://shop.ca', 'https://www.instagram.com@evil.ca',
    'https://instagram.com.evil.ca/a', 'https://evil-instagram.com/', 'https://instagrаm.com/', 'https://xn--instagrm-7kb.com/',
    'https://127.0.0.1/', 'https://2130706433/', 'https://[::1]/', 'https://localhost/', 'https://shop.internal/',
    'https://shop.local/', 'https://shop.ca:8443/', 'https://shop.ca\\@evil.ca', 'https://sho\np.ca/', 'https://shop.ca/\u202Elogin',
    'https://www.instagram.com/accounts/login/?next=https://evil.ca', 'https://l.instagram.com/?u=https://evil.ca',
    'https://www.instagram.com/%61ccounts/login/', 'https://%69nstagram.com/', 'https://router.lan/',
    'https://bit.ly/redirect', 'https://shop.ca/' + 'x'.repeat(2048)]) {
    assert.equal(safePostLink(bad), null, bad);
  }
});

test('실제 공유 페이지는 공개 글만 읽고 안전한 본문 링크와 보호 헤더를 반환한다', async () => {
  let handler;
  const source = ts.transpileModule(fs.readFileSync(new URL('../supabase/functions/public-post/index.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const id = '6ccc014f-5a7d-429d-af95-7db5ec3dd15a';
  vm.runInNewContext(source, { exports: {}, URL, Response, Deno: { env: { get() {} }, serve: fn => { handler = fn; } },
    require(name) {
      if (name === '../_shared/post-links.ts') return { postLinksHtml };
      if (name.endsWith('public-seo.ts')) return publicSeo;
      return { createClient: () => ({ rpc: async (name, args) => {
        assert.equal(name, 'get_public_post'); assert.equal(args.p_post_id, id);
        return { data: [{ title: '<제목>', body: '웹사이트: https://shop.ca/\n<script>bad()</script> https://instagram.com.evil.ca/', author_nickname: '가게', image_paths: [] }] };
      } }) };
    } });
  const result = await handler(new Request(`https://project.supabase.co/functions/v1/public-post?id=${id}`));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  const html = await result.text();
  assert.ok(html.includes('href="https://shop.ca/"'));
  assert.ok(!html.includes('href="https://instagram.com.evil.ca/"'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('</style>\n/*'), '스타일 밖으로 CSS가 새지 않는다');
});

test('글 내용을 보존하고 Markdown의 가짜 링크와 문장부호를 목적지에 섞지 않는다', () => {
  const body = '웹사이트: https://thegreen.ca/menu.\n인스타: (https://www.instagram.com/thegreen_vancouver/)\n[인스타](https://evil.ca)';
  const parts = splitPostLinks(body);
  assert.equal(parts.map(p => p.text).join(''), body);
  assert.deepEqual(parts.filter(p => p.url).map(p => p.url), ['https://thegreen.ca/menu', 'https://www.instagram.com/thegreen_vancouver/']);
  assert.ok(splitPostLinks('위험 https://www.instagram.com@evil.ca 그대로').every(p => !p.url));
  assert.ok(splitPostLinks('인스타그램: https://evil.ca/').every(p => !p.url));
});

test('공유 HTML은 글 내용을 이스케이프하고 목적지와 창·referrer 보호를 유지한다', () => {
  const html = postLinksHtml('<img src=x onerror=alert(1)> https://shop.ca/menu?a=1&b=2');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('href="https://shop.ca/menu?a=1&amp;b=2"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('referrerpolicy="no-referrer"'));
});
