import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { appPathForLink } from '../src/lib/app-links.ts';
import { claimRememberedInvite, INVITE_CODE_KEY, rememberInviteCode } from '../src/lib/invites.ts';
import { loadBusinessInviteLanding, loadMeetupInviteCard, parseBusinessInviteLanding, parseMeetupInviteCard, seatsLeft } from '../src/lib/meetup-invite.ts';
import { meetupLanguageNote } from '../src/lib/meetup-language.ts';
import { NEIGHBORHOODS } from '../src/lib/neighborhoods.ts';
import { publicWebFetch } from '../src/lib/public-web.ts';
import { sharedLinkTarget, sharedPostMessage, sharedPostReturnPath, withInviteCode } from '../src/lib/sharing.ts';

const id = '123e4567-e89b-42d3-a456-426614174000';
const merchant = '223e4567-e89b-42d3-a456-426614174000';
const site = 'https://gling.ej-entertainment.com';
const client = result => ({ calls: [], rpc(name, args) { this.calls.push([name, args]); return Promise.resolve(result); } });

test('the server neighborhood list matches the app list for every city it covers', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261113120000_meetup_invite_card.sql', import.meta.url), 'utf8');
  const rows = [...sql.matchAll(/\('([a-z]+)','([a-z-]+)',(-?[\d.]+),(-?[\d.]+)\)/g)].map(([, city, area, lat, lng]) => `${city}:${area}:${lat}:${lng}`);
  const cities = [...new Set(rows.map(row => row.split(':')[0]))];
  assert.deepEqual(cities, ['vancouver', 'toronto', 'montreal']);
  assert.deepEqual(rows, cities.flatMap(city => NEIGHBORHOODS[city].map(item => `${city}:${item.id}:${item.latitude}:${item.longitude}`)));
});

test('the invitation card keeps only its narrow, well-formed fields', async () => {
  const raw = { id, memberCount: 4, capacity: 8, fee: 10, intro: ' 룰은 가서 알려 드려요.\n처음이어도 괜찮아요. ', area: 'metrotown', inviter: '지은', body: 'PRIVATE', place: 'PRIVATE' };
  assert.deepEqual(parseMeetupInviteCard(raw, id), { id, memberCount: 4, capacity: 8, fee: 10, intro: '룰은 가서 알려 드려요.\n처음이어도 괜찮아요.', area: 'metrotown', inviter: '지은' });
  assert.equal(parseMeetupInviteCard({ ...raw, id: merchant }, id), null, 'a card for another post is ignored');
  assert.deepEqual(parseMeetupInviteCard({ id, memberCount: -1, capacity: '8', fee: 0, intro: 5, area: '<b>', inviter: ' ' }, id),
    { id, memberCount: null, capacity: null, fee: null, intro: '', area: null, inviter: null });
  assert.equal(seatsLeft({ capacity: 8, memberCount: 4 }), 4);
  assert.equal(seatsLeft({ capacity: 4, memberCount: 6 }), 0);
  assert.equal(seatsLeft({ capacity: null, memberCount: 2 }), null);

  const rpc = client({ data: raw, error: null });
  assert.equal((await loadMeetupInviteCard(rpc, id, 'hjkm-2345')).inviter, '지은');
  await loadMeetupInviteCard(rpc, id, 'bad');
  assert.deepEqual(rpc.calls, [['get_meetup_invite_card', { p_post_id: id, p_code: 'HJKM2345' }], ['get_meetup_invite_card', { p_post_id: id }]], 'a malformed code is never sent');
  await assert.rejects(loadMeetupInviteCard(client({ data: null, error: { message: 'Failed to fetch' } }), id));
});

test('a guest sees the exchange pair, and on an English page that a Korean-written meetup is in Korean', () => {
  const exchange = { languageExchange: { languages: ['ko', 'en'], share: 50 } };
  assert.equal(meetupLanguageNote(exchange, '언어교환 밤', 'ko'), '한국어 ↔ English');
  assert.equal(meetupLanguageNote(exchange, '언어교환 밤', 'en'), 'Korean ↔ English', 'English pages name both languages in English');
  assert.equal(meetupLanguageNote({}, '보드게임 밤', 'en'), 'In Korean');
  assert.equal(meetupLanguageNote({}, 'Board game night', 'en'), null);
  assert.equal(meetupLanguageNote({}, '보드게임 밤', 'ko'), null, 'a Korean reader needs no language line');
  assert.equal(meetupLanguageNote({ languageExchange: { languages: ['ko', 'ko'], share: 50 } }, '보드게임', 'en'), 'In Korean', 'a malformed pair is ignored');
});

test('a shop landing needs a valid code and lists at most five meetup ids', async () => {
  const raw = { merchantId: merchant, name: 'Jimoco', cityId: 'vancouver', meetups: [id, 'x', 5, id, id, id, id, id], owner: 'PRIVATE' };
  assert.deepEqual(parseBusinessInviteLanding(raw), { merchantId: merchant, name: 'Jimoco', cityId: 'vancouver', meetups: [id, id, id, id, id] });
  assert.equal(parseBusinessInviteLanding({ ...raw, name: '' }), null);
  assert.equal(parseBusinessInviteLanding(null), null);
  const rpc = client({ data: raw, error: null });
  assert.equal(await loadBusinessInviteLanding(rpc, 'bad'), null);
  assert.equal((await loadBusinessInviteLanding(rpc, 'shpq2345')).name, 'Jimoco');
  assert.deepEqual(rpc.calls, [['get_business_invite_landing', { p_code: 'SHPQ2345' }]]);
});

