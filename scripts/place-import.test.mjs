import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyImportInput, extractPlaceNames, googlePlaceFromUrl, matchPlaces, parseTakeoutFile, readGoogleList, readInstagramCaption, splitTextNames,
} from '../src/lib/place-import.ts';

// Made-up list ids, owners and places shaped like the getlist response in the 2026-11-04 feasibility report.
const OWNER = ['Owner Fakename', 'https://fake.invalid/owner.png', 'owner-id-0001'];
const ADDER = ['Adder Fakename', 'https://fake.invalid/adder.png', 'adder-id-0002'];
const row = (name, pin, address = '123 Fake St, Vancouver, BC') =>
  [null, [null, null, 'label', null, address, pin && [null, null, ...pin], ['0x1', '0x2'], '/g/fake'], name, 'member note', null, null, null, [], [[1], ['x', 'y']], [1, 2], [1, 2], null, ADDER];
const listBody = (rows, title = 'Fake Vancouver eats') =>
  `)]}'\n${JSON.stringify([[['FakeList_0001', 1, null, 1, 1], 1, [1, 1, 'x'], OWNER, title, 'desc', null, null, rows, [], [1, 1], [1, 1], rows.length], ''])}`;
const reply = ({ status = 200, url = '', location, body = '' }) =>
  ({ ok: status >= 200 && status < 300, status, url, headers: new Headers(location ? { location } : {}), text: async () => body });
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const [part, respond] of routes) if (String(url).includes(part)) return respond();
    throw new TypeError('Network request failed');
  };
  return { impl, calls };
}
const LIST_REDIRECT = 'https://www.google.com/maps/@/data=!3m1!4b1!4m2!11m1!2sFakeList_0001';
const getlist = body => ['/maps/preview/entitylist/getlist', () => reply({ body })];
const rejects = (promise, code) => assert.rejects(promise, error => error instanceof Error && error.message === code);

test('classify finds the first link in shared text and names its kind', () => {
  const list = { kind: 'google-list', url: 'https://maps.app.goo.gl/FakeShort01' };
  assert.deepEqual(classifyImportInput('여기 가보자 https://maps.app.goo.gl/FakeShort01 다음주에'), list);
  assert.deepEqual(classifyImportInput('(https://maps.app.goo.gl/FakeShort01).'), list);
  assert.deepEqual(classifyImportInput('https://maps.app.goo.gl/FakeShort01가보자'), list);
  assert.deepEqual(classifyImportInput('http://maps.app.goo.gl/FakeShort01'), list);
  for (const url of ['https://goo.gl/maps/FakeOld02', 'https://www.google.com/maps/placelists/list/FakeList_0001',
    'https://www.google.ca/maps/placelists/list/-FakeList_0002?g_ep=x', LIST_REDIRECT, 'https://www.google.co.kr/maps/@/data=!4m3!11m2!2sFakeList_0003!3e3'])
    assert.equal(classifyImportInput(url).kind, 'google-list', url);
  assert.deepEqual(classifyImportInput('https://www.google.com/maps/place/Fake+Cafe/@49.28,-123.12,17z'),
    { kind: 'google-place', url: 'https://www.google.com/maps/place/Fake+Cafe/@49.28,-123.12,17z' });
  for (const url of ['https://www.instagram.com/reel/FakeReel1/', 'https://instagram.com/reels/FakeReel2', 'https://www.instagram.com/p/FakePost3/?igsh=x', 'https://www.instagram.com/tv/FakeTv4'])
    assert.deepEqual(classifyImportInput(url), { kind: 'social', url: new URL(url).href, network: 'instagram' });
  for (const url of ['https://www.tiktok.com/@fake.user/video/7000000000000000001', 'https://vm.tiktok.com/FakeVm1/', 'https://vt.tiktok.com/FakeVt2/'])
    assert.deepEqual(classifyImportInput(url), { kind: 'social', url, network: 'tiktok' });
});

test('classify leaves unknown, lookalike and later links as text', () => {
  for (const raw of ['Earnest Ice Cream, Breka', 'https://www.instagram.com/fake.user/', 'https://www.tiktok.com/@fake.user',
    'https://maps.app.goo.gl/', 'https://maps.app.goo.gl.evil.example/FakeShort01', 'https://user:pw@maps.app.goo.gl/FakeShort01',
    'https://www.google.com/search?q=cafe', 'https://www.google.com/maps/@49.28,-123.12,15z', 'https://example.com and https://maps.app.goo.gl/FakeShort01', ''])
    assert.deepEqual(classifyImportInput(raw), { kind: 'text', text: raw }, raw);
});

