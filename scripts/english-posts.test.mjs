import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ENGLISH_POSTS, englishCandidates, englishPostsOn, languagePairProblems, prerenderEnglishPosts, renderEnglishPost, shellParts, usableTranslation, withEnglishVersion,
} from './english-posts.mjs';
import { renderPublicPost } from './prerender-public-posts.mjs';

const RENT = '1c8a66bb-f94b-4b51-bde6-087a92c69aea', JOB = '2d8a66bb-f94b-4b51-bde6-087a92c69aea', MEMBER = '3e8a66bb-f94b-4b51-bde6-087a92c69aea';
const CINDY = '3e91a11a-cafe-46b3-a318-5d0253cf9301', OTHER = '710e19c5-34b8-4968-b2f4-fbf167859ecf';
const TEMPLATE = '<!doctype html><html lang="ko"><head><title>글링</title><link rel="stylesheet" href="/_expo/static/css/reader-abc.css"/><link rel="stylesheet" href="/_expo/static/css/global-def.css"/><link rel="stylesheet" href="/_expo/static/css/business-ghi.css"/></head>'
  + '<body><div id="root"><div class="reader" style="--text:#ECE8E5;--accent:#9283AC;--accentFill:#746486" lang="ko"><img src="/assets/assets/brand/gling-night-wordmark.8139c422.png"/><h1>앱에서 이어가세요.</h1></div></div></body></html>';
const post = (id, extra = {}) => ({
  id, cityId: 'toronto', city: '토론토', label: '부동산', tagSlug: 'housing', title: '미드타운 Davisville 스튜디오 월 $1,700, 즉시 입주',
  preview: '렌트 내놓음 · 스튜디오 · $1,700/월\nDavisville 지하철역이 가깝고 학생도 환영한다고 해요.', author: 'Cindy Paik Pro Home Finders',
  authorIsBusiness: true, createdAt: '2026-11-10T22:16:13.470Z', lastmod: '2026-11-10T22:16:13.470Z', commentCount: 0, ...extra,
});
const ENGLISH = { title: 'Davisville studio for rent in Midtown Toronto, $1,700 a month', body: 'For rent · Studio · $1,700/month\nIt\'s close to Davisville subway station, and the listing says students are welcome.' };
const on = (extra = {}) => ({ startsOn: '2026-11-01', mode: 'include', businessIds: [CINDY], ...extra });
const NOW = Date.parse('2026-11-13T12:00:00Z');

// Fake public RPCs and translate-content: `translations` maps a post id to the server's reply (or an HTTP status).
function server({ owners = { [RENT]: CINDY, [JOB]: OTHER }, translations = { [RENT]: ENGLISH, [JOB]: ENGLISH } } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, token: options.headers['x-gling-search-token'] });
    if (url.endsWith('/rpc/get_public_post_businesses')) return Response.json(body.p_post_ids.filter(id => owners[id]).map(id => ({ post_id: id, business_id: owners[id] })));
    const reply = translations[body.id];
    return typeof reply === 'number' ? new Response('{}', { status: reply }) : Response.json({ translation: reply });
  };
  return { calls, fetcher, options: { url: 'https://example.supabase.co', key: 'publishable', searchToken: 'build-token', fetcher } };
}

