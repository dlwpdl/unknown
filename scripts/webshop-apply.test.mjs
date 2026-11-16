import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applicationProblems } from '../supabase/functions/_shared/webshop-application.ts';
import { ipCapKey } from '../supabase/functions/event-link/handler.ts';
import { applicationMail, handleWebshopApply, PUBLIC_ORIGIN } from '../supabase/functions/webshop-apply/handler.ts';
import { webshopApplicable } from '../src/lib/discovery.ts';

const valid = () => ({
  placeKey: 'osm:node:582801920', cityId: 'vancouver', placeName: 'Anh And Chi', name: '김사장', contact: '604-555-0100', email: 'owner@example.com',
  webshop: 'yes', webshopUrl: 'https://order.online/store/anh-and-chi-123', discount: '10', source: 'place',
});
const hex = value => createHash('sha256').update(value).digest('hex');

test('an application needs a place, a name and a contact; the email and link are optional', () => {
  assert.deepEqual(applicationProblems(valid()), []);
  assert.deepEqual(applicationProblems({ ...valid(), email: null, webshop: 'no', webshopUrl: null }), []);
  assert.deepEqual(applicationProblems({ ...valid(), placeKey: null, cityId: null, placeName: 'Main St 김밥집, 3388 Main St', source: 'web' }), []);
  assert.deepEqual(applicationProblems({}).sort(), ['contact', 'discount', 'email', 'name', 'place', 'source', 'webshop', 'webshopUrl'].sort());
  for (const blank of ['', '   ']) {
    assert.deepEqual(applicationProblems({ ...valid(), name: blank }), ['name']);
    assert.deepEqual(applicationProblems({ ...valid(), contact: blank }), ['contact']);
    assert.deepEqual(applicationProblems({ ...valid(), placeKey: null, cityId: null, placeName: blank }), ['place']);
  }
  // A picked place carries both its key and its city.
  assert.deepEqual(applicationProblems({ ...valid(), cityId: null }), ['place']);
  assert.deepEqual(applicationProblems({ ...valid(), placeKey: 'partner:x' }), ['place']);
  assert.deepEqual(applicationProblems({ ...valid(), email: 'not-an-email' }), ['email']);
  assert.deepEqual(applicationProblems({ ...valid(), webshop: 'maybe', webshopUrl: null, discount: '50', source: 'app' }), ['webshop', 'discount', 'source']);
});

test('lengths and control characters are capped like the database checks', () => {
  assert.deepEqual(applicationProblems({ ...valid(), name: '가'.repeat(100), contact: '1'.repeat(100) }), []);
  assert.deepEqual(applicationProblems({ ...valid(), name: '가'.repeat(101) }), ['name']);
  assert.deepEqual(applicationProblems({ ...valid(), contact: '1'.repeat(101) }), ['contact']);
  assert.deepEqual(applicationProblems({ ...valid(), placeName: 'a'.repeat(201) }), ['place']);
  assert.deepEqual(applicationProblems({ ...valid(), email: `${'a'.repeat(250)}@x.co` }), ['email']);
  assert.deepEqual(applicationProblems({ ...valid(), name: '김\n사장' }), ['name']);
  assert.deepEqual(applicationProblems({ ...valid(), webshopUrl: `https://order.online/${'a'.repeat(2048)}` }), ['webshopUrl']);
});

test('any https webshop link is accepted, and only when the owner said there is a webshop', () => {
  for (const url of ['https://www.order.store/ca/store/x/ZFgz2GjZSAuhlUYeO1fupA', 'https://order.online/store/anh-and-chi-123', 'https://shop.example.ca/menu?ref=1']) {
    assert.deepEqual(applicationProblems({ ...valid(), webshopUrl: url }), [], url);
  }
  for (const url of ['http://order.online/store/x', 'https://user:pw@order.online/store/x', 'https://order.online/store x', 'javascript:alert(1)', 'order.online/store/x']) {
    assert.deepEqual(applicationProblems({ ...valid(), webshopUrl: url }), ['webshopUrl'], url);
  }
  assert.deepEqual(applicationProblems({ ...valid(), webshop: 'no' }), ['webshopUrl']);
});

