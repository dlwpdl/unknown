import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as seo from '../src/lib/public-seo.ts';
import { postLinksHtml } from '../supabase/functions/_shared/post-links.ts';

const id = '682af685-1df0-404d-a245-12086221efb9';
const row = { id, title: '<제목>', body: '메뉴 안내\nhttps://shop.ca/', city_id: 'vancouver', author_nickname: '업체', tag_label: '비즈니스', created_at: '2026-10-08T10:30:00Z', image_paths: [], sort_at: '2026-10-08T10:30:00Z' };
function handler(rpc) {
  let serve;
  const source = ts.transpileModule(fs.readFileSync(new URL('../supabase/functions/public-post/index.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports: {}, URL, URLSearchParams, Response, Request, Date,
    Deno: { env: { get(key) { assert.notEqual(key, 'SUPABASE_SERVICE_ROLE_KEY'); return key === 'SUPABASE_URL' ? 'https://wjvahbdwmctzpkndqaxa.supabase.co' : 'anon-fixture'; } }, serve: fn => { serve = fn; } },
    require(name) {
      if (name.endsWith('public-seo.ts')) return seo;
      if (name.endsWith('post-links.ts')) return { postLinksHtml };
      return { createClient: (url, key, options) => { assert.equal(key, 'anon-fixture'); assert.equal(options.auth.persistSession, false); return { rpc, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://example.com/photo.jpg' } }) }) } }; } };
    } });
  return serve;
}
const request = query => new Request(`${seo.PUBLIC_SOURCE}?${query}`);

test('AI 원문은 현재 공개 RPC만 읽고 정확한 출처를 제공한다', async () => {
  const serve = handler(async (name, args) => { assert.equal(name, 'get_public_post'); assert.equal(args.p_post_id, id); return { data: [row] }; });
  const response = await serve(request(`format=markdown&id=${id}`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/markdown/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('link').includes(`${seo.PUBLIC_SITE}/post?id=${id}`));
  const text = await response.text();
  assert.ok(text.includes('메뉴 안내'));
  assert.ok(text.includes('작성자: 업체'));
  assert.ok(!text.includes('undefined'));
});

test('기존 HTML과 AI 원문 모두 실제 Google 지도 목적지를 보존한다', async () => {
  const map = 'https://maps.google.com/?q=Vancouver';
  const serve = handler(async () => ({ data: [{ ...row, body: row.body+'\n\nGoogle 지도: '+map }] }));
  for (const query of [`id=${id}`, `format=markdown&id=${id}`]) {
    const response = await serve(request(query)); assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(map));
  }
});

test('비공개·삭제 글은404, 서버 오류는503이며 둘 다 noindex다', async () => {
  for (const [result, status] of [[{ data: [] }, 404], [{ error: { message: 'private-internal-error' } }, 503]]) {
    const response = await handler(async () => result)(request(`format=markdown&id=${id}`));
    assert.equal(response.status, status);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.ok(!(await response.text()).includes('private-internal-error'));
  }
  const invalid = await handler(() => { throw Error('must not query'); })(request('format=markdown&id=bad'));
  assert.equal(invalid.status, 400);
});

test('도시 sitemap은 cursor 끝까지 공개 글만 모으고 중복·순회 실패를 숨기지 않는다', async () => {
  let calls = 0;
  const rows = Array.from({ length: 30 }, (_, i) => ({ ...row, id: `682af685-1df0-404d-a245-${String(i).padStart(12, '0')}` }));
  const second = { ...row, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const response = await handler(async (name, args) => {
    assert.equal(name, 'get_public_feed_page_v2'); assert.equal(args.p_city_id, 'vancouver');
    calls++;
    if (calls === 1) return { data: rows };
    assert.equal(args.p_before_id, rows.at(-1).id); assert.equal(args.p_before_sort, row.sort_at);
    return { data: [second] };
  })(request('format=sitemap&city=vancouver'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/xml/);
  const xml = await response.text(); assert.equal((xml.match(/<loc>/g) ?? []).length, 31);
  assert.ok(xml.includes(`${seo.PUBLIC_SITE}/post?id=${second.id}`));
  const repeated = await handler(async () => ({ data: rows }))(request('format=sitemap&city=vancouver'));
  assert.equal(repeated.status, 503);
});

test('AI 도시 탐색은 다음 페이지와 글별 최신 원문을 연결하고 입력을 검증한다', async () => {
  const response = await handler(async () => ({ data: [row] }))(request('format=markdown&city=vancouver'));
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes(`format=markdown&id=${id}`));
  const invalid = await handler(() => { throw Error('must not query'); })(request('format=sitemap&city=../../admin'));
  assert.equal(invalid.status, 400);
  for (const suffix of ['&before_sort=&before_id=', '&before_sort=2026-10-08', '&before_id='+id]) {
    const badCursor = await handler(() => { throw Error('must not query'); })(request('format=markdown&city=vancouver'+suffix));
    assert.equal(badCursor.status, 400);
  }
});
