import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { decodeSharedUuid, encodeSharedUuid } from '../src/lib/shared-uuid.ts';
import test from 'node:test';
import { buildSharedPostUrl, sharedLinkTarget, sharedLinkInMessage, sharedPostMessage, sharedPostReturnPath } from '../src/lib/sharing.ts';

test('public web sharing and clipboard fallback use the existing short post URL', async () => {
  const id = 'b20b2f28-5902-461d-8ffc-ffef3f23b2c0';
  const source = readFileSync(new URL('../src/components/public-web/reader.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  async function share()'), end = source.indexOf('\n\n  return <div', start);
  assert.ok(start > 0 && end > start);
  for (const nativeShare of [true, false]) {
    const calls = [], exports = {};
    vm.runInNewContext(ts.transpileModule(source.slice(start, end) + '\nexports.share = share;', {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText, { exports, postId: id, post: { title: 'Shared title', body: 'private-body-sentinel' }, buildSharedPostUrl,
      window: { location: { origin: 'https://gling.ej-entertainment.com' } },
      navigator: { share: nativeShare ? async payload => { calls.push(['share', payload]); } : undefined,
        clipboard: { writeText: async url => { calls.push(['copy', url]); } } },
      setShareMessage: message => calls.push(['message', message]),
    });
    await exports.share();
    const shared = calls.find(call => call[0] === (nativeShare ? 'share' : 'copy'));
    assert.equal(nativeShare ? shared[1].url : shared[1], buildSharedPostUrl(id));
    assert.equal(JSON.stringify(calls).includes('private-body-sentinel'), false);
  }
});

test('별도 웹 주소는 유지하고 글링 공유는 미리보기 경로로 연결한다', () => {
  assert.equal(buildSharedPostUrl('post 1', 'https://gling.example/'), 'https://gling.example/post?id=post%201');
  assert.equal(buildSharedPostUrl('post 1'), 'https://gling-share-preview.vercel.app/share/post%201');
});

test('HTML을 텍스트로 반환하는 Supabase 공유 함수 대신 공개 글 화면을 쓴다', () => {
  assert.equal(buildSharedPostUrl('post 1', undefined, 'https://project.supabase.co/functions/v1/public-post'), 'https://gling-share-preview.vercel.app/share/post%201');
});

test('별도로 설정한 공개 공유 주소는 유지한다', () => {
  assert.equal(buildSharedPostUrl('post 1', undefined, 'https://gling.example/share/'), 'https://gling.example/share?id=post%201');
});

const id = '12345678-1234-1234-1234-123456789abc';
const short = 'EjRWeBI0EjQSNBI0VniavA';
test('the verified preview gateway uses its UUID route and keeps login on the original site', () => {
  assert.equal(buildSharedPostUrl(id, 'https://gling.ej-entertainment.com/'), `https://gling-share-preview.vercel.app/s/${short}`);
  assert.equal(buildSharedPostUrl(id, undefined, 'https://gling-share-preview.vercel.app/share/'), `https://gling-share-preview.vercel.app/s/${short}`);
  assert.deepEqual(sharedLinkTarget(`https://gling-share-preview.vercel.app/share/${id}?invite=1`), { id, invite: true });
  for (const url of [`https://gling-share-preview.vercel.app.evil.test/share/${id}`, `https://user@gling-share-preview.vercel.app/share/${id}`, `https://gling-share-preview.vercel.app/post?id=${id}`, `https://gling-share-preview.vercel.app/auth/callback?id=${id}`]) assert.equal(sharedLinkTarget(url), null);
  assert.equal(sharedPostReturnPath(`https://gling-share-preview.vercel.app/post?id=${id}`), '/');
});
test('only owned Gling links become internal preview cards', () => {
  assert.deepEqual(sharedLinkTarget(`https://gling.ej-entertainment.com/share/${id}`), { id, invite: false });
  assert.deepEqual(sharedLinkTarget(`https://gling.ej-entertainment.com/post?id=${id}&invite=1`), { id, invite: true });
  assert.deepEqual(sharedLinkTarget(`https://gling.ej-entertainment.com/post/${id}`), { id, invite: false });
  for (const url of [`https://gling.ej-entertainment.com.evil.test/share/${id}`, `https://evil.test/share/${id}`, `http://gling.ej-entertainment.com/share/${id}`, `https://user@glig.ej-entertainment.com/share/${id}`, `https://gling.ej-entertainment.com/share/${id}/private`, `https://gling.ej-entertainment.com/post?id=${id}&id=other`]) assert.equal(sharedLinkTarget(url), null);
  assert.equal(sharedLinkInMessage(`같이 가요\nhttps://evil.test\nhttps://gling.ej-entertainment.com/share/${id}`), `https://gling.ej-entertainment.com/share/${id}`);
});
test('outbound sharing never copies the post body or private meetup location', () => {
  const post = { id, title: '페스티벌 같이 가요', body: '비공개 상세 집결 장소', room: {} };
  const text = sharedPostMessage(post);
  assert.ok(text.includes('페스티벌 같이 가요'));
  assert.ok(text.includes(`/s/${short}`));
  assert.ok(!text.includes(post.body));
});
test('login resumes only a validated local post, never an external redirect', () => {
  assert.equal(sharedPostReturnPath(`/post?id=${id}&invite=1`), `/post?id=${id}&invite=1`);
  for (const path of [`//evil.test/post?id=${id}`, `https://evil.test/post?id=${id}`, `/auth/callback?next=${id}`, `/post?id=${id}&id=other`, '/post?id=invalid', null]) assert.equal(sharedPostReturnPath(path), '/');
  assert.equal(sharedPostReturnPath(`/post?id=${id}&next=https://evil.test`), `/post?id=${id}`);
});

test('short UUID routes round trip without accepting malformed or noncanonical aliases', () => {
  const gateway = 'https://gling-share-preview.vercel.app';
  assert.equal(buildSharedPostUrl(id.toUpperCase()), `${gateway}/s/${short}`);
  assert.equal(buildSharedPostUrl(id, 'https://custom.example'), `https://custom.example/post?id=${id}`);
  assert.equal(buildSharedPostUrl(id, undefined, 'https://custom.example/share'), `https://custom.example/share?id=${id}`);
  assert.equal(buildSharedPostUrl(id).length, 63);
  assert.deepEqual(sharedLinkTarget(`${gateway}/s/${short}/?invite=1`), { id, invite: true });
  assert.equal(sharedLinkInMessage(`hello ${gateway}/s/${short}`), `${gateway}/s/${short}`);
  for (const value of [short.slice(0, -1) + 'B', short + '=', short.slice(1), short + 'A', short.slice(0, -1) + '+', '%45' + short.slice(1), id, short + '/private']) {
    assert.equal(sharedLinkTarget(`${gateway}/s/${value}`), null, value);
  }
  for (const bad of [`https://user:pass@gling-share-preview.vercel.app/s/${short}`, `https://evil.example/s/${short}`, `http://gling-share-preview.vercel.app/s/${short}`]) assert.equal(sharedLinkTarget(bad), null);
});

test('short encoding preserves all UUID bits including URL-safe alphabet bytes', () => {
  for (const uuid of ['00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'fbff0000-0000-4000-8000-000000000001', id]) {
    const encoded = Buffer.from(uuid.replaceAll('-', ''), 'hex').toString('base64url');
    const url = `https://gling-share-preview.vercel.app/s/${encoded}`;
    assert.equal(buildSharedPostUrl(uuid), url);
    assert.deepEqual(sharedLinkTarget(url), { id: uuid, invite: false });
    for (const suffix of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_') {
      if (suffix !== encoded.at(-1) && Buffer.from(encoded.slice(0, -1) + suffix, 'base64url').equals(Buffer.from(encoded, 'base64url'))) assert.equal(sharedLinkTarget(url.slice(0, -1) + suffix), null);
    }
  }
  for (const malformed of [id.replaceAll('-', ''), id + 'x', id.replace('1', 'g'), '']) assert.equal(buildSharedPostUrl(malformed), `https://gling-share-preview.vercel.app/share/${encodeURIComponent(malformed)}`);
});

test('codec rejects non-UUID inputs and noncanonical base64url at its boundary', () => {
  assert.equal(encodeSharedUuid(id), short);
  assert.equal(decodeSharedUuid(short), id);
  for (const invalid of [id + '\n', id + '\r', id + ' ', id.replaceAll('-', ''), '']) assert.equal(encodeSharedUuid(invalid), null);
  for (const invalid of [short + '\n', short + '\r', short + ' ', short + '==', short.slice(0, -1) + 'B', short.replace('E', '+'), '']) assert.equal(decodeSharedUuid(invalid), null);
});

test('explicit owned gateway share and short aliases generate short links while custom endpoints stay exact', () => {
  for (const path of ['/share', '/share/', '/s', '/s/']) assert.equal(buildSharedPostUrl(id, 'https://custom.example', `https://gling-share-preview.vercel.app${path}`), `https://gling-share-preview.vercel.app/s/${short}`);
  for (const base of ['https://custom.example/share', 'https://custom.example/s', 'https://gling-share-preview.vercel.app.evil.example/share']) assert.equal(buildSharedPostUrl(id, undefined, base), `${base}?id=${id}`);
});