test('a place link gives its name and prefers the !3d!4d pin over the map centre', () => {
  assert.deepEqual(googlePlaceFromUrl('https://www.google.com/maps/place/Earnest+Ice+Cream/@49.2627,-123.07,17z'),
    { name: 'Earnest Ice Cream', latitude: 49.2627, longitude: -123.07 });
  assert.deepEqual(googlePlaceFromUrl('https://www.google.ca/maps/place/Fake+Cafe/@49.2,-123.2,15z/data=!3m1!4b1!4m6!3m5!1s0x1:0x2!8m2!3d49.2811!4d-123.1199!16s'),
    { name: 'Fake Cafe', latitude: 49.2811, longitude: -123.1199 });
  assert.deepEqual(googlePlaceFromUrl('https://www.google.com/maps/place/%EA%B5%90%EC%B4%8C%EC%B9%98%ED%82%A8'), { name: '교촌치킨' });
  for (const url of ['https://example.com/maps/place/Fake/@1,2', 'https://www.google.com/maps/place/%E0%A4%A', 'https://www.google.com/maps/search/cafe', 'not a url'])
    assert.equal(googlePlaceFromUrl(url), null, url);
});

test('a short list link resolves with the bare UA and returns only name, pin and address', async () => {
  const { impl, calls } = fakeFetch([
    ['maps.app.goo.gl', () => reply({ url: LIST_REDIRECT })],
    getlist(listBody([row('Fake Noodle Bar', [49.2801, -123.1201]), row('Fake Bakery', null, ''), row('Fake Pin Zero', [0, 0])])),
  ]);
  const result = await readGoogleList('공유: https://maps.app.goo.gl/FakeShort01', impl);
  assert.deepEqual(result, { title: 'Fake Vancouver eats', places: [
    { name: 'Fake Noodle Bar', latitude: 49.2801, longitude: -123.1201, address: '123 Fake St, Vancouver, BC' },
    { name: 'Fake Bakery' },
    { name: 'Fake Pin Zero', address: '123 Fake St, Vancouver, BC' },
  ] });
  assert.deepEqual(calls[0].init, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  assert.match(calls[1].url, /^https:\/\/www\.google\.com\/maps\/preview\/entitylist\/getlist\?authuser=0&hl=en&gl=ca&pb=!1m1!1sFakeList_0001!2e2!3e2!4i500!6m3!1s[\w-]{22}!15i204459!28e2!16b1$/);
  const leaked = JSON.stringify(result);
  for (const secret of [...OWNER, ...ADDER, 'member note']) assert.ok(!leaked.includes(secret), secret);
});

test('the list id is also read from Location, and a long list link skips the redirect', async () => {
  const redirect = fakeFetch([
    ['maps.app.goo.gl', () => reply({ status: 302, url: 'https://maps.app.goo.gl/FakeShort01', location: LIST_REDIRECT })],
    getlist(listBody([row('Fake Noodle Bar', [49.28, -123.12])])),
  ]);
  assert.equal((await readGoogleList('https://maps.app.goo.gl/FakeShort01', redirect.impl)).places.length, 1);
  const direct = fakeFetch([getlist(listBody([row('Fake Noodle Bar', [49.28, -123.12])]))]);
  await readGoogleList('https://www.google.com/maps/placelists/list/FakeList_0002', direct.impl);
  assert.equal(direct.calls.length, 1);
  assert.match(direct.calls[0].url, /!1m1!1sFakeList_0002!2e2/);
});

test('a short link to one place returns just that place without reading a list', async () => {
  const { impl, calls } = fakeFetch([['maps.app.goo.gl', () => reply({ url: 'https://www.google.com/maps/place/Fake+Cafe/@49.28,-123.12,17z/data=!3d49.2811!4d-123.1199' })]]);
  assert.deepEqual(await readGoogleList('https://maps.app.goo.gl/FakePlace9', impl), { title: '', places: [{ name: 'Fake Cafe', latitude: 49.2811, longitude: -123.1199 }] });
  assert.equal(calls.length, 1);
  const none = fakeFetch([]);
  assert.deepEqual(await readGoogleList('https://www.google.com/maps/place/Fake+Cafe', none.impl), { title: '', places: [{ name: 'Fake Cafe' }] });
  assert.equal(none.calls.length, 0);
});

test('private, empty and unreadable lists throw the code the screen routes on', async () => {
  const list = 'https://www.google.com/maps/placelists/list/FakeList_0001';
  await rejects(readGoogleList(list, fakeFetch([['getlist', () => reply({ status: 403 })]]).impl), 'GOOGLE_LIST_PRIVATE');
  await rejects(readGoogleList(list, fakeFetch([getlist(`)]}'\n[null,""]`)]).impl), 'GOOGLE_LIST_PRIVATE');
  await rejects(readGoogleList(list, fakeFetch([getlist(listBody([]))]).impl), 'GOOGLE_LIST_EMPTY');
  await rejects(readGoogleList(list, fakeFetch([getlist(listBody([row('  ', [49.28, -123.12]), [null, null, null]]))]).impl), 'GOOGLE_LIST_EMPTY');
  await rejects(readGoogleList(list, fakeFetch([getlist('<html>unusual traffic</html>')]).impl), 'GOOGLE_LIST_UNREADABLE');
  await rejects(readGoogleList(list, fakeFetch([['getlist', () => reply({ status: 429 })]]).impl), 'GOOGLE_LIST_UNREADABLE');
  await rejects(readGoogleList(list, fakeFetch([]).impl), 'GOOGLE_LIST_UNREADABLE');
  await rejects(readGoogleList('https://maps.app.goo.gl/FakeShort01', fakeFetch([['maps.app.goo.gl', () => reply({ url: 'https://www.google.com/' })]]).impl), 'GOOGLE_LIST_UNREADABLE');
  const offsite = fakeFetch([]);
  await rejects(readGoogleList('https://example.com/maps/placelists/list/FakeList_0001', offsite.impl), 'GOOGLE_LIST_UNREADABLE');
  assert.equal(offsite.calls.length, 0);
});

test('a Takeout saved-list CSV survives quotes, commas, line breaks, CRLF and a BOM', () => {
  const csv = '﻿Title,Note,URL,Tags,Comment\r\n,,,,\r\n'
    + '"Meat & Bread, ""Gastown""",,"https://www.google.com/maps/place/Meat+%26+Bread/@49.2833,-123.1042,17z",,\r\n'
    + '"Fake\nTwo Line Cafe","note, with comma",https://www.google.com/maps/place/Fake/data=!4m2!3m1!1s0x1:0x2,,\r\n'
    + 'Fake Pub,,,,';
  assert.deepEqual(parseTakeoutFile('Want to go.csv', csv), [
    { name: 'Meat & Bread, "Gastown"', latitude: 49.2833, longitude: -123.1042 },
    { name: 'Fake Two Line Cafe' },
    { name: 'Fake Pub' },
  ]);
  assert.deepEqual(parseTakeoutFile('Favourites.csv', '\nTitle,Note,URL\nFake Deli,,\n'), [{ name: 'Fake Deli' }]);
});

test('a Saved Places GeoJSON reads location.name, Title or name and drops [0,0]', () => {
  const json = JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-123.12, 49.28] }, properties: { location: { name: 'Fake Ramen', address: '1 Fake Ave' } } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { Title: 'Fake Old Format' } },
    { type: 'Feature', properties: { name: 'Fake No Geometry' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-123.1, 49.2] }, properties: { location: { address: 'nameless' } } },
  ] });
  assert.deepEqual(parseTakeoutFile('Saved Places.json', json), [
    { name: 'Fake Ramen', latitude: 49.28, longitude: -123.12, address: '1 Fake Ave' },
    { name: 'Fake Old Format' },
    { name: 'Fake No Geometry' },
  ]);
});