function setup({ answers = {}, mail = async () => {} } = {}) {
  const calls = [], mails = [];
  const rpc = async (name, args) => { calls.push({ name, args }); return name in answers ? answers[name] : null; };
  const sendMail = async (subject, text) => { mails.push({ subject, text }); await mail(); };
  const send = (body, { method = 'POST', origin = PUBLIC_ORIGIN, ip = '203.0.113.9', salt = 'salt' } = {}) => handleWebshopApply(
    new Request('https://example.test/functions/v1/webshop-apply', {
      method, headers: { ...(origin ? { origin } : {}), ...(ip ? { 'cf-connecting-ip': ip } : {}), 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    }), { rpc, sendMail, ipSalt: salt });
  return { calls, mails, send };
}
const saved = { submit_webshop_application: { ok: true, id: 'c2410000-0000-4000-8000-000000000001' } };

test('only the public site may post, and nothing malformed reaches the database', async () => {
  const { calls, send } = setup({ answers: saved });
  const preflight = await send(null, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), PUBLIC_ORIGIN);
  assert.equal((await send(valid(), { origin: 'https://evil.test' })).status, 403);
  assert.equal((await send(null, { method: 'GET' })).status, 405);
  assert.equal((await send('{')).status, 400);
  assert.equal((await send([valid()])).status, 400);
  assert.equal((await send({ ...valid(), name: 'x'.repeat(7000) })).status, 400, 'oversized body');
  assert.equal((await send({ ...valid(), admin: true })).status, 400, 'unknown key');
  assert.equal((await send({ ...valid(), contact: '' })).status, 400);
  assert.equal(calls.length, 0);
  const ok = await send(valid());
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls[0].args.p_application, valid());
});

test('a filled hidden field gets a quiet success and nothing is saved or mailed', async () => {
  const { calls, mails, send } = setup({ answers: saved });
  const response = await send({ ...valid(), website: 'https://spam.test' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls.length + mails.length, 0);
  assert.equal((await send({ ...valid(), website: '' })).status, 200, 'an empty hidden field is a real application');
  assert.equal(calls[0].name, 'submit_webshop_application');
});

test('the hourly cap answers 429 and the database only sees a salted address hash', async () => {
  const { calls, send } = setup({ answers: { submit_webshop_application: { ok: false, error: 'rate_limited' } } });
  assert.equal((await send(valid())).status, 429);
  assert.equal(calls[0].args.p_ip_sha256, hex(`webshop-apply:salt:${ipCapKey('203.0.113.9')}`));
  assert.ok(!JSON.stringify(calls).includes('203.0.113.9'));
  // One IPv6 /64 is one caller.
  await send(valid(), { ip: '2001:db8:1:2:aaaa::1' }); await send(valid(), { ip: '2001:db8:1:2:bbbb::2' });
  assert.equal(calls[1].args.p_ip_sha256, calls[2].args.p_ip_sha256);
  // Without an address or salt only the site-wide cap applies.
  await send(valid(), { ip: null }); await send(valid(), { salt: '' });
  assert.equal(calls[3].args.p_ip_sha256, null);
  assert.equal(calls[4].args.p_ip_sha256, null);
  const invalid = setup({ answers: { submit_webshop_application: { ok: false, error: 'invalid' } } });
  assert.equal((await invalid.send(valid())).status, 400);
  const down = setup({ answers: { submit_webshop_application: null } });
  assert.equal((await down.send(valid())).status, 503);
});

test('the database caps applications per address and site-wide, and nobody but the server reads the table', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261112120000_webshop_partner_applications.sql', import.meta.url), 'utf8');
  assert.match(sql, /delete from private\.webshop_application_attempts where created_at<clock_timestamp\(\)-interval '1 hour'/);
  assert.match(sql, /from private\.webshop_application_attempts\)>=60/);
  assert.match(sql, /where ip_sha256=p_ip_sha256\)>=5 then\s+return jsonb_build_object\('ok',false,'error','rate_limited'\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on private\.%I from public,anon,authenticated,service_role/);
  assert.match(sql, /grant execute on function public\.submit_webshop_application\(jsonb,text\),public\.set_webshop_application_email\(uuid,text\) to service_role;/);
  assert.match(sql, /grant execute on function public\.get_admin_webshop_applications\(\),public\.set_admin_webshop_application_status\(uuid,text\) to authenticated;/);
  assert.doesNotMatch(sql, /to anon/);
});

