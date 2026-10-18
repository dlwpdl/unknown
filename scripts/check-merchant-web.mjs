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
    for (const marker of ['get_admin_user_businesses', 'write_user_review', 'write_manner_review', 'get_manner_review_state', 'get_my_manner_feedback', 'appeal_manner_review', 'write_meetup_review', 'get_my_meetup_review_inbox', 'get_meetup_sessions', 'create_meetup_session', 'check_in_meetup', 'confirm_meetup_attendance', 'claim_meetup_attendance', 'get_chat_suggestion_context', 'send_suggested_message', 'get_admin_trust_content', 'review_admin_trust_target', 'get_trust_safety_content', 'get_message_safety_context', 'get_admin_merchant_review_reply_content', 'get_admin_analytics', 'get_admin_performance', 'get_admin_merchants', 'get_admin_partnerships', 'get_admin_creator_directory', 'get_admin_creator_deal', 'record_admin_creator_deal', 'link_admin_creator_deal_merchant', 'get_admin_merchant_creator_deals', 'save_admin_partnership', 'issue_admin_benefit_coupon', 'act_admin_benefit_coupon', 'save_admin_merchant', 'get_admin_merchant_access', 'set_admin_merchant_access', 'set_admin_merchant_workspace_owner', 'connect_admin_merchant_account', 'get_admin_merchant_review_content', 'get_admin_merchant_receipt_reviews', 'set_admin_merchant_review_receipt', 'MFA_ADMIN_CONNECTION_REQUIRED', 'GLING / INSIGHTS']) {
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
