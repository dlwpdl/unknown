import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_SITE } from '../src/lib/public-seo.ts';

// IndexNow tells participating search engines about new or changed pages right after a deploy. The key is public by design:
// the engines check that public/<KEY>.txt on this host holds the same value.
export const INDEXNOW_KEY = 'edecc9634af6e4ed527cad208c3d45a5';

// Sitemap addresses whose lastmod (a UTC day) is today or one of the two days before, at most the 10,000 one request may carry.
export function recentUrls(sitemap, now = Date.now()) {
  const since = new Date(now - 2 * 864e5).toISOString().slice(0, 10);
  return [...sitemap.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod><\/url>/g)]
    .filter(([, loc, day]) => loc.startsWith(`${PUBLIC_SITE}/`) && day >= since).map(([, loc]) => loc).slice(0, 10000);
}

export async function submitIndexNow(urlList, fetcher = fetch) {
  if (!urlList.length) return 'nothing new';
  const response = await fetcher('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(PUBLIC_SITE).host, key: INDEXNOW_KEY, keyLocation: `${PUBLIC_SITE}/${INDEXNOW_KEY}.txt`, urlList }),
  });
  if (!response.ok) throw new Error(`IndexNow answered ${response.status}`);
  return `sent ${urlList.length}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`IndexNow: ${await submitIndexNow(recentUrls(readFileSync(resolve(process.argv[2] ?? 'dist', 'sitemap.xml'), 'utf8')))}`);
}
