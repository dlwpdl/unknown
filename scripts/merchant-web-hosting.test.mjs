import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { finishMerchantWeb } from './finish-merchant-web.mjs';
import { checkMerchantWeb } from './check-merchant-web.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'gling-merchant-hosting-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'), target = join(root, 'dist');
  mkdirSync(join(source, 'auth'), { recursive: true }); mkdirSync(join(source, '_expo'), { recursive: true }); mkdirSync(target);
  writeFileSync(join(source, '_expo', 'entry.js'), 'get_my_merchant_access');
  const html = '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><script src="/merchant/_expo/entry.js"></script>';
  for (const page of ['index.html', 'terms.html', 'privacy.html', 'auth/callback.html', 'auth/kakao.html']) writeFileSync(join(source, page), html);
  writeFileSync(join(target, 'index.html'), 'public home'); writeFileSync(join(target, '404.html'), 'existing public fallback');
  mkdirSync(join(target, '_expo')); writeFileSync(join(target, '_expo', 'public.js'), 'public reader');
  return { source, target };
}
test('merchant merge replaces only merchant files and preserves public home, assets and 404', t => {
  const { source, target } = fixture(t);
  mkdirSync(join(target, 'merchant')); writeFileSync(join(target, 'merchant', 'obsolete.js'), 'old bundle');
  finishMerchantWeb(source, target);
  assert.equal(readFileSync(join(target, 'index.html'), 'utf8'), 'public home');
  assert.equal(readFileSync(join(target, '404.html'), 'utf8'), 'existing public fallback');
  assert.equal(readFileSync(join(target, '_expo', 'public.js'), 'utf8'), 'public reader');
  assert.equal(existsSync(join(target, 'merchant', 'obsolete.js')), false);
  checkMerchantWeb(join(target, 'merchant'));
});
test('a missing, unmounted or administrator-contaminated merchant export cannot replace the previous artifact', t => {
  const { source, target } = fixture(t);
  mkdirSync(join(target, 'merchant')); writeFileSync(join(target, 'merchant', 'previous.txt'), 'keep');
  writeFileSync(join(source, 'index.html'), '<script src="/_expo/entry.js"></script>');
  assert.throws(() => finishMerchantWeb(source, target), /noindex|base path/);
  writeFileSync(join(source, 'index.html'), '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><script src="/merchant/_expo/missing.js"></script>');
  assert.throws(() => finishMerchantWeb(source, target), /missing/);
  writeFileSync(join(source, 'index.html'), '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><script src="/merchant/_expo/entry.js"></script>');
  writeFileSync(join(source, '_expo', 'entry.js'), 'get_admin_merchants');
  assert.throws(() => finishMerchantWeb(source, target), /Private admin/);
  assert.equal(readFileSync(join(target, 'merchant', 'previous.txt'), 'utf8'), 'keep');
});
test('the existing Pages build includes and checks merchant artifacts without a second deployment job', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.scripts['export:web'].includes('npm run export:merchant-web'));
  assert.ok(pkg.scripts['export:merchant-web'].includes('GLING_WEB_BASE_URL=/merchant'));
  assert.ok(pkg.scripts['check:merchant-web'].includes('check-merchant-web.mjs'));
  const workflow = readFileSync(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes('Export public reader and merchant workspace'));
  assert.ok(workflow.includes('npm run check:merchant-web'));
  assert.equal(workflow.split('actions/deploy-pages@').length - 1, 1);
});

test('merchant export rejects every administrator review and receipt RPC', t => {
  const { source } = fixture(t);
  for (const marker of ['get_admin_merchant_review_content', 'get_admin_merchant_receipt_reviews', 'set_admin_merchant_review_receipt']) {
    writeFileSync(join(source, '_expo', 'entry.js'), marker);
    assert.throws(() => checkMerchantWeb(source), /Private admin/);
  }
});