test('unknown Takeout files give an empty list', () => {
  assert.deepEqual(parseTakeoutFile('Saved Places.json', '{not json'), []);
  assert.deepEqual(parseTakeoutFile('Saved Places.json', '{"type":"FeatureCollection"}'), []);
  assert.deepEqual(parseTakeoutFile('notes.txt', 'Fake Cafe\nFake Pub'), []);
  assert.deepEqual(parseTakeoutFile('Reviews.csv', 'Rating,Text\n5,good'), []);
  assert.deepEqual(parseTakeoutFile('empty.csv', ''), []);
});

test('splitTextNames splits on lines, commas, dots, slashes, bullets and numbers', () => {
  assert.deepEqual(splitTextNames('vancouver: Earnest Ice Cream, Breka Bakery · Matchstick / 49th Parallel'),
    ['Earnest Ice Cream', 'Breka Bakery', 'Matchstick', '49th Parallel']);
  assert.deepEqual(splitTextNames('밴쿠버 맛집:\n1. Fake Ramen\n2) Fake Deli\n- Fake Pub\n• Fake Cafe\n(5) 교촌치킨\n6. Fake Bar 7. Fake Grill'),
    ['Fake Ramen', 'Fake Deli', 'Fake Pub', 'Fake Cafe', '교촌치킨', 'Fake Bar', 'Fake Grill']);
});

