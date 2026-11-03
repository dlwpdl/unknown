import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { handleEventLink, PUBLIC_ORIGIN } from '../supabase/functions/event-link/handler.ts';

const token = 'A'.repeat(21) + '_' + 'b'.repeat(20) + '-';
const hex = value => createHash('sha256').update(value).digest('hex');
const entry = { apply: 'open-event', handle: 'someone', slots: [{ date: '2030-01-02', time: '18:00' }], party: 2, allergies: null, reel_days: 5, language: 'en' };
function setup(answers = {}) {
  const calls = [];
  const rpc = async (name, args) => { calls.push({ name, args }); return name in answers ? answers[name] : null; };
  // The caller writes X-Forwarded-For's first value; Cloudflare sets CF-Connecting-IP.
  const send = (body, { method = 'POST', origin = PUBLIC_ORIGIN, ip = '203.0.113.9', forwarded = '198.51.100.7, 203.0.113.9', salt = 'salt' } = {}) => handleEventLink(
    new Request('https://example.test/functions/v1/event-link', {
      method, headers: { ...(origin ? { origin } : {}), ...(ip ? { 'cf-connecting-ip': ip } : {}), 'x-forwarded-for': forwarded, 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    }), { rpc, ipSalt: salt });
  return { calls, send };
}

test('only the public site may call it from a browser, and every answer is uncached', async () => {
  const { calls, send } = setup();
  const preflight = await send(null, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), PUBLIC_ORIGIN);
  assert.match(preflight.headers.get('access-control-allow-headers'), /apikey/);
  const foreign = await send({ apply: 'open-event' }, { origin: 'https://evil.test' });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  assert.equal((await send(null, { method: 'GET' })).status, 405);
  for (const response of [preflight, foreign]) {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  assert.equal(calls.length, 0);
});

test('apply info reads one valid slug and hides missing events behind 404', async () => {
  const event = { title: 'Open event', business: 'Shop', terms: 'Post one reel', ends_on: '2030-01-01', deadline_note: '' };
  const found = setup({ event_apply_info: event });
  const response = await found.send({ apply: 'open-event' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { event });
  assert.deepEqual(found.calls, [{ name: 'event_apply_info', args: { p_slug: 'open-event' } }]);
  const missing = setup();
  assert.equal((await missing.send({ apply: 'gone-event' })).status, 404);
  assert.equal((await missing.send({ apply: 'Bad Slug' })).status, 404);
  assert.equal((await missing.send({ apply: '../x' })).status, 404);
  assert.equal(missing.calls.length, 1, 'malformed slugs never reach the database');
});

test('an entry sends only a salted IP hash and answers ok without saying whether the handle applied before', async () => {
  const { calls, send } = setup({ event_apply: { ok: true, already: true } });
  const slots = [{ date: '2030-01-02', time: '18:00' }, { time: '19:00', date: '2030-01-03' }];
  const response = await send({ ...entry, handle: '@Someone', slots, party: 3, allergies: 'Peanuts', reel_days: 7, language: 'ko' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(calls[0], { name: 'event_apply', args: {
    p_slug: 'open-event', p_handle: '@Someone', p_slots: slots, p_party: 3, p_allergies: 'Peanuts', p_reel_days: 7, p_language: 'ko',
    p_ip_sha256: hex('salt:203.0.113.9'),
  } });
  assert.ok(!JSON.stringify(calls).includes('203.0.113.9'), 'the raw IP never leaves the function');
});

test('the hourly IP cap keys on the address Cloudflare saw, never on a forwarded value the caller wrote', async () => {
  const { calls, send } = setup({ event_apply: { ok: true, already: false } });
  await send(entry, { forwarded: '198.51.100.1' });
  await send(entry, { forwarded: '198.51.100.2' });
  assert.deepEqual(calls.map(call => call.args.p_ip_sha256), [hex('salt:203.0.113.9'), hex('salt:203.0.113.9')]);
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await send(entry, { ip: '' })).status, 200);
  } finally { console.warn = warn; }
  assert.equal(calls[2].args.p_ip_sha256, null, 'no Cloudflare address: the database applies only the per-event cap');
});

test('entry problems map to clear statuses and bad input never reaches the database', async () => {
  for (const [error, status] of [['not_found', 404], ['invalid', 400], ['rate_limited', 429], ['busy', 503], ['surprise', 503]]) {
    const { send } = setup({ event_apply: { ok: false, error } });
    assert.equal((await send(entry)).status, status, error);
  }
  const { calls, send } = setup({ event_apply: { ok: true } });
  for (const body of [
    { ...entry, language: 'fr' }, { ...entry, language: undefined },
    { ...entry, handle: 7 }, { ...entry, handle: 'x'.repeat(65) },
    { ...entry, slots: [] }, { ...entry, slots: [entry.slots[0], entry.slots[0], entry.slots[0]] }, { ...entry, slots: entry.slots[0] },
    { ...entry, slots: ['2030-01-02 18:00'] }, { ...entry, slots: [{ date: '2030-01-02', time: '18:00', note: 'x' }] },
    { ...entry, slots: [{ date: '2030-01-02' }] }, { ...entry, slots: [{ date: 20300102, time: '18:00' }] },
    { ...entry, party: 0 }, { ...entry, party: 11 }, { ...entry, party: 2.5 }, { ...entry, party: '2' },
    { ...entry, reel_days: 0 }, { ...entry, reel_days: 8 }, { ...entry, reel_days: null },
    { ...entry, allergies: undefined }, { ...entry, allergies: 7 }, { ...entry, allergies: 'x'.repeat(201) },
    { ...entry, admin: true }, { ...entry, available: 'Weekends' },
    { apply: 'open-event', store: token, handle: 'someone' },
    [], 'not json', '{"apply":"' + 'a'.repeat(2000) + '"}',
  ]) assert.equal((await send(body)).status, 400, JSON.stringify(body).slice(0, 80));
  assert.equal((await send(entry, { salt: '' })).status, 503, 'no salt, no entries');
  assert.equal(calls.length, 0);
});

test('the store token is hashed before the database sees it, and a check returns its status and recorded use', async () => {
  const view = { title: 'Open event', winners: [], applicant_count: 3, benefits: [] };
  const use = '0b6d5a4e-1f2a-4c3b-9d8e-7f6a5b4c3d2e';
  const { calls, send } = setup({ event_store_view: view, event_store_check: { status: 'winner', use_id: use, uses: 2, meal_used: true, extra: 'ignored' },
    event_store_undo: { ok: true, uses: 1 } });
  const opened = await send({ store: token });
  assert.equal(opened.status, 200);
  assert.deepEqual(await opened.json(), { view });
  const looked = await send({ store: token, handle: 'winner.one' });
  assert.deepEqual(await looked.json(), { status: 'winner', use_id: use, uses: 2, meal_used: true });
  const undone = await send({ store: token, undo: use });
  assert.deepEqual(await undone.json(), { undone: true });
  assert.deepEqual(calls, [
    { name: 'event_store_view', args: { p_token_sha256: hex(token) } },
    { name: 'event_store_check', args: { p_token_sha256: hex(token), p_handle: 'winner.one' } },
    { name: 'event_store_undo', args: { p_token_sha256: hex(token), p_use_id: use } },
  ]);
  assert.ok(!JSON.stringify(calls).includes(token), 'the raw token never leaves the function');
  const none = setup({ event_store_check: { status: 'none' }, event_store_undo: { ok: false } });
  assert.deepEqual(await (await none.send({ store: token, handle: 'nobody' })).json(), { status: 'none' });
  assert.deepEqual(await (await none.send({ store: token, undo: use })).json(), { undone: false });
  const missing = setup();
  assert.equal((await missing.send({ store: token })).status, 404);
  assert.equal((await missing.send({ store: token, handle: 'someone' })).status, 404);
  assert.equal((await missing.send({ store: token, undo: use })).status, 404);
  assert.equal((await missing.send({ store: 'short' })).status, 404);
  assert.equal((await missing.send({ store: token, handle: ['x'] })).status, 400);
  assert.equal((await missing.send({ store: token, extra: 1 })).status, 400);
  assert.equal((await missing.send({ store: token, undo: 'not-a-use' })).status, 400);
  assert.equal((await missing.send({ store: token, undo: use.toUpperCase() })).status, 400);
  assert.equal((await missing.send({ store: token, handle: 'someone', undo: use })).status, 400);
  assert.equal(missing.calls.length, 3, 'bad input never reaches the database');
});

test('a database failure answers 503 without details', async () => {
  const response = await handleEventLink(new Request('https://example.test', { method: 'POST', body: JSON.stringify({ apply: 'open-event' }) }),
    { rpc: async () => { throw new Error('connection details'); }, ipSalt: 'salt' });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'unavailable' });
});
