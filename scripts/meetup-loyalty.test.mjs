import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as loyalty from '../src/lib/meetup-loyalty.ts';
import { withLanguageImports } from './test-language-imports.mjs';
import { englishNotificationBody } from '../src/lib/notification-preferences.ts';
import { badgeLabels, loyaltyError, pinnedNotices, tierAtLeast } from '../src/lib/meetup-loyalty.ts';
import { uiEnglish } from '../src/i18n/ui-en.ts';

const en = body => englishNotificationBody({ kind: 'meetup_changed', body }, text => text);

test('host loyalty server bodies render English, encore before follower', () => {
  assert.equal(en('민수님이 새 모임을 열었어요. 토요일 아침 러닝'), '민수 just opened a new meetup: 토요일 아침 러닝');
  assert.equal(en('또 열어 달라고 했던 민수님이 새 모임을 열었어요. 토요일 아침 러닝'), 'You asked 민수 to host again, and they just did: 토요일 아침 러닝');
  assert.equal(en('「러닝」 공지: 내일은\n7시에 만나요'), 'Note from the host of “러닝”: 내일은\n7시에 만나요');
  assert.equal(en('「러닝」 다음 모임 날짜가 잡혔어요. 11/07 19:30 (모임 현지 시간)'), 'The next “러닝” is set for Nov 7 at 7:30 p.m. (local time).');
  assert.match(en('「러닝」 체크인을 맡게 됐어요. 모임 시간에 참석 확인 화면에서 체크인할 수 있어요.'), /^You’re on check-in for “러닝”/);
  assert.equal(en('Board games 모임의 시간이나 장소가 바뀌었어요. 바뀐 내용을 확인해 주세요.'), 'The time or place for “Board games” changed. Check the updated details.');
});

test('badges show the highest level of each kind, hosting first, all translated', () => {
  assert.deepEqual(badgeLabels(undefined), []);
  assert.deepEqual(badgeLabels({ attended: 0, hosted: 0 }), []);
  assert.deepEqual(badgeLabels({ attended: 10, hosted: 1 }), ['첫 모임 호스트', '모임 10번 참석']);
  for (const level of [1, 5, 10, 25]) for (const label of badgeLabels({ attended: level, hosted: level })) assert.ok(uiEnglish[label], label);
});

test('tiers and server error codes', () => {
  assert.equal(tierAtLeast(undefined, 'plus'), false);
  assert.equal(tierAtLeast('plus', 'pro'), false);
  assert.equal(tierAtLeast('premium', 'pro'), true);
  assert.equal(loyaltyError(new Error('ANNOUNCEMENT_DAILY_LIMIT')), '공지는 하루에 3번까지 보낼 수 있어요.');
  assert.equal(loyaltyError(new Error('boom'), '실패'), '실패');
});

test('pinned notices: the server list wins, an older server still shows its one notice', () => {
  const a = { id: 'a', body: '새 공지', sentAt: '2026-10-30T10:00:00Z' }, b = { id: 'b', body: '지난 공지', sentAt: '2026-10-27T10:00:00Z' };
  assert.deepEqual(pinnedNotices(null), []);
  assert.deepEqual(pinnedNotices({ pinned: null }), []);
  assert.deepEqual(pinnedNotices({ pinned: a }), [a]);
  assert.deepEqual(pinnedNotices({ pinned: a, pinnedNotices: [a, b] }), [a, b]);
  assert.deepEqual(pinnedNotices({ pinned: null, pinnedNotices: [] }), []);
  const source = readFileSync(new URL('../src/components/meetup-loyalty.tsx', import.meta.url), 'utf8');
  for (const [, key] of source.slice(source.indexOf('export function MeetupPinnedNotice'), source.indexOf('const AUDIENCES')).matchAll(/tr\('([^']+)'/g)) assert.ok(uiEnglish[key], key);
});

test('today feed: this week\'s most-read list comes right after the date line, before the start guide', () => {
  const source = readFileSync(new URL('../src/components/feed-screen.tsx', import.meta.url), 'utf8');
  const header = source.slice(source.indexOf('styles.journalIntro'));
  const ranking = header.indexOf('{!feedLoading && weeklyRanking}');
  assert.ok(ranking > 0 && header.indexOf('weeklyRanking}', ranking + 40) === -1);
  for (const later of ['<StartGuide', '<NewcomerProgressCard', '<LocalEventsCarousel', '<CityPopularPlaces']) assert.ok(ranking < header.indexOf(later), later);
});

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join('') : '';

/** Renders MeetupPinnedNotice once with the given loaded state and folded/open flag; returns the tree and recorded calls. */
function renderPinned(value, open = false) {
  const calls = { unpin: [], play: [], open: [] };
  const states = [{ key: 'me:post', value }, 0, '', open];
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/components/meetup-loyalty.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: withLanguageImports(name => ({
    react: { useState: () => [states.shift(), next => calls.open.push(next)], useEffect() {}, useCallback: fn => fn, useRef: () => ({}) },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'expo-symbols': { SymbolView: 'SymbolView' },
    'react-native': { View: 'View', TextInput: 'TextInput', StyleSheet: { create: x => x, hairlineWidth: 1 } },
    '@/components/analytics-controls': { Pressable: 'Pressable', Switch: 'Switch' },
    '@/components/chilling-date-input': {}, '@/components/raised-action-button': {}, '@/components/themed-text': { ThemedText: 'Text' },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 16, four: 24 } },
    '@/hooks/use-theme': { useTheme: () => ({ accent: 'a', line: 'l', textSecondary: 's', backgroundElement: 'e' }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: 'me' } }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => calls.play.push(kind) }) },
    '@/lib/meetup-reviews': {}, '@/lib/supabase': { supabase: {} },
    '@/lib/meetup-loyalty': { ...loyalty, updateMeetupAnnouncement: async (_client, id, action) => { calls.unpin.push([id, action]); } },
  })[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })()) });
  return { tree: exports.MeetupPinnedNotice({ postId: 'post' }), calls };
}