test('splitTextNames drops emoji, links, blanks and duplicates and stops at 200', () => {
  assert.deepEqual(splitTextNames('🍦 Earnest Ice Cream 🍦\n\n earnest ice-cream ,, 🇨🇦\nhttps://maps.app.goo.gl/FakeShort01\nCafé Medina, cafe medina'),
    ['Earnest Ice Cream', 'Café Medina']);
  assert.equal(splitTextNames(Array.from({ length: 250 }, (_, i) => `Fake Place ${i}`).join('\n')).length, 200);
  assert.deepEqual(splitTextNames(''), []);
});

test('extractPlaceNames keeps only model names found in the pasted text', async () => {
  const text = 'Went to Earnest Ice Cream and then  BREKA bakery. Fake\nRamen was closed.';
  let sent;
  const names = await extractPlaceNames(text, async body => { sent = body; return { names: ['earnest ice cream', 'Breka Bakery', 'Invented Place', 'Earnest Ice Cream', 42, 'Fake Ramen'] }; });
  assert.deepEqual(sent, { text });
  assert.deepEqual(names, ['earnest ice cream', 'Breka Bakery', 'Fake Ramen']);
});

test('extractPlaceNames falls back to splitting when the model fails or finds nothing real', async () => {
  const text = 'Fake Ramen, Fake Deli';
  for (const invoke of [async () => { throw new Error('offline'); }, () => { throw new Error('sync'); }, async () => null,
    async () => ({ names: [] }), async () => ({ names: 'Fake Ramen' }), async () => ({ names: ['Invented Place'] })])
    assert.deepEqual(await extractPlaceNames(text, invoke), ['Fake Ramen', 'Fake Deli']);
});

const place = (id, name, latitude = 49.27, longitude = -123.1) => ({ id, cityId: 'vancouver', name, category: 'food', latitude, longitude, address: '', sourceUrl: '' });
const CATALOG = [
  place('quebec', 'Earnest Ice Cream Quebec St', 49.2683, -123.1036),
  place('fraser', 'Earnest Ice Cream Fraser', 49.2477, -123.0897),
  place('medina', 'Café Medina', 49.2805, -123.1167),
  place('meat', 'Meat & Bread', 49.2833, -123.1042),
  place('kyochon', '교촌치킨', 49.2600, -123.1150),
  place('tacofino', 'Tacofino', 49.2820, -123.1080),
  place('baobei', 'Bao Bei', 49.2795, -123.1010),
];

test('without a pin, names match by normalised equality or containment', () => {
  const results = matchPlaces([{ name: 'Earnest Ice Cream Fraser' }, { name: 'cafe medina' }, { name: 'Meat and Bread' }, { name: '교촌 치킨' }, { name: 'Bao' }, { name: 'Tacofinno' }, { name: 'Nowhere Diner' }], CATALOG);
  assert.deepEqual(results.map(r => [r.input.name, r.status, r.place?.id]), [
    ['Earnest Ice Cream Fraser', 'found', 'fraser'], ['cafe medina', 'found', 'medina'], ['Meat and Bread', 'found', 'meat'],
    ['교촌 치킨', 'found', 'kyochon'], ['Bao', 'missing', undefined], ['Tacofinno', 'missing', undefined], ['Nowhere Diner', 'missing', undefined],
  ]);
});

