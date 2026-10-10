import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const implementation = await import('../supabase/functions/_shared/naver-cafe.ts').catch(() => ({}));
const { parseCafeBoardUrl, cafeArticleReceipt, cafeMultipart, encryptCafeTokens, decryptCafeTokens, validCafePhoto, submitCafeArticle } = implementation;

test('카페 게시판 URL에서 실제 숫자 ID만 읽고 주소를 정규화한다', () => {
  assert.equal(typeof parseCafeBoardUrl, 'function');
  assert.deepEqual(parseCafeBoardUrl('https://cafe.naver.com/f-e/cafes/12345678/menus/42?viewType=L'), {
    clubId: '12345678', menuId: '42', url: 'https://cafe.naver.com/f-e/cafes/12345678/menus/42',
  });
  assert.equal(parseCafeBoardUrl('https://cafe.naver.com/ArticleList.nhn?search.clubid=12345678&search.menuid=42').menuId, '42');
  for (const bad of ['http://cafe.naver.com/f-e/cafes/1/menus/2', 'https://cafe.naver.com.evil.ca/f-e/cafes/1/menus/2',
    'https://cafe.naver.com@evil.ca/f-e/cafes/1/menus/2', 'https://cafe.naver.com/some-cafe',
    'https://cafe.naver.com/ArticleList.nhn?search.clubid=1&search.clubid=2&search.menuid=3',
    'https://cafe.naver.com:8443/f-e/cafes/1/menus/2', 'https://cafe.naver.com/f-e/cafes/0/menus/2',
    'https://cafe.naver.com/\\@evil.ca/f-e/cafes/1/menus/2', 'https://%63afe.naver.com/f-e/cafes/1/menus/2']) {
    assert.throws(() => parseCafeBoardUrl(bad), /INVALID_NAVER_BOARD_URL/, bad);
  }
});

test('네이버 실제 성공 응답의 articleUrl만 완료로 인정한다', () => {
  const result = { message: { status: '200', result: { articleId: 17, cafeUrl: 'mycafe', articleUrl: 'https://cafe.naver.com/mycafe/17' } } };
  assert.equal(typeof cafeArticleReceipt, 'function');
  assert.equal(cafeArticleReceipt(result), result.message.result.articleUrl);
  for (const altered of [ { status: '500' }, { result: { ...result.message.result, articleUrl: 'https://evil.ca/mycafe/17' } },
    { result: { ...result.message.result, articleUrl: 'https://cafe.naver.com/mycafe/18' } },
    { result: { ...result.message.result, articleUrl: 'https://cafe.naver.com/mycafe/17?redirect=evil' } } ]) {
    assert.equal(cafeArticleReceipt({ message: { ...result.message, ...altered } }), null);
  }
});

test('공식 multipart 계약은 원고를 이스케이프하고 순서대로 반복 image 필드를 보낸다', async () => {
  assert.equal(typeof cafeMultipart, 'function');
  const photos = [new Blob([Uint8Array.from([255, 216, 255, 1])], { type: 'image/jpeg' }), new Blob([Uint8Array.from([255, 216, 255, 2])], { type: 'image/jpeg' })];
  const form = await cafeMultipart({ title: '실제 메뉴', body: '<script>bad()</script>\n12달러', original_url: 'https://merchant.ca/menu', image_paths: ['user/a.jpg', 'user/b.jpg'] }, photos);
  assert.equal(decodeURIComponent(form.get('subject')), '실제 메뉴');
  assert.equal(decodeURIComponent(form.get('content')), '&lt;script&gt;bad()&lt;/script&gt;<br>12달러<br><br>https://merchant.ca/menu');
  assert.equal(form.getAll('image').length, 2);
  assert.equal(new Uint8Array(await form.getAll('image')[1].arrayBuffer()).at(-1), 2);
  assert.equal(form.get('ccl'), 'false');
  assert.equal(form.get('openyn'), 'false');
});

