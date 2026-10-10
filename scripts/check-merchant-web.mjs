import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkMerchantWeb(directory, base = '/merchant') {
  for (const file of ['index.html', 'auth/callback.html', 'auth/kakao.html', 'terms.html', 'privacy.html']) {
    assert.ok(existsSync(join(directory, file)), `Merchant web route missing: ${file}`);
  }
  const index = readFileSync(join(directory, 'index.html'), 'utf8');
  assert.ok(index.includes('noindex,nofollow'), 'Merchant web must use noindex');
  assert.ok(index.includes('no-referrer'), 'Merchant web must protect callback referrers');
  for (const file of readdirSync(directory, { recursive: true })) {
    assert.ok(!/(^|\/)(admin|chat|compose|notifications)(?:[./]|$)/.test(file), `Private route in merchant export: ${file}`);
    if (!/\.(html|js)$/.test(file)) continue;
    const content = readFileSync(join(directory, file), 'utf8');
    for (const marker of ['get_admin_merchant_review_reply_content', 'get_admin_analytics', 'get_admin_merchants', 'save_admin_merchant', 'get_admin_merchant_access', 'set_admin_merchant_access', 'set_admin_merchant_workspace_owner', 'connect_admin_merchant_account', 'get_admin_merchant_review_content', 'get_admin_merchant_receipt_reviews', 'set_admin_merchant_review_receipt', 'MFA_ADMIN_CONNECTION_REQUIRED', 'GLING / INSIGHTS']) {
      assert.ok(!content.includes(marker), `Private admin code ${marker} in merchant export: ${file}`);
    }
    if (!file.endsWith('.html')) continue;
    for (const [, resource] of content.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const url = new URL(resource, 'https://gling.ej-entertainment.com');
      if (url.origin !== 'https://gling.ej-entertainment.com' || !/\.(js|css|png|jpe?g|webp|svg|ico|woff2?|ttf)$/.test(url.pathname)) continue;
      assert.ok(url.pathname.startsWith(`${base}/`), `Merchant asset lost its base path: ${resource}`);
      const path = decodeURIComponent(url.pathname.slice(base.length + 1));
      assert.ok(!path.split('/').includes('..') && existsSync(join(directory, path)), `Merchant asset missing: ${resource}`);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkMerchantWeb(process.argv[2] ?? 'dist/merchant');
  console.log('Merchant web assets use /merchant and contain no private admin workspace code.');
}