test('a name shared by several branches becomes a branch choice of at most five places', () => {
  const [earnest] = matchPlaces([{ name: 'Earnest Ice Cream' }], CATALOG);
  assert.deepEqual(earnest, { status: 'branch', input: { name: 'Earnest Ice Cream' }, options: [CATALOG[1], CATALOG[0]] });
  const chain = Array.from({ length: 7 }, (_, i) => place(`fake-${i}`, `Fake Coffee Branch ${i}`));
  const [many] = matchPlaces([{ name: 'Fake Coffee' }], chain);
  assert.equal(many.status, 'branch');
  assert.equal(many.options.length, 5);
});

test('with a pin, the nearest similar name within 300 m wins and 310 m misses', () => {
  const base = place('base', 'Fake Noodle House', 49.28, -123.12);
  assert.equal(matchPlaces([{ name: 'Fake Noodle House', latitude: 49.28 + 0.0026084, longitude: -123.12 }], [base])[0].status, 'found');
  assert.equal(matchPlaces([{ name: 'Fake Noodle House', latitude: 49.28 + 0.0027883, longitude: -123.12 }], [base])[0].status, 'missing');
  const [fraser] = matchPlaces([{ name: 'Earnest Ice Cream', latitude: 49.2478, longitude: -123.0898 }], CATALOG);
  assert.equal(fraser.place.id, 'fraser');
  const [typo] = matchPlaces([{ name: 'Tacofinno', latitude: 49.2821, longitude: -123.1081 }], CATALOG);
  assert.equal(typo.place.id, 'tacofino');
  const [other] = matchPlaces([{ name: 'Totally Different', latitude: 49.2821, longitude: -123.1081 }], CATALOG);
  assert.equal(other.status, 'missing');
});

test('duplicate inputs and repeat finds of one place are kept once', () => {
  const results = matchPlaces([
    { name: 'Café Medina' }, { name: 'cafe medina' }, { name: 'Cafe Medina', latitude: 49.2806, longitude: -123.1168 },
    { name: 'Nowhere Diner' }, { name: 'nowhere diner' },
  ], CATALOG);
  assert.deepEqual(results.map(r => [r.input.name, r.status]), [['Café Medina', 'found'], ['Nowhere Diner', 'missing']]);
  const twoBranches = matchPlaces([
    { name: 'Earnest Ice Cream', latitude: 49.2683, longitude: -123.1036 }, { name: 'Earnest Ice Cream', latitude: 49.2477, longitude: -123.0897 },
  ], CATALOG);
  assert.deepEqual(twoBranches.map(r => r.place.id), ['quebec', 'fraser']);
});

test('instagram caption is read from the link-preview meta tags as the preview crawler', async () => {
  const html = '<html><head><meta property="og:title" content="Fake Noodle Bar on Instagram: &quot;New &amp; hot: try us at Fake Noodle Bar Main St&quot;">'
    + '<meta property="og:description" content="12 likes, 0 comments - fakenoodle on May 1, 2026: &quot;New &amp; hot: try us at Fake Noodle Bar Main St&quot;"></head></html>';
  let seen;
  const out = await readInstagramCaption('https://www.instagram.com/reel/Fake_001/?igsh=abc', async (url, init) => { seen = { url, agent: init.headers['User-Agent'] }; return new Response(html, { status: 200 }); });
  assert.deepEqual(out, { account: 'Fake Noodle Bar', caption: 'New & hot: try us at Fake Noodle Bar Main St' });
  assert.equal(seen.url, 'https://www.instagram.com/reel/Fake_001/');
  assert.match(seen.agent, /^facebookexternalhit\//);
  assert.equal(await readInstagramCaption('https://www.instagram.com/reel/Fake_001/', async () => new Response('<html></html>', { status: 200 })), null);
  assert.equal(await readInstagramCaption('https://www.instagram.com/reel/Fake_001/', async () => new Response('', { status: 429 })), null);
  assert.equal(await readInstagramCaption('https://www.instagram.com/reel/Fake_001/', async () => { throw new Error('offline'); }), null);
  assert.equal(await readInstagramCaption('https://evil.invalid/reel/Fake_001/', async () => new Response(html)), null);
});

test('caption names skip the line-splitting fallback so a chatty caption never becomes place names', async () => {
  assert.deepEqual(await extractPlaceNames('so good!!\nsee you soon', async () => ({ names: [] }), { split: false }), []);
  assert.deepEqual(await extractPlaceNames('Fake Noodle Bar\nsee you soon', async () => ({ names: ['Fake Noodle Bar'] }), { split: false }), ['Fake Noodle Bar']);
});