test('a failed or missing mail still accepts the application and only changes its mail status', async () => {
  for (const [error, status] of [[new Error('ADMIN_EMAIL_500'), 'failed'], [new Error('ADMIN_EMAIL_NOT_CONFIGURED'), 'not_configured']]) {
    const { calls, send } = setup({ answers: saved, mail: async () => { throw error; } });
    assert.equal((await send(valid())).status, 200);
    assert.deepEqual(calls[1], { name: 'set_webshop_application_email', args: { p_id: saved.submit_webshop_application.id, p_status: status } });
  }
  const { calls, send } = setup({ answers: saved });
  assert.equal((await send(valid())).status, 200);
  assert.equal(calls[1].args.p_status, 'sent');
});

test('names, contacts, emails, links and addresses never reach the logs or the mail', async () => {
  const lines = [], original = { log: console.log, warn: console.warn, error: console.error };
  for (const level of Object.keys(original)) console[level] = (...args) => lines.push(args.map(String).join(' '));
  let mails = [];
  try {
    for (const options of [{ mail: async () => { throw new Error('ADMIN_EMAIL_500'); } }, { mail: async () => { throw new Error('ADMIN_EMAIL_NOT_CONFIGURED'); } }]) {
      const run = setup({ answers: saved, ...options });
      await run.send(valid(), { ip: null });
      await run.send(valid(), { salt: '' });
      mails = mails.concat(run.mails);
    }
    const broken = setup({ answers: saved });
    broken.calls.push = () => { throw new Error(`database down for ${valid().contact}`); };
    assert.equal((await broken.send(valid())).status, 503);
  } finally { Object.assign(console, original); }
  assert.ok(lines.length > 0, 'the warnings themselves still run');
  const secrets = [valid().name, valid().contact, valid().email, valid().webshopUrl, '203.0.113.9'];
  for (const text of [...lines, ...mails.map(mail => `${mail.subject}\n${mail.text}`)]) {
    for (const secret of secrets) assert.ok(!text.includes(secret), `${secret} leaked: ${text}`);
  }
  const mail = applicationMail(valid());
  assert.match(mail.subject, /Anh And Chi/);
  assert.match(mail.text, /웹샵: 있어요 · 링크 있음/);
  assert.doesNotMatch(`${mail.subject}${mail.text}`, /Uber/);
});

test('the owner row shows only on map restaurants and cafes that no business or webshop holds yet', () => {
  const place = (id, category, nightlife = false) => ({ id, category, nightlife });
  const links = { 'osm:node:2': 'c2310000-0000-4000-8000-000000000001' };
  assert.equal(webshopApplicable(place('osm:node:1', 'food'), links), true);
  assert.equal(webshopApplicable(place('osm:node:3', 'cafe'), links), true);
  assert.equal(webshopApplicable(place('osm:node:2', 'food'), links), false, 'linked to a business, which is where a webshop lives');
  assert.equal(webshopApplicable(place('osm:node:1', 'food'), null), false, 'hidden until the links load');
  for (const other of [place('osm:node:4', 'places'), place('osm:node:5', 'food', true), place('osm:node:6', 'all')]) assert.equal(webshopApplicable(other, links), false, other.id);
  assert.equal(webshopApplicable(place('partner:webshop-store', 'food'), {}), false, 'curated partner places already carry a webshop');
  const screen = readFileSync(new URL('../src/app/places/[id].tsx', import.meta.url), 'utf8');
  assert.match(screen, /webshopApplicable\(place, businessLinks && businessLinks\.cityId === place\.cityId \? businessLinks\.links : null\) && <Pressable analyticsId="places\.detail\.owner_webshop"/);
  assert.match(screen, /\/business\?\$\{new URLSearchParams\(\{ place: target\.id, city: target\.cityId \}\)\}#webshop/);
});