test('meetup chat: several pinned notices fold into one line; only the host can take one down', async () => {
  const notices = [{ id: 'n3', body: '토요일엔 7시에 만나요', sentAt: '2026-10-30T10:00:00Z' }, { id: 'n2', body: '회비는 5달러예요', sentAt: '2026-10-27T10:00:00Z' },
    { id: 'n1', body: '운동화만 챙겨 오세요', sentAt: '2026-10-21T10:00:00Z' }];
  const member = { isHost: false, pinned: notices[0], pinnedNotices: notices };

  assert.equal(renderPinned({ ...member, pinned: null, pinnedNotices: [] }).tree, null);
  assert.equal(renderPinned(null).tree, null);

  // Folded: count + newest line, an expandable control with feedback; no notice bodies beyond the newest.
  let { tree, calls } = renderPinned(member);
  let bar = nodes(tree).find(n => n.props?.analyticsId === 'meetup.notice.expand');
  assert.equal(bar.props.accessibilityState.expanded, false);
  assert.match(bar.props.accessibilityLabel, /3/);
  assert.match(text(tree), /공지 3/);
  assert.match(text(tree), /토요일엔 7시에 만나요/);
  assert.doesNotMatch(text(tree), /회비/);
  bar.props.onPress();
  assert.deepEqual(calls.play, ['selection']);
  assert.equal(typeof calls.open[0], 'function');
  assert.equal(nodes(tree).filter(n => n.props?.analyticsId === 'meetup.notice.unpin').length, 0);

  // Open for a member: all three newest first, nothing to take down.
  ({ tree } = renderPinned(member, true));
  assert.equal(nodes(tree).find(n => n.props?.analyticsId === 'meetup.notice.expand').props.accessibilityState.expanded, true);
  const all = text(tree);
  assert.ok(all.indexOf('토요일') < all.indexOf('회비') && all.indexOf('회비') < all.indexOf('운동화'), all);
  assert.equal(nodes(tree).filter(n => n.props?.analyticsId === 'meetup.notice.unpin').length, 0);

  // Open for the host: one take-down per notice, each sending its own id.
  ({ tree, calls } = renderPinned({ ...member, isHost: true }, true));
  const unpins = nodes(tree).filter(n => n.props?.analyticsId === 'meetup.notice.unpin');
  assert.equal(unpins.length, 3);
  assert.ok(unpins.every(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel));
  await unpins[1].props.onPress();
  assert.deepEqual(calls.unpin, [['n2', 'unpin']]);
  assert.deepEqual(calls.play, ['selection']);

  // One notice (or an older server): shown in full like before, no fold.
  ({ tree } = renderPinned({ isHost: false, pinned: notices[0] }));
  assert.equal(nodes(tree).find(n => n.props?.analyticsId === 'meetup.notice.expand'), undefined);
  assert.match(text(tree), /토요일엔 7시에 만나요/);
});
