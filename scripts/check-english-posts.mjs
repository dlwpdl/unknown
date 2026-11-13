import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CITIES, TAGS } from '../src/lib/mock.ts';
import { previewImage } from '../src/lib/shared-link-preview.ts';
import { languagePairProblems, renderEnglishPost, shellParts, translateEnglishPost, usableTranslation, withEnglishVersion } from './english-posts.mjs';
import { renderPublicPost, rpc } from './prerender-public-posts.mjs';

// Local look at real English post pages without the build token (no local build has it, so `export:web` makes no post pages):
// reads business posts through the public RPCs the build uses, renders their Korean and English pages with the exported shell
// (run `npm run export:web` first) and checks each hreflang pair. Translations come from the server translator when
// GLING_SEARCH_BUILD_TOKEN is set and the second argument is `server`, otherwise from a JSON file of { "<post id>": { title, body } }.
//   node --experimental-strip-types scripts/check-english-posts.mjs <out-dir> <translations.json|server> <post-id>...
const [out, source, ...ids] = process.argv.slice(2);
if (!out || !source || !ids.length) throw new Error('usage: check-english-posts.mjs <out-dir> <translations.json|server> <post-id>...');
const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, ''), key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required');
const translations = source === 'server' ? null : JSON.parse(readFileSync(source, 'utf8'));
const template = readFileSync(join('dist', '+not-found.html'), 'utf8'), shell = shellParts(template);
const owners = new Set((await rpc(url, key, 'get_public_post_businesses', { p_post_ids: ids }, fetch)).map(item => String(item.post_id).toLowerCase()));
const report = [];
for (const id of ids.map(value => value.toLowerCase())) {
  const preview = await rpc(url, key, 'get_shared_link_preview', { p_post_id: id }, fetch);
  if (preview?.id?.toLowerCase() !== id || preview.kind === 'meetup') { report.push({ id, skipped: 'not a public post' }); continue; }
  if (!owners.has(id)) { report.push({ id, skipped: 'not a business post' }); continue; }
  const post = { ...preview, id, cityId: CITIES.find(city => city.name === preview.city)?.id ?? null, tagSlug: TAGS.find(tag => tag.label === preview.label)?.slug ?? null,
    authorIsBusiness: true, lastmod: preview.createdAt, imageUrl: preview.imagePath ? previewImage(id) : undefined };
  const text = { title: post.title, body: post.preview || post.teaser || '' };
  const translation = translations ? usableTranslation(translations[id], text) : await translateEnglishPost(post, { url, key, searchToken: process.env.GLING_SEARCH_BUILD_TOKEN });
  if (!translation) { report.push({ id, skipped: 'no usable translation' }); continue; }
  const korean = withEnglishVersion(renderPublicPost(template, post), id), english = renderEnglishPost(shell, post, translation);
  mkdirSync(join(out, 'posts'), { recursive: true }); mkdirSync(join(out, 'en', 'posts'), { recursive: true });
  writeFileSync(join(out, 'posts', `${id}.html`), korean);
  writeFileSync(join(out, 'en', 'posts', `${id}.html`), english);
  report.push({ id, title: translation.title, problems: languagePairProblems(korean, english, id) });
}
console.log(JSON.stringify(report, null, 1));
if (report.some(item => item.problems?.length)) process.exitCode = 1;
