import assert from 'node:assert/strict';
import { test } from 'node:test';
import { merchantReportText, merchantReportHtml } from '../src/lib/admin-merchants.ts';
import { safeMerchantSourceUrl, trackMerchantSourceClick, trackPublicMerchantSourceClick } from '../src/lib/merchant-source.ts';

const report = {
  id: 'report-1', merchant_id: 'merchant-1', merchant_name: '<동네 카페>', city_name: '밴쿠버',
  period_start: '2026-10-01', period_end: '2026-10-14', timezone: 'America/Vancouver', generated_at: '2026-10-15T00:00:00Z',
  title: '2주 홍보 결과', summary: '메뉴 안내에 반응이 있었어요.', next_step: '예약 안내를 구체화합니다.',
  proposal_period: 'month', proposal_amount: 49, tax_note: '세금 별도',
  metrics: { linked_posts: 2, new_posts: 1, displayed_views: 135, first_reads: 3, unique_readers: 2, source_clicks: 4, member_clickers: 1, anonymous_sessions: 2 },
  posts: [{ post_id: 'post-1', title: '커피 <안내>', original_url: 'https://example.com/post', displayed_views: 135, source_clicks: 4 }],
};

test('reports keep adjusted display totals separate from measured readers and clicks', () => {
  const text = merchantReportText(report);
  assert.match(text, /표시 조회수.*135.*조정/);
  assert.match(text, /최초 열람.*3/);
  assert.match(text, /원문 이동 클릭.*4/);
  assert.match(text, /로그인.*1/);
  assert.match(text, /익명.*2/);
  assert.match(text, /주문.*확인/);
  assert.doesNotMatch(text, /실제.*135명|고유.*3명|주문 완료 4/);
  assert.match(text, /월.*49\.00/);
});
test('customer HTML escapes merchant and report text and stays standalone', () => {
  const html = merchantReportHtml({ ...report, summary: '<script>alert(1)</script>' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /&lt;동네 카페&gt;/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|https:\/\/.*\.js|user_id|session_id/);
  assert.match(html, /@media print/);
  assert.match(html, /#0B0B12/);
});
test('unset quote stays unset, zero actual counts stay zero', () => {
  const text = merchantReportText({ ...report, proposal_amount: null, metrics: { ...report.metrics, source_clicks: 0 } });
  assert.match(text, /원문 이동 클릭: 0/);
  assert.doesNotMatch(text, /CAD 0\.00|월 운영:.*0\.00/);
});
test('only public HTTPS originals without credentials or local targets are accepted', () => {
  assert.equal(safeMerchantSourceUrl(' https://Example.com/posts/1#comment '), 'https://example.com/posts/1');
  for (const value of ['javascript:alert(1)', 'http://example.com', 'https://user:secret@example.com', 'https://127.0.0.1/post', 'https://localhost/a', 'https://shop.local/a', 'https://[::1]/', 'https://example.com:8181/', 'not a URL']) assert.equal(safeMerchantSourceUrl(value), null);
});
test('source click carries only fixed context and telemetry failure does not block navigation', async () => {
  let args;
  const ok = await trackMerchantSourceClick({ rpc: async (name, value) => { args = { name, value }; return { error: null }; } }, 'post-1', 'web');
  assert.equal(ok, true);
  assert.equal(args.name, 'record_merchant_source_click');
  assert.deepEqual(Object.keys(args.value).sort(), ['p_event_id', 'p_platform', 'p_post_id', 'p_session']);
  assert.equal(await trackMerchantSourceClick({ rpc: async () => { throw new Error('offline'); } }, 'post-1', 'ios'), false);
});
test('public clicks use isolated anonymous keepalive transport without auth or contact data', async () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'public-test-key';
  let request;
  assert.equal(await trackPublicMerchantSourceClick('post-1', async (url, init) => { request = { url, init }; return new Response(null, { status: 204 }); }), true);
  assert.equal(request.url, 'https://example.supabase.co/rest/v1/rpc/record_merchant_source_click');
  assert.equal(request.init.keepalive, true);
  assert.equal(request.init.credentials, 'omit');
  assert.equal(new Headers(request.init.headers).has('Authorization'), false);
  assert.deepEqual(Object.keys(JSON.parse(request.init.body)).sort(), ['p_event_id', 'p_platform', 'p_post_id', 'p_session']);
  assert.equal(await trackPublicMerchantSourceClick('post-1', async () => { throw new Error('offline'); }), false);
});