function dist(posts) {
  const directory = mkdtempSync(join(tmpdir(), 'gling-en-'));
  mkdirSync(join(directory, 'posts'));
  writeFileSync(join(directory, '+not-found.html'), TEMPLATE);
  for (const item of posts) writeFileSync(join(directory, 'posts', `${item.id}.html`), renderPublicPost(TEMPLATE, item));
  writeFileSync(join(directory, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>https://gling.ej-entertainment.com/</loc></url></urlset>\n');
  return directory;
}

test('the switch ships off and a start date turns it on from that day', () => {
  assert.equal(ENGLISH_POSTS.startsOn, null);
  assert.equal(englishPostsOn(ENGLISH_POSTS, NOW), false);
  assert.equal(englishPostsOn(on({ startsOn: '2026-11-14' }), NOW), false);
  assert.equal(englishPostsOn(on({ startsOn: '2026-11-13' }), NOW), true);
  assert.equal(englishPostsOn(on({ startsOn: 'soon' }), NOW), false);
  assert.throws(() => englishPostsOn(on({ mode: 'all' }), NOW), /include\|exclude/);
});

test('while off, the build sends nothing and leaves the Korean pages and sitemap alone', async () => {
  const { calls, options } = server(), directory = dist([post(RENT)]);
  const before = readFileSync(join(directory, 'posts', `${RENT}.html`), 'utf8');
  assert.deepEqual(await prerenderEnglishPosts(directory, [post(RENT)], options, { now: NOW }), []);
  assert.deepEqual(calls, []);
  assert.equal(readFileSync(join(directory, 'posts', `${RENT}.html`), 'utf8'), before);
  assert.ok(!existsSync(join(directory, 'en')) && !readFileSync(join(directory, 'sitemap.xml'), 'utf8').includes('/en/posts/'));
});

test('include translates only listed businesses, exclude every business but the listed ones, members never', async () => {
  const posts = [post(RENT), post(JOB, { tagSlug: 'jobs', label: '구인구직' }), post(MEMBER, { authorIsBusiness: false })];
  const pick = async config => (await englishCandidates(posts, server().options, config)).map(item => item.id);
  assert.deepEqual(await pick(on()), [RENT]);
  assert.deepEqual(await pick(on({ mode: 'exclude' })), [JOB]);
  assert.deepEqual(await pick(on({ mode: 'exclude', businessIds: [] })), [RENT, JOB]);
  // An empty include list asks nobody anything.
  const quiet = server();
  assert.deepEqual(await englishCandidates(posts, quiet.options, on({ businessIds: [] })), []);
  assert.deepEqual(quiet.calls, []);
  // A businessId already on the post (#160/#161) skips the lookup.
  const known = server();
  assert.deepEqual((await englishCandidates([post(RENT, { businessId: CINDY.toUpperCase() })], known.options, on())).map(item => item.id), [RENT]);
  assert.deepEqual(known.calls, []);
});

test('an unchanged or still-Korean reply is not an English page; kept names are fine', () => {
  const source = { title: post(RENT).title, body: post(RENT).preview };
  assert.equal(usableTranslation(source, source), null);
  assert.equal(usableTranslation({ title: '스튜디오 렌트', body: '역 근처 스튜디오예요. 학생 환영해요.' }, source), null);
  assert.equal(usableTranslation({ title: 'Studio', body: '' }, source), null);
  assert.deepEqual(usableTranslation({ title: ' Studio for rent ', body: 'Posted by 퀸즈 코리아 프라퍼티 매니지먼트 near Yonge and Finch station.' }, source),
    { title: 'Studio for rent', body: 'Posted by 퀸즈 코리아 프라퍼티 매니지먼트 near Yonge and Finch station.' });
});

test('the build sends the Korean page text with its token, writes the English page and pairs both pages', async () => {
  const { calls, options } = server(), directory = dist([post(RENT)]);
  assert.deepEqual(await prerenderEnglishPosts(directory, [post(RENT)], options, { config: on(), now: NOW, hubs: new Map([['toronto/housing', { path: '/toronto/rent' }]]) }), [RENT]);
  const sent = calls.find(call => call.url.endsWith('/functions/v1/translate-content'));
  assert.deepEqual(sent.body, { kind: 'post', id: RENT, language: 'en', source: { title: post(RENT).title, body: post(RENT).preview } });
  assert.equal(sent.token, 'build-token');
  const english = readFileSync(join(directory, 'en', 'posts', `${RENT}.html`), 'utf8'), korean = readFileSync(join(directory, 'posts', `${RENT}.html`), 'utf8');
  assert.deepEqual(languagePairProblems(korean, english, RENT), []);
  assert.ok(korean.includes('Read in English') && /id="gling-static-crumbs"><nav[\s\S]*?<\/nav><p lang="ko"/.test(korean), 'the English link sits in the crumbs the landing keeps');
  assert.ok(english.includes('Auto-translated from Korean') && english.includes(`<h1>${ENGLISH.title}</h1>`) && english.includes('href="/toronto/rent" hreflang="ko">More Toronto rentals (in Korean)'));
  assert.ok(english.includes('"inLanguage":"en"') && english.includes(`"translationOfWork":{"@id":"https://gling.ej-entertainment.com/posts/${RENT}#post"}`));
  assert.ok(english.includes('href="/post?id=' + RENT + '" rel="nofollow"') && english.includes('November 10, 2026</time> · 0 comments'));
  // The app shell's script and its Korean not-found copy never reach the English page; the reader styles and palette do.
  assert.ok(!english.includes('<script src') && !english.includes('앱에서 이어가세요') && english.includes('reader-abc.css') && !english.includes('business-ghi.css') && english.includes('--accent:#9283AC'));
  assert.ok(readFileSync(join(directory, 'sitemap.xml'), 'utf8').includes(`<url><loc>https://gling.ej-entertainment.com/en/posts/${RENT}</loc><lastmod>2026-11-10</lastmod></url></urlset>`));
});

test('a missing or failed translation leaves that post with no English page and no language links', async () => {
  for (const reply of [500, 429, null, { title: post(RENT).title, body: post(RENT).preview }]) {
    const { options } = server({ translations: { [RENT]: reply } }), directory = dist([post(RENT)]);
    const before = readFileSync(join(directory, 'posts', `${RENT}.html`), 'utf8');
    assert.deepEqual(await prerenderEnglishPosts(directory, [post(RENT)], options, { config: on(), now: NOW }), []);
    assert.ok(!existsSync(join(directory, 'en', 'posts', `${RENT}.html`)));
    assert.equal(readFileSync(join(directory, 'posts', `${RENT}.html`), 'utf8'), before);
  }
});

test('an edited post is sent with its new text, and a deleted one gets no page on the next build', async () => {
  const edited = post(RENT, { preview: '렌트 내놓음 · 스튜디오 · $1,650/월' });
  const next = server({ translations: { [RENT]: { title: ENGLISH.title, body: 'For rent · Studio · $1,650/month' } } }), directory = dist([edited]);
  await prerenderEnglishPosts(directory, [edited], next.options, { config: on(), now: NOW });
  assert.equal(next.calls.at(-1).body.source.body, '렌트 내놓음 · 스튜디오 · $1,650/월');
  assert.ok(readFileSync(join(directory, 'en', 'posts', `${RENT}.html`), 'utf8').includes('$1,650/month'));
  // A removed post is no longer in the public feed the build reads, so nothing is written for it (each deploy exports a fresh dist).
  const gone = server(), empty = dist([]);
  assert.deepEqual(await prerenderEnglishPosts(empty, [], gone.options, { config: on(), now: NOW }), []);
  assert.ok(!existsSync(join(empty, 'en')));
});

test('hreflang pairs are checked both ways', () => {
  const shell = shellParts(TEMPLATE);
  const korean = withEnglishVersion(renderPublicPost(TEMPLATE, post(RENT)), RENT), english = renderEnglishPost(shell, post(RENT), ENGLISH);
  assert.deepEqual(languagePairProblems(korean, english, RENT), []);
  assert.match(languagePairProblems(renderPublicPost(TEMPLATE, post(RENT)), english, RENT).join('\n'), /Korean page .* lists no language versions/);
  assert.match(languagePairProblems(korean, renderEnglishPost(shell, post(JOB), ENGLISH), RENT).join('\n'), /English page .* lists/);
  assert.match(languagePairProblems(korean, english.replace('<html lang="en"', '<html lang="ko"'), RENT).join('\n'), /not lang="en"/);
});
