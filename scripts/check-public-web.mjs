import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkMerchantWeb } from './check-merchant-web.mjs';

const directory = process.argv[2] ?? 'dist';
assert.ok(existsSync(join(directory, 'index.html')), 'Public web export is missing');
assert.ok(existsSync(join(directory, 'company.html')), 'Public company route is missing');
assert.ok(existsSync(join(directory, 'meetups.html')), 'Public meetup discovery route is missing');
assert.equal(readFileSync(join(directory, 'ads.txt'), 'utf8').trim(), 'google.com, pub-2361293253164911, DIRECT, f08c47fec0942fa0', 'Public web seller declaration is missing');
for (const page of ['index', 'terms', 'privacy', 'account-deletion', 'child-safety']) {
  const html = readFileSync(join(directory, `${page}.html`), 'utf8');
  assert.ok(html.includes('gling-night-wordmark.') && html.includes('--accent:#9283AC') && html.includes('#746486'), `${page} lost the cinematic night brand`);
}
assert.ok(readFileSync(join(directory, 'index.html'), 'utf8').includes('https://apps.apple.com/ca/app/id6809273242'), 'Public web is missing the live iOS download');
// Universal/App Links: both files must ship at these exact paths (served by Pages without redirect) for the app to open shared links.
for (const file of ['apple-app-site-association', 'assetlinks.json']) {
  const path = join(directory, '.well-known', file);
  assert.ok(existsSync(path), `App link association file is missing: .well-known/${file}`);
  JSON.parse(readFileSync(path, 'utf8'));
}
for (const file of ['robots.txt', 'sitemap.xml', 'llms.txt']) assert.ok(existsSync(join(directory, file)), `Public discovery file is missing: ${file}`);
const robots = readFileSync(join(directory, 'robots.txt'), 'utf8');
assert.ok(robots.includes('Sitemap: https://gling.ej-entertainment.com/sitemap.xml'), 'Public sitemap is missing');
const sitemap = readFileSync(join(directory, 'sitemap.xml'), 'utf8');
assert.ok(!sitemap.includes('?city='), 'Sitemap must list canonical pages only');
if (process.env.GLING_PRERENDER_POSTS === '1') {
  // Prerendered posts are the indexable copies; the /post?id= shell below stays noindex.
  const posts = existsSync(join(directory, 'posts')) ? readdirSync(join(directory, 'posts')).filter(file => file.endsWith('.html')) : [];
  assert.ok(posts.length > 0 && sitemap.includes('https://gling.ej-entertainment.com/posts/'), 'Public post pages were not prerendered');
  const page = readFileSync(join(directory, 'posts', posts[0]), 'utf8');
  assert.ok(page.includes('content="index, follow') && page.includes('id="gling-static-post"') && !/noindex/.test(page), 'Prerendered post must be indexable with static content');
}
assert.ok(robots.includes('Disallow: /merchant/') && robots.includes('Disallow: /admin'), 'Private surfaces must remain outside public discovery');
assert.ok(readFileSync(join(directory, 'index.html'), 'utf8').includes('application/ld+json'), 'Public home structured data is missing');
assert.match(readFileSync(join(directory, 'index.html'), 'utf8'), /<script\b[^>]*src=[^>]*_expo\/[^>]*\.js/, 'Public web hydration scripts are missing');
assert.ok(/name="robots"[^>]*content="noindex/.test(readFileSync(join(directory, 'post.html'), 'utf8')), 'Login-protected detail route must not index private content');
assert.ok(existsSync(join(directory, 'company.html')), 'Public company reader route is missing');
const childSafety = readFileSync(join(directory, 'child-safety.html'), 'utf8');
assert.ok(childSafety.includes('--bg:') && childSafety.includes('--text:'), 'Legal page must define readable background/text colors');
for (const text of ['아동 안전 표준', 'CSAE', 'CSAM', 'gling@ej-entertainment.com', 'Cybertip.ca']) {
  assert.ok(childSafety.includes(text), `Child safety policy is missing: ${text}`);
}
if (existsSync(join(directory, 'merchant'))) checkMerchantWeb(join(directory, 'merchant'));
for (const file of readdirSync(directory, { recursive: true })) {
  if (file === 'merchant' || file.startsWith('merchant/')) continue;
  assert.ok(!/(^|\/)(admin|compose|notifications|meetup-create|user)(?:[./]|$)/.test(file), `Unrequested private route in public export: ${file}`);
  if (/^profile\//.test(file)) assert.equal(file, 'profile/membership.html', `Unrequested profile route in public export: ${file}`);
  if (!/\.(html|js)$/.test(file)) continue;
  const content = readFileSync(join(directory, file), 'utf8');
  for (const marker of ['react-native-google-mobile-ads', 'RNGoogleMobileAds']) assert.ok(!content.includes(marker), `Native ad SDK in public web export: ${file}`);
  for (const marker of ['get_admin_user_businesses', 'write_user_review', 'write_manner_review', 'get_manner_review_state', 'get_my_manner_feedback', 'appeal_manner_review', 'write_meetup_review', 'get_my_meetup_review_inbox', 'get_meetup_sessions', 'create_meetup_session', 'check_in_meetup', 'confirm_meetup_attendance', 'claim_meetup_attendance', 'get_chat_suggestion_context', 'send_suggested_message', 'get_admin_trust_content','review_admin_trust_target','get_trust_safety_content','get_message_safety_context','get_admin_merchant_review_reply_content', 'get_admin_analytics', 'get_admin_performance', 'get_admin_merchants', 'get_admin_partnerships', 'get_admin_creator_directory', 'get_admin_creator_deal', 'record_admin_creator_deal', 'link_admin_creator_deal_merchant', 'get_admin_merchant_creator_deals', 'save_admin_partnership', 'issue_admin_benefit_coupon', 'act_admin_benefit_coupon', 'save_admin_merchant', 'get_admin_merchant_review_content', 'get_admin_merchant_receipt_reviews', 'set_admin_merchant_review_receipt', 'get_my_merchant_profile', 'save_my_merchant_profile', 'MFA_ADMIN_CONNECTION_REQUIRED', 'GLING / INSIGHTS', 'create_meetup_with_post']) {
    assert.ok(!content.includes(marker), `App-only code (${marker}) in public export: ${file}`);
  }
}
for (const page of ['post.html', 'chat.html', 'meetup-join.html', 'meetup-profile.html', 'meetup-application.html', 'auth/callback.html', 'profile/membership.html']) assert.ok(existsSync(join(directory, page)), `Shared participant route missing: ${page}`);
console.log('Public discovery, login and participant routes are present; admin-only code remains excluded.');