test('사진은 앱 용량 한도와 실제 파일 시그니처를 함께 확인한다', async () => {
  assert.equal(typeof validCafePhoto, 'function');
  assert.equal(await validCafePhoto(new Blob([Uint8Array.from([255, 216, 255, 1])], { type: 'image/jpeg' })), true);
  assert.equal(await validCafePhoto(new Blob(['<script>bad()</script>'], { type: 'image/jpeg' })), false);
  assert.equal(await validCafePhoto(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/jpeg' })), false);
  assert.equal(await validCafePhoto(new Blob(['not image'], { type: 'text/html' })), false);
});

test('연결 토큰은 AES-GCM 암호화되고 다른 업체·계정에는 복호화되지 않는다', async () => {
  assert.equal(typeof encryptCafeTokens, 'function');
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  const encrypted = await encryptCafeTokens({ access_token: 'private-access', refresh_token: 'private-refresh' }, key, 'merchant:user');
  assert.ok(!encrypted.includes('private-access'));
  assert.deepEqual(await decryptCafeTokens(encrypted, key, 'merchant:user'), { access_token: 'private-access', refresh_token: 'private-refresh' });
  await assert.rejects(decryptCafeTokens(encrypted, key, 'other:user'));
  await assert.rejects(decryptCafeTokens(encrypted.slice(0, -4) + 'aaaa', key, 'merchant:user'));
});

test('발행 POST는 재시도하지 않으며 불확실 응답을 완료로 바꾸지 않는다', async () => {
  assert.equal(typeof submitCafeArticle, 'function');
  let count = 0;
  const draft = { title: '메뉴', body: '실제 원고', original_url: null, image_paths: [] };
  const board = { clubId: '123', menuId: '4' };
  const outcome = await submitCafeArticle(board, draft, [], 'secret-access', async (url, options) => {
    count++;
    assert.equal(url, 'https://openapi.naver.com/v1/cafe/123/menu/4/articles');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer secret-access');
    throw new TypeError('connection reset after server saved');
  });
  assert.deepEqual(outcome, { status: 'uncertain', articleUrl: null, errorCode: 'NAVER_PUBLISH_UNCERTAIN' });
  assert.equal(count, 1);
  const rejected = await submitCafeArticle(board, draft, [], 'token', async () => new Response(JSON.stringify({ message: { status: '500', error: { code: 'AP003' } } }), { status: 403 }));
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.errorCode, 'AP003');
  const success = await submitCafeArticle(board, draft, [], 'token', async () => new Response(JSON.stringify({ message: { status: '200', result: { cafeUrl: 'mycafe', articleId: 17, articleUrl: 'https://cafe.naver.com/mycafe/17' } } })));
  assert.equal(success.status, 'succeeded');
  assert.equal(success.articleUrl, 'https://cafe.naver.com/mycafe/17');
});


test('확정된 토큰 폐기만 연결 사용 불가로 분류하고 네트워크 오류는 유지한다', async () => {
  const source = fs.readFileSync(new URL('../supabase/functions/naver-cafe/index.ts', import.meta.url), 'utf8').split('async function naverTokens(')[1];
  const code = ts.transpileModule('async function naverTokens(' + source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = fetch => {
    const context = vm.createContext({ fetch, URLSearchParams, AbortSignal, Date, Number, Error });
    vm.runInContext(code, context);
    return context.naverTokens({ clientId: 'test', clientSecret: 'test' }, { grant_type: 'refresh_token', refresh_token: 'test' });
  };
  for (const error of ['invalid_grant', 'invalid_token']) {
    await assert.rejects(run(async () => new Response(JSON.stringify({ error }), { status: 400 })), /NAVER_CONNECTION_UNUSABLE/);
  }
  await assert.rejects(run(async () => { throw new Error('offline'); }), /offline/);
  await assert.rejects(run(async () => new Response('{}', { status: 500 })), /NAVER_RECONNECT_REQUIRED/);
  assert.equal((await run(async () => new Response(JSON.stringify({ access_token: 'fresh', expires_in: 3600 })))).access_token, 'fresh');
});
