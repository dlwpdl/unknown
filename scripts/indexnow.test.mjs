import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { INDEXNOW_KEY, recentUrls, submitIndexNow } from './indexnow.mjs';

test('IndexNow sends only this site\'s pages changed in the last two days, with the key the host serves', async () => {
  const site = 'https://gling.ej-entertainment.com';
  const sitemap = `<urlset><url><loc>${site}/vancouver</loc><lastmod>2026-11-12</lastmod></url><url><loc>${site}/posts/a</loc><lastmod>2026-11-11</lastmod></url>`
    + `<url><loc>${site}/posts/old</loc><lastmod>2026-11-01</lastmod></url><url><loc>${site}/company/b</loc></url><url><loc>https://example.com/x</loc><lastmod>2026-11-12</lastmod></url></urlset>`;
  const urls = recentUrls(sitemap, Date.parse('2026-11-13T11:20:00Z'));
  assert.deepEqual(urls, [`${site}/vancouver`, `${site}/posts/a`]);
  assert.equal(readFileSync(new URL(`../public/${INDEXNOW_KEY}.txt`, import.meta.url), 'utf8'), INDEXNOW_KEY);
  const calls = [];
  assert.equal(await submitIndexNow(urls, async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { ok: true }; }), 'sent 2');
  assert.deepEqual(calls, [['https://api.indexnow.org/indexnow', { host: 'gling.ej-entertainment.com', key: INDEXNOW_KEY, keyLocation: `${site}/${INDEXNOW_KEY}.txt`, urlList: urls }]]);
  assert.equal(await submitIndexNow([], () => assert.fail('no request without new pages')), 'nothing new');
  await assert.rejects(submitIndexNow(urls, async () => ({ ok: false, status: 422 })), /422/);
});
