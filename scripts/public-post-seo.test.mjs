import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as seo from '../src/lib/public-seo.ts';
import * as previewImages from '../supabase/functions/_shared/preview-image.ts';
import * as businessMedia from '../supabase/functions/_shared/business-media.ts';

const id = '682af685-1df0-404d-a245-12086221efb9';
const row = { id, title: '<제목>', body: '메뉴 안내\nhttps://shop.ca/', city_id: 'vancouver', author_nickname: '업체', tag_label: '비즈니스', created_at: '2026-10-08T10:30:00Z', image_paths: [], sort_at: '2026-10-08T10:30:00Z' };
const preview = { id, title: row.title, city: '밴쿠버', label: row.tag_label, imagePath: null };
function handler(rpc, download = async () => { throw Error('must not download'); }, allowService = false) {
  let serve;
  const source = ts.transpileModule(fs.readFileSync(new URL('../supabase/functions/public-post/index.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports: {}, URL, URLSearchParams, Response, Request, Date,
    Deno: { env: { get(key) { if (key === 'SUPABASE_SERVICE_ROLE_KEY') assert.ok(allowService, 'legacy public HTML/markdown never read the service credential'); return key === 'SUPABASE_URL' ? 'https://wjvahbdwmctzpkndqaxa.supabase.co' : key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service-fixture' : 'anon-fixture'; } }, serve: fn => { serve = fn; } },
    require(name) {
      if (name.endsWith('public-seo.ts')) return seo;
      if (name.endsWith('preview-image.ts')) return previewImages;
      if (name.endsWith('business-media.ts')) return businessMedia;
      return { createClient: (url, key, options) => {
        assert.ok(['anon-fixture', 'service-fixture'].includes(key)); assert.equal(options.auth.persistSession, false); assert.equal(options.global, undefined);
        return { rpc: (...args) => { assert.equal(key, args[0] === 'get_business_public_media' ? 'service-fixture' : 'anon-fixture', 'only the existing business media resolver uses the service role'); return rpc(...args); },
          storage: { from: bucket => ({ download: path => { assert.equal(key, 'service-fixture'); return download(bucket, path); },
            createSignedUrl: async () => { throw Error('public covers must not sign storage URLs'); } }) } };
      } };
    } });
  return serve;
}
const request = query => new Request(`${seo.PUBLIC_SOURCE}?${query}`);

test('preview-image is wired before generic format rejection and uses an anonymous preview with one service-only download', async () => {
  const calls = [], path = 'PRIVATE-UPLOADER/cover.webp';
  const serve = handler(async (name, args) => { calls.push([name, args]); return { data: { ...preview, imagePath: path } }; }, async (bucket, object) => {
    calls.push(['download', bucket, object]); return { data: new Blob(['cover'], { type: 'image/webp' }), error: null };
  }, true);
  const response = await serve(new Request(request(`format=preview-image&id=${id}`), { headers: { Authorization: 'Bearer PRIVATE-SESSION', Cookie: 'PRIVATE-COOKIE=1' } }));
  assert.equal(response.status, 200); assert.equal(await response.text(), 'cover');
  assert.deepEqual(calls, [['get_shared_link_preview', { p_post_id: id }], ['download', 'post-images', path]]);
  assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(response.headers.get('Location'), null);
  const invalid = await serve(request(`format=preview-image&id=${id}&id=${id}`)); assert.equal(invalid.status, 400); assert.equal(calls.length, 2);
});

test('preview-image business wiring retains anonymous publication and current service media gates', async () => {
  const calls = [], version = 'a'.repeat(32), path = 'PRIVATE-UPLOADER/cover.jpg';
  const serve = handler(async (name, args) => {
    calls.push([name, args]);
    return { data: name === 'get_shared_link_preview' ? { ...preview, imagePath: `business-post/${id}/0/${version}` } : { bucket: 'post-images', path, version } };
  }, async (bucket, object) => { calls.push(['download', bucket, object]); return { data: new Blob(['cover'], { type: 'image/jpeg' }), error: null }; }, true);
  const response = await serve(new Request(request(`format=preview-image&id=${id}`), { headers: { Authorization: 'Bearer PRIVATE-SESSION' } }));
  assert.equal(response.status, 200); assert.equal(await response.text(), 'cover');
  assert.deepEqual(calls, [['get_shared_link_preview', { p_post_id: id }], ['get_business_public_media', { p_id: id, p_kind: 'post', p_index: 0, p_viewer: null }], ['download', 'post-images', path]]);
});

test('public post OG uses only the selected-cover id URL and never signs or exposes uploader paths', async () => {
  for (const imagePath of ['PRIVATE-UPLOADER/cover.webp', `business-post/${id}/0/${'a'.repeat(32)}`]) {
    const response = await handler(async () => ({ data: { ...preview, imagePath, body: 'PRIVATE-BODY' } }))(request(`id=${id}`));
    const html = await response.text(); assert.equal(response.status, 200);
    assert.ok(html.includes(`<meta property="og:image" content="${seo.PUBLIC_SOURCE}?format=preview-image&amp;id=${id}">`));
    assert.doesNotMatch(html, /PRIVATE-|storage\/v1|business-post\//);
  }
  for (const imagePath of ['owner/../cover.jpg', `business-post/${id}/1/${'a'.repeat(32)}`, 'https://evil.test/photo.jpg']) {
    const html = await (await handler(async () => ({ data: { ...preview, imagePath } }))(request(`id=${id}`))).text();
    assert.doesNotMatch(html, /og:image|evil\.test|owner\//);
  }
});

test('AI 미리보기는 제목·도시·주제만 읽고 로그인 원문 경로를 제공한다', async () => {
  const serve = handler(async (name, args) => { assert.equal(name, 'get_shared_link_preview'); assert.equal(args.p_post_id, id); return { data: preview }; });
  const response = await serve(request(`format=markdown&id=${id}`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/markdown/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('link').includes(`${seo.PUBLIC_SITE}/posts/${id}`));
  const text = await response.text();
  assert.ok(text.includes(preview.title));
  assert.ok(text.includes('도시: 밴쿠버'));
  assert.ok(text.includes('로그인 후 확인'));
  assert.ok(!text.includes('메뉴 안내'));
  assert.ok(!text.includes('작성자: 업체'));
  assert.ok(!text.includes('undefined'));
});

test('공개 HTML과 AI 미리보기는 본문·작성자·상세 지도 링크를 노출하지 않는다', async () => {
  const map = 'https://maps.google.com/?q=Vancouver';
  const serve = handler(async () => ({ data: { ...preview, body: row.body+'\n\nGoogle 지도: '+map, author_nickname: row.author_nickname } }));
  for (const query of [`id=${id}`, `format=markdown&id=${id}`]) {
    const response = await serve(request(query)); assert.equal(response.status, 200);
    const text = await response.text();
    for (const privateText of [map, '메뉴 안내', 'https://shop.ca/', '작성자: 업체']) assert.ok(!text.includes(privateText));
    assert.ok(text.includes('로그인'));
  }
});

test('비공개·삭제 글은404, 서버 오류는503이며 둘 다 noindex다', async () => {
  for (const [result, status] of [[{ data: null }, 404], [{ error: { message: 'private-internal-error' } }, 503]]) {
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