test('a meetup share link carries the sharer code to the invitation, the app and back from login', () => {
  const gateway = withInviteCode(`https://gling-share-preview.vercel.app/s/Ej5FZ-ibQtOkVkJmFBdAAA`, 'hjkm-2345');
  assert.equal(gateway, 'https://gling-share-preview.vercel.app/s/Ej5FZ-ibQtOkVkJmFBdAAA?c=HJKM2345');
  assert.equal(withInviteCode(`${site}/post?id=${id}`, 'HJKM2345'), `${site}/post?id=${id}&code=HJKM2345`);
  assert.equal(withInviteCode(`${site}/post?id=${id}`, 'bad'), `${site}/post?id=${id}`);
  assert.deepEqual(sharedLinkTarget(gateway), { id, invite: false, code: 'HJKM2345' });
  assert.deepEqual(sharedLinkTarget(`${site}/post?id=${id}&invite=1&code=HJKM2345`), { id, invite: true, code: 'HJKM2345' });
  assert.deepEqual(sharedLinkTarget(`${site}/post?id=${id}&invite=1&code=HJKM2345&code=ABCD2345`), { id, invite: true }, 'an ambiguous code is dropped');
  assert.match(sharedPostMessage({ id, title: '보드게임', room: {} }, 'HJKM2345'), /\?c=HJKM2345$/);
  assert.doesNotMatch(sharedPostMessage({ id, title: '이야기' }, 'HJKM2345'), /c=/, 'only meetups carry the code');

  assert.equal(appPathForLink(`${site}/post?id=${id}&shared=1&invite=1&code=HJKM2345`), `/post/${id}?invite=1&code=HJKM2345`);
  assert.equal(appPathForLink(`${site}/post?id=${id}&code=bad`), `/post/${id}`);
  assert.equal(appPathForLink(`${site}/meetup-join?postId=${id}&code=hjkm2345`), `/meetup-join?postId=${id}&code=HJKM2345`);
  assert.equal(appPathForLink(`${site}/meetup-join?postId=${id}&code=bad`), `/meetup-join?postId=${id}`);

  assert.equal(sharedPostReturnPath(`/meetup-join?postId=${id}&code=HJKM2345&next=https://evil.test`), `/meetup-join?postId=${id}&code=HJKM2345`);
  assert.equal(sharedPostReturnPath(`/post?id=${id}&invite=1&code=HJKM2345`), `/post?id=${id}&invite=1&code=HJKM2345`);
  assert.equal(sharedPostReturnPath(`/post?id=${id}&code=<script>`), `/post?id=${id}`);
});

test('the code on a shared meetup link is the one the first sign-in claims', async () => {
  // Share sheet → preview link → worker destination → invitation page → stored code → AuthProvider's claim on sign-in.
  const shared = withInviteCode('https://gling-share-preview.vercel.app/s/Ej5FZ-ibQtOkVkJmFBdAAA', 'HJKM2345');
  const landing = `${site}/post?id=${id}&shared=1&invite=1&code=${sharedLinkTarget(shared).code}`;
  const map = new Map(), storage = { getItem: async k => map.get(k) ?? null, setItem: async (k, v) => map.set(k, v), removeItem: async k => map.delete(k) };
  await rememberInviteCode(storage, sharedLinkTarget(landing).code);
  const rpc = client({ data: { linked: true }, error: null });
  assert.equal(await claimRememberedInvite(rpc, storage), 'linked');
  assert.deepEqual(rpc.calls, [['claim_invite_code', { p_code: 'HJKM2345' }]]);
  assert.equal(map.has(INVITE_CODE_KEY), false);
});

test('the logged-out reader may call the two invitation reads, with the public key and nothing else', async () => {
  const calls = [];
  const request = publicWebFetch('https://example.supabase.co', 'public-key', async (url, init) => { calls.push({ url, init }); return new Response('{}'); });
  for (const rpc of ['get_meetup_invite_card', 'get_business_invite_landing']) {
    await request(`https://example.supabase.co/rest/v1/rpc/${rpc}`, { method: 'POST', headers: { Authorization: 'Bearer private-user' }, body: '{}' });
    await assert.rejects(request(`https://example.supabase.co/rest/v1/rpc/${rpc}`, { method: 'GET' }), /PUBLIC_WEB_READ_ONLY/);
  }
  for (const rpc of ['claim_invite_code', 'create_invite_link', 'get_my_invite']) await assert.rejects(request(`https://example.supabase.co/rest/v1/rpc/${rpc}`, { method: 'POST', body: '{}' }), /PUBLIC_WEB_READ_ONLY/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ init }) => new Headers(init.headers).get('Authorization') === 'Bearer public-key' && init.credentials === 'omit'));
});
