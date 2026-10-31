import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MEETUP_CREATE_DRAFT_KEY, clearMeetupCreateDraft, meetupDraftParams, meetupDraftScope,
  readMeetupCreateDraft, saveMeetupCreateDraft, takeMeetupLoginResume,
} from '../src/lib/meetup-create-draft.ts';

const now = 1_792_788_000_000, minute = 60_000;
function storage() {
  const values = new Map();
  return { values,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
}
const draft = (overrides = {}) => ({
  params: {}, awaitingLogin: true, kindChosen: true, kind: 'once',
  startsAt: '2026-11-01T18:00:00.000Z', endsAt: '2026-11-01T19:00:00.000Z', cadence: '', category: 'casual',
  title: '퇴근하고 노을 보러 갈래요?', body: '잉글리시베이에서 만나요.', question: '어떤 분위기를 좋아하세요?', topic: '',
  capacity: '8', ageMin: '', ageMax: '', newcomer: { welcome: true, only: false }, pickedPlaceId: null,
  cover: { uri: 'file:///cover.webp', base64: 'AAAA', mimeType: 'image/webp', thumbBase64: 'BB', width: 10, height: 10 }, coverDropped: false,
  ...overrides,
});

test('draft typed before login survives a cold restart and restores only on the same create link', async t => {
  t.mock.method(Date, 'now', () => now);
  const store = storage();
  await saveMeetupCreateDraft(store, draft());
  // A new module instance stands in for the app being killed during the OAuth browser hop.
  const cold = await import('../src/lib/meetup-create-draft.ts?cold=1');
  const restored = await cold.readMeetupCreateDraft(store, meetupDraftScope({}));
  assert.deepEqual(restored, draft());
  assert.equal(await readMeetupCreateDraft(store, meetupDraftScope({ placeCityId: 'vancouver', placeId: 'osm:node:1' })), null);
  assert.ok(store.values.has(MEETUP_CREATE_DRAFT_KEY), 'a different link does not delete the draft');
});

test('login that started on the create screen resumes there once; the draft stays until published or left', async t => {
  t.mock.method(Date, 'now', () => now);
  const store = storage();
  const params = { kind: 'group', placeCityId: 'vancouver', placeId: 'osm:node:42' };
  await saveMeetupCreateDraft(store, draft({ params }));
  assert.deepEqual(await takeMeetupLoginResume(store), params);
  assert.equal(await takeMeetupLoginResume(store), null, 'a later login does not bounce back again');
  assert.equal((await readMeetupCreateDraft(store, meetupDraftScope(params)))?.title, draft().title);
  await clearMeetupCreateDraft(store);
  assert.equal(await readMeetupCreateDraft(store, meetupDraftScope(params)), null);
});

test('resume is limited to a recent login and drafts expire after a day', async t => {
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  const store = storage();
  await saveMeetupCreateDraft(store, draft());
  clock = now + 31 * minute;
  assert.equal(await takeMeetupLoginResume(store), null);
  assert.ok(await readMeetupCreateDraft(store, meetupDraftScope({})), 'the draft is still restorable');
  clock = now + 24 * 60 * minute;
  assert.equal(await readMeetupCreateDraft(store, meetupDraftScope({})), null);
  assert.equal(store.values.size, 0, 'expired drafts are removed');
});

test('a not-yet-asked draft never redirects, broken records are dropped, oversized covers are not stored', async t => {
  t.mock.method(Date, 'now', () => now);
  const store = storage();
  await saveMeetupCreateDraft(store, draft({ awaitingLogin: false }));
  assert.equal(await takeMeetupLoginResume(store), null);
  store.values.set(MEETUP_CREATE_DRAFT_KEY, JSON.stringify({ ...JSON.parse(store.values.get(MEETUP_CREATE_DRAFT_KEY)), kind: 'party' }));
  assert.equal(await readMeetupCreateDraft(store, meetupDraftScope({})), null);
  assert.equal(store.values.size, 0);
  store.values.set(MEETUP_CREATE_DRAFT_KEY, '{nope');
  assert.equal(await takeMeetupLoginResume(store), null);
  assert.equal(store.values.size, 0);
  await saveMeetupCreateDraft(store, draft({ cover: { uri: 'file:///big.webp', base64: 'A'.repeat(1_300_000), mimeType: 'image/webp' } }));
  const stored = await readMeetupCreateDraft(store, meetupDraftScope({}));
  assert.equal(stored.cover, null);
  assert.equal(stored.coverDropped, true);
});

test('route params keep only known safe keys', () => {
  assert.deepEqual(meetupDraftParams({ kind: 'once', placeId: 'osm:node:1', extra: 'x', ticketmasterEventId: '../../evil?x=1', placeCityId: ['a'] }),
    { kind: 'once', placeId: 'osm:node:1' });
});

test('create screen wires the draft through login, callback and publish, and every new id is registered', () => {
  const screen = readFileSync(new URL('../src/app/meetup-create.tsx', import.meta.url), 'utf8');
  const callback = readFileSync(new URL('../src/app/auth/callback.tsx', import.meta.url), 'utf8');
  assert.equal((screen.match(/promptLogin\(/g) ?? []).length, 1, 'every login prompt goes through askLogin, which saves first');
  assert.ok(screen.indexOf("if (!question.trim())") < screen.indexOf("return askLogin('모임을 열려면"), 'content is validated before asking to log in');
  assert.match(screen, /clearMeetupCreateDraft\(AsyncStorage\)[^\n]*\n\s*const newcomerSaved/, 'published drafts are cleared');
  assert.match(callback, /takeMeetupLoginResume[\s\S]*router\.dismissTo\(\{ pathname: '\/meetup-create'/);
  assert.doesNotMatch(screen, /analyticsId="(app_meetup-create\.pressable|components_)/);
  const sql = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(name => name.endsWith('.sql'))
    .map(name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')).join('\n');
  const ids = [...screen.matchAll(/(?:trackField\(|field\(|behavior\('press', )'(meetup\.create\.[^']+)'/g)].map(match => match[1]);
  assert.ok(ids.length >= 8, ids.join());
  for (const id of ids) assert.ok(sql.includes(`('${id}')`), id);
});
