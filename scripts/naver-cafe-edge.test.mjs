import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as helpers from '../supabase/functions/_shared/naver-cafe.ts';

const source = ts.transpileModule(fs.readFileSync(new URL('../supabase/functions/naver-cafe/index.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const ids = { merchant: '20000000-0000-4000-8000-000000000001', draft: '20000000-0000-4000-8000-000000000002', user: '20000000-0000-4000-8000-000000000003', request: '20000000-0000-4000-8000-000000000004' };
const revision = '2026-10-09T00:00:00.000Z';
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
async function fixture({ enabled = true, owner = ids.user, configured = true, publishStatus = 'prepared', receiptFailure = false, stateOwner = ids.user, fetcher } = {}) {
  let handler, consumed = false, claimCount = 0;
  const calls = [], external = [], encrypted = await helpers.encryptCafeTokens({ access_token: 'server-access', refresh_token: 'server-refresh' }, key, `${ids.merchant}:${ids.user}`);
  const row = { id: ids.request, merchant_id: ids.merchant, user_id: ids.user, draft_id: ids.draft, draft_revision: revision, board_url: 'https://cafe.naver.com/f-e/cafes/123/menus/4', connection_generation: 'generation', status: publishStatus,
    snapshot: { title: '승인된 메뉴', body: '실제 저장 원고', original_url: null, image_paths: [] }, article_url: null, error_code: null };
  const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
    NAVER_CAFE_CLIENT_ID: 'server-client', NAVER_CAFE_CLIENT_SECRET: 'server-secret', NAVER_CAFE_TOKEN_KEY: key, NAVER_CAFE_RETURN_URL: 'https://gling.ej-entertainment.com/merchant/' };
  if (!configured) delete env.NAVER_CAFE_CLIENT_SECRET;
  const client = identity => ({ auth: { getUser: async () => ({ data: { user: { id: ids.user } }, error: null }) },
    storage: { from: () => { throw new Error('unexpected image download'); } },
    rpc: async (name, args = {}) => {
      calls.push({ identity, name, args });
      let data = null;
      if (name === 'get_my_merchant_access') data = enabled;
      else if (name === 'get_merchant_workspace') data = { merchant: { owner_id: owner, owner_verified_at: revision, status: 'trial' } };
      else if (name === 'get_merchant_naver_cafe') data = { connection: null, requests: [] };
      else if (name === 'consume_merchant_naver_oauth') {
        if (consumed || args.p_user_id !== stateOwner) return { data: null, error: { message: 'INVALID_NAVER_STATE' } };
        consumed = true; data = { merchant_id: ids.merchant, user_id: stateOwner };
      } else if (name === 'get_merchant_naver_tokens') data = { encrypted_tokens: encrypted, expires_at: new Date(Date.now() + 60000).toISOString(), generation: 'generation' };
      else if (name === 'reserve_merchant_naver_publish') data = { ...row };
      else if (name === 'claim_merchant_naver_publish') {
        const shouldSend = row.status === 'prepared';
        if (shouldSend) { claimCount++; row.status = 'in_flight'; }
        data = { should_send: shouldSend, request: { ...row } };
      } else if (name === 'complete_merchant_naver_publish') {
        if (receiptFailure) return { error: { message: 'connection reset' }, data: null };
        Object.assign(row, { status: args.p_status, article_url: args.p_article_url, error_code: args.p_error_code }); data = { ...row };
      } else if (name === 'cancel_merchant_naver_preparation') {
        if (row.status === 'prepared') Object.assign(row, { status: 'failed', error_code: 'NAVER_PREPARATION_CANCELLED' });
        data = { ...row };
      }
      return { data, error: null };
    } });
  vm.runInNewContext(source, { exports: {}, URL, URLSearchParams, Request, Response, FormData, Blob, AbortSignal, Date, crypto, atob, TextEncoder, Uint8Array,
    Deno: { env: { get: name => env[name] }, serve: fn => { handler = fn; } },
    fetch: async (url, options) => { external.push({ url, options }); return fetcher ? fetcher(url, options) : new Response(JSON.stringify({ message: { status: '200', result: { articleId: 17, cafeUrl: 'mycafe', articleUrl: 'https://cafe.naver.com/mycafe/17' } } })); },
    require: name => name === '../_shared/naver-cafe.ts' ? { ...helpers, submitCafeArticle: (board, draft, photos, token) => helpers.submitCafeArticle(board, draft, photos, token, async (url, options) => {
      external.push({ url, options }); return fetcher ? fetcher(url, options) : new Response(JSON.stringify({ message: { status: '200', result: { articleId: 17, cafeUrl: 'mycafe', articleUrl: 'https://cafe.naver.com/mycafe/17' } } }));
    }) } : { createClient: (url, token) => client(token) },
  });
  const request = body => handler(new Request('https://project.supabase.co/functions/v1/naver-cafe', { method: 'POST', headers: { authorization: 'Bearer current-user', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { handler, request, calls, external, row, get claimCount() { return claimCount; } };
}
const publish = { action: 'publish', merchantId: ids.merchant, draftId: ids.draft, expectedUpdatedAt: revision, requestId: ids.request,
  boardUrl: 'https://cafe.naver.com/f-e/cafes/123/menus/4', imagePaths: [], confirmed: true, title: '클라이언트 위조 원고' };

test('미설정은 연결됨으로 표시하지 않고 외부 요청 없이 상태를 반환한다', async () => {
  const f = await fixture({ configured: false });
  const status = await (await f.request({ action: 'status', merchantId: ids.merchant })).json();
  assert.equal(status.configured, false); assert.equal(status.connection, null);
  assert.equal((await f.request({ action: 'start', merchantId: ids.merchant })).status, 503);
  assert.equal(f.external.length, 0);
});
test('현재 NO와 타 업체 소유자는 연결·발행하기 전에 차단된다', async () => {
  for (const options of [{ enabled: false }, { owner: 'other-user' }]) {
    const f = await fixture(options);
    const response = await f.request(publish);
    assert.equal((await response.json()).error, 'MERCHANT_ACCESS_REQUIRED');
    assert.equal(f.external.length, 0); assert.equal(f.claimCount, 0);
  }
});
test('OAuth callback은 고정 웹으로만 돌아가고 토큰은 현재 인증 사용자와 단회 state를 확인한 후 저장한다', async () => {
  const state = 'a'.repeat(64);
  const f = await fixture({ fetcher: async (url, options) => {
    assert.equal(url, 'https://nid.naver.com/oauth2.0/token'); assert.equal(options.body.get('client_secret'), 'server-secret');
    return new Response(JSON.stringify({ access_token: 'real-access', refresh_token: 'real-refresh', expires_in: 3600 }));
  } });
  const callback = await f.handler(new Request(`https://project.supabase.co/functions/v1/naver-cafe/callback?state=${state}&code=provider-code&redirect=https://evil.ca`));
  assert.equal(new URL(callback.headers.get('location')).origin, 'https://gling.ej-entertainment.com');
  assert.equal(f.external.length, 0, 'callback alone cannot bind someone else’s browser account');
  const result = await (await f.request({ action: 'complete', state, code: 'provider-code' })).json();
  assert.deepEqual(result, { connected: true, merchantId: ids.merchant });
  const stored = f.calls.find(call => call.name === 'complete_merchant_naver_oauth');
  const plain = await helpers.decryptCafeTokens(stored.args.p_encrypted_tokens, key, `${ids.merchant}:${ids.user}`);
  assert.equal(plain.access_token, 'real-access');
  assert.ok(!JSON.stringify(result).includes('access'));
  assert.equal((await (await f.request({ action: 'complete', state, code: 'provider-code' })).json()).error, 'INVALID_NAVER_STATE');
  assert.equal(f.external.length, 1);
  const wrong = await fixture({ stateOwner: 'other-user' });
  assert.equal((await (await wrong.request({ action: 'complete', state, code: 'provider-code' })).json()).error, 'INVALID_NAVER_STATE');
  assert.equal(wrong.external.length, 0);
});
test('발행은 서버 원고 snapshot만 사용하고 완료 링크와 durable 결과를 저장한다', async () => {
  const f = await fixture();
  const result = await (await f.request(publish)).json();
  assert.equal(result.request.status, 'succeeded'); assert.equal(result.request.article_url, 'https://cafe.naver.com/mycafe/17');
  assert.equal(decodeURIComponent(f.external[0].options.body.get('subject')), '승인된 메뉴');
  assert.equal(f.calls.find(call => call.name === 'reserve_merchant_naver_publish').args.p_expected_updated_at, revision);
  assert.equal(f.claimCount, 1);
  await f.request(publish);
  assert.equal(f.external.length, 1, 'completed request cannot post again');
});
test('연결 재설정 없이 불확실 결과와 저장 실패를 다시 발행하지 않는다', async () => {
  for (const options of [{ fetcher: async () => { throw new TypeError('connection reset'); } }, { receiptFailure: true }]) {
    const f = await fixture(options);
    const result = await (await f.request(publish)).json();
    assert.equal(result.request.status, 'uncertain');
    await f.request(publish);
    assert.equal(f.external.length, 1); assert.equal(f.claimCount, 1);
  }
});
test('검토 확인 누락과 잘못된 게시판은 외부 게시를 시작하지 않는다', async () => {
  for (const change of [{ confirmed: false }, { boardUrl: 'https://evil.ca/board' }]) {
    const f = await fixture();
    assert.equal((await f.request({ ...publish, ...change })).status, 400);
    assert.equal(f.external.length, 0);
  }
});
test('연결 해제는 현재 공식 revoke API의 refresh token cascade와 빈 200 응답을 사용한다', async () => {
  const f = await fixture({ fetcher: async (url, options) => {
    assert.equal(url, 'https://nid.naver.com/oauth2.0/revoke');
    assert.equal(options.body.get('token'), 'server-refresh');
    assert.equal(options.body.get('token_type_hint'), 'refresh_token');
    assert.equal(options.method, 'POST');
    return new Response(null, { status: 200 });
  } });
  const result = await (await f.request({ action: 'disconnect', merchantId: ids.merchant })).json();
  assert.equal(result.disconnected, true);
  assert.equal(result.providerRevoked, true);
});
test('취소된 준비 요청은 늦게 재진입한 발행 호출도 외부 POST를 시작하지 않는다', async () => {
  const f = await fixture({ configured: false });
  const result = await (await f.request({ action: 'cancel', merchantId: ids.merchant, requestId: ids.request })).json();
  assert.equal(result.request.status, 'failed');
  assert.equal(result.request.error_code, 'NAVER_PREPARATION_CANCELLED');
  assert.equal(f.external.length, 0);
  const running = await fixture({ publishStatus: 'in_flight' });
  const active = await (await running.request({ action: 'cancel', merchantId: ids.merchant, requestId: ids.request })).json();
  assert.equal(active.request.status, 'in_flight');
  await running.request(publish);
  assert.equal(running.external.length, 0);
});
