import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkMerchantWeb } from './check-merchant-web.mjs';
import { publicWebFetch } from '../src/lib/public-web.ts';

const privateRpcs = ['get_admin_performance', 'write_user_review', 'write_manner_review', 'get_manner_review_state', 'get_my_manner_feedback', 'appeal_manner_review',
  'write_meetup_review', 'get_my_meetup_review_inbox', 'get_meetup_sessions', 'create_meetup_session', 'check_in_meetup',
  'confirm_meetup_attendance', 'claim_meetup_attendance', 'get_chat_suggestion_context', 'send_suggested_message',
  'get_admin_trust_content', 'review_admin_trust_target', 'get_trust_safety_content', 'get_message_safety_context'];

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'gling-web-trust-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const publicDir = join(root, 'public'), merchantDir = join(publicDir, 'merchant');
  for (const dir of [publicDir, merchantDir]) {
    mkdirSync(join(dir, '_expo'), { recursive: true }); mkdirSync(join(dir, 'auth'));
  }
  mkdirSync(join(publicDir, 'profile'));
  const publicHtml = '<meta name="robots" content="noindex"><style>--bg:#111;--text:#fff;--accent:#9283AC;color:#746486</style>gling-night-wordmark.png https://apps.apple.com/ca/app/id6809273242 <script type="application/ld+json">{}</script> 아동 안전 표준 CSAE CSAM gling@ej-entertainment.com Cybertip.ca';
  for (const page of ['index', 'company', 'terms', 'privacy', 'account-deletion', 'child-safety', 'post', 'chat', 'meetup-join', 'meetup-profile', 'meetup-application', 'auth/callback', 'profile/membership']) writeFileSync(join(publicDir, `${page}.html`), publicHtml);
  writeFileSync(join(publicDir, 'robots.txt'), 'Sitemap: https://gling.ej-entertainment.com/sitemap.xml format=sitemap&city= Disallow: /merchant/ Disallow: /admin');
  for (const file of ['sitemap.xml', 'llms.txt']) writeFileSync(join(publicDir, file), 'public discovery');
  const merchantHtml = '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><script src="/merchant/_expo/entry.js"></script>';
  for (const page of ['index', 'terms', 'privacy', 'auth/callback', 'auth/kakao']) writeFileSync(join(merchantDir, `${page}.html`), merchantHtml);
  return { publicDir, merchantDir, publicBundle: join(publicDir, '_expo', 'entry.js'), merchantBundle: join(merchantDir, '_expo', 'entry.js') };
}
const checkPublic = directory => spawnSync(process.execPath, [fileURLToPath(new URL('./check-public-web.mjs', import.meta.url)), directory], { encoding: 'utf8' });

test('anonymous public transport rejects every private trust and suggestion RPC before sending', async () => {
  let calls = 0;
  const request = publicWebFetch('https://example.supabase.co', 'public-key', async () => { calls++; return new Response('{}'); });
  for (const marker of privateRpcs) await assert.rejects(request(`https://example.supabase.co/rest/v1/rpc/${marker}`, { method: 'POST', body: '{}' }), /PUBLIC_WEB_READ_ONLY/);
  assert.equal(calls, 0);
});

test('public and merchant exports preserve public review getters and merchant asset paths', t => {
  const files = fixture(t);
  const publicRpcs = 'get_manner_summary get_public_user_profile get_public_user_activity get_meetup_reviews';
  writeFileSync(files.publicBundle, publicRpcs); writeFileSync(files.merchantBundle, `${publicRpcs} get_my_merchant_access`);
  checkMerchantWeb(files.merchantDir);
  const result = checkPublic(files.publicDir); assert.equal(result.status, 0, result.stderr);
});

for (const marker of privateRpcs) {
  test(`public and merchant exports reject private RPC ${marker}`, t => {
    const files = fixture(t);
    writeFileSync(files.publicBundle, marker); writeFileSync(files.merchantBundle, 'get_my_merchant_access');
    const result = checkPublic(files.publicDir);
    assert.notEqual(result.status, 0, `${marker} escaped public bundle verification`);
    assert.ok(result.stderr.includes(marker), result.stderr);
    writeFileSync(files.publicBundle, 'get_manner_summary'); writeFileSync(files.merchantBundle, marker);
    assert.throws(() => checkMerchantWeb(files.merchantDir), error => error.message.includes(marker), `${marker} escaped merchant bundle verification`);
    const nested = checkPublic(files.publicDir);
    assert.notEqual(nested.status, 0, `${marker} escaped nested merchant verification`);
    assert.ok(nested.stderr.includes(marker), nested.stderr);
  });
}
