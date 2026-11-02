import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { newLink, parse, settings, SITE } from './event-links.mjs';

const run = promisify(execFile);
const campaign = 'e1530000-0000-0000-0000-000000000001';
const KEY = 'test-service-key-not-real';

// A stand-in for the project's REST endpoint, so the real script runs end to end without touching any database.
async function fakeSupabase(answer) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push({ path: request.url, apikey: request.headers.apikey, body: JSON.parse(body) });
      const [status, payload] = answer(request.url);
      response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { PATH: process.env.PATH, GLING_SUPABASE_SERVICE_ROLE_KEY: KEY, GLING_SUPABASE_URL: `http://127.0.0.1:${server.address().port}` };
  const script = (...args) => run(process.execPath, ['scripts/event-links.mjs', ...args], { env }).then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    error => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
  return { requests, script, close: () => server.close() };
}

test('arguments are checked before anything is sent', () => {
  assert.throws(() => parse(['create', '--campaign', 'nope', '--kind', 'apply', '--expires', '2030-01-01']));
  assert.throws(() => parse(['create', '--campaign', campaign, '--kind', 'shop', '--expires', '2030-01-01']));
  assert.throws(() => parse(['create', '--campaign', campaign, '--kind', 'apply', '--expires', '2030-02-30']));
  assert.throws(() => parse(['create', '--campaign', campaign, '--kind', 'store', '--expires', '2030-01-01', '--slug', 'store-slug']));
  assert.throws(() => parse(['create', '--campaign', campaign, '--kind', 'apply', '--expires', '2030-01-01', '--slug', 'Bad Slug']));
  assert.throws(() => parse(['revoke', '--id', 'x']));
  assert.throws(() => parse(['delete', '--campaign', campaign]));
  assert.deepEqual(parse(['create', '--campaign', campaign, '--kind', 'apply', '--expires', '2030-01-01', '--slug', 'galbi-nov']),
    { command: 'create', campaign, kind: 'apply', expires: '2030-01-01', slug: 'galbi-nov', dryRun: false });
});

test('settings follow the table limits, with a Reel due within 7 days at most', () => {
  const ok = { visit_dates: ['2030-01-02'], time_slots: ['18:00'], party_max: 2 };
  assert.deepEqual(settings(ok), { ...ok, reel_days_max: 7, support: [], instagram: null });
  for (const bad of [{ ...ok, visit_dates: [] }, { ...ok, visit_dates: ['2030-13-01'] }, { ...ok, time_slots: ['6pm'] }, { ...ok, party_max: 11 },
    { ...ok, reel_days_max: 8 }, { ...ok, reel_days_max: 0 }, { ...ok, support: [{ key: 'spa', covered: true }] },
    { ...ok, support: [{ key: 'meal', covered: true }, { key: 'meal', covered: false }] }, { ...ok, support: [{ key: 'meal', covered: 'yes' }] },
    { ...ok, instagram: 'not a handle' }, { ...ok, lede: 'x' }]) assert.throws(() => settings(bad), JSON.stringify(bad));
});

test('a store token is a 43-character secret kept only as its SHA-256; an apply slug is public', () => {
  const store = newLink('store');
  assert.match(store.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(store.hash, createHash('sha256').update(store.token).digest('hex'));
  assert.equal(store.url, `${SITE}/partner#${store.token}`);
  assert.notEqual(newLink('store').token, store.token);
  const apply = newLink('apply');
  assert.match(apply.slug, /^e-[0-9a-f]{12}$/);
  assert.deepEqual(newLink('apply', 'galbi-nov'), { slug: 'galbi-nov', token: null, hash: null, url: `${SITE}/apply?event=galbi-nov` });
});

test('a dry run needs no key, sends nothing and never shows a token', async () => {
  const { requests, script, close } = await fakeSupabase(() => [500, {}]);
  try {
    for (const args of [['create', '--campaign', campaign, '--kind', 'store', '--expires', '2030-01-01', '--dry-run'], ['revoke', '--id', campaign, '--dry-run']]) {
      const result = await script(...args);
      assert.equal(result.code, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /#[A-Za-z0-9_-]{43}/);
    }
    assert.equal(requests.length, 0);
  } finally { close(); }
});

test('a business without a logo gets no apply link, and the operator is told why', async () => {
  const { requests, script, close } = await fakeSupabase(() => [400, { code: 'P0001', message: 'BUSINESS_LOGO_REQUIRED' }]);
  try {
    const result = await script('create', '--campaign', campaign, '--kind', 'apply', '--expires', '2030-01-01', '--slug', 'galbi-nov');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /가게 로고가 없어요\. 로고를 먼저 올린 뒤 다시 만드세요/);
    assert.doesNotMatch(result.stdout, /apply\?event=/, 'no link is printed');
    assert.ok(!(result.stdout + result.stderr).includes(KEY), 'the key is never printed');
    assert.deepEqual(requests, [{ path: '/rest/v1/rpc/create_event_link', apikey: KEY,
      body: { p_campaign_id: campaign, p_kind: 'apply', p_slug: 'galbi-nov', p_token_sha256: null, p_expires_on: '2030-01-01' } }]);
  } finally { close(); }
});

test('without visit dates and times there is no apply link either', async () => {
  const { script, close } = await fakeSupabase(() => [400, { code: 'P0001', message: 'APPLY_SETTINGS_REQUIRED' }]);
  try {
    const result = await script('create', '--campaign', campaign, '--kind', 'apply', '--expires', '2030-01-01');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /방문 날짜·시간 설정이 없어요/);
  } finally { close(); }
});

test('a store link prints its token once and sends only the hash', async () => {
  const { requests, script, close } = await fakeSupabase(() => [200, 'e1560000-0000-0000-0000-000000000001']);
  try {
    const result = await script('create', '--campaign', campaign, '--kind', 'store', '--expires', '2030-01-01');
    assert.equal(result.code, 0, result.stderr);
    const token = /\/partner#([A-Za-z0-9_-]{43})/.exec(result.stdout)?.[1];
    assert.ok(token);
    assert.equal(requests[0].body.p_token_sha256, createHash('sha256').update(token).digest('hex'));
    assert.ok(!JSON.stringify(requests).includes(token), 'the token itself never leaves the script');
  } finally { close(); }
});

test('settings go through the settings function as typed', async () => {
  const { requests, script, close } = await fakeSupabase(() => [200, null]);
  const file = join(mkdtempSync(join(tmpdir(), 'event-links-')), 'settings.json');
  writeFileSync(file, JSON.stringify({ visit_dates: ['2030-01-02'], time_slots: ['18:00'], party_max: 2, instagram: '@Galbi.House',
    support: [{ key: 'meal', covered: true, note_en: 'Dinner for two', note_ko: '2인 식사' }] }));
  try {
    const result = await script('settings', '--campaign', campaign, '--file', file);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(requests[0].body, { p_campaign_id: campaign, p_visit_dates: ['2030-01-02'], p_time_slots: ['18:00'], p_party_max: 2, p_reel_days_max: 7,
      p_support: [{ key: 'meal', covered: true, note_en: 'Dinner for two', note_ko: '2인 식사' }], p_instagram: '@Galbi.House' });
  } finally { close(); }
});
