import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { translateUi, translationsFor } from '../src/i18n/index.ts';
import * as chilling from '../src/lib/chilling.ts';
import * as discovery from '../src/lib/chilling-discovery.ts';
import * as designSystem from '../src/constants/design-system.ts';
import * as hostTools from '../src/lib/meetup-host-tools.ts';

export const participantPost = { id: 'a1620000-0000-0000-0000-000000000001', cityId: 'vancouver', kind: 'story', title: '바닷길 따라 함께 걷기', body: '천천히 걷고 커피 한 잔 해요.', author: { id: 'host', nickname: '소라' }, tag: { id: 5, kind: 'meetup' }, createdAt: '2030-01-01', room: { eventKind: 'once', startsAt: '2031-06-12T17:00:00Z', endsAt: '2031-06-12T19:00:00Z', timezone: 'America/Vancouver', memberCount: 3, capacity: 8, applicationQuestion: '어떤 산책길을 좋아하세요?' } };
export const participantProfile = { version: 2, revision: 'profile-r1', displayName: '하늘', intro: '주말에 걷는 것을 좋아해요.', shareWithMembers: false, interests: ['산책', '커피'], cityId: 'vancouver', promptOne: '', promptTwo: '' };
export const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...['children', 'ListHeaderComponent', 'ListFooterComponent', 'ListEmptyComponent'].flatMap(key => [tree.props?.[key]].flat(Infinity).flatMap(nodes))];
export const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : [node.props?.children].flat(Infinity).map(text).join('');

// Real component functions and discovery policy, with synthetic auth, RPC and native boundaries only.
export function mountParticipant(screen, options = {}) {
  const ctx = { language: 'ko', auth: { isAuthed: true, me: { id: 'viewer', nickname: '하늘' }, promptLogin: reason => calls.push(['login', reason]) }, post: participantPost, profile: participantProfile, request: null, destination: null, sourceInvalid: false, ...options };
  let hooks = [], cursor = 0, effects = [], dirty = true, tree, mounted = true;
  const calls = [], alerts = []; const noop = () => {}; 
  const effect = (fn, deps = [], phase = 'passive') => {
    const index = cursor++, previous = hooks[index];
    if (previous && deps.length === previous.deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    const slot = hooks[index] = { deps, phase, cleanup: previous?.cleanup };
    effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); });
  };
  const react = {
    useState(value) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof value === 'function' ? value() : value;
      return [hooks[i], next => { const value = typeof next === 'function' ? next(hooks[i]) : next; if (!Object.is(hooks[i], value)) { hooks[i] = value; dirty = true; } }]; },
    useRef(value) { return hooks[cursor++] ??= { current: value }; },
    useCallback(fn, deps) { const i = cursor++; if (!hooks[i] || deps.some((value, j) => !Object.is(value, hooks[i].deps[j]))) hooks[i] = { fn, deps }; return hooks[i].fn; },
    useEffect: effect, useLayoutEffect: (fn, deps) => effect(fn, deps, 'layout'), useSyncExternalStore() { cursor++; }, memo: value => value,
  };
  class Value { constructor(value) { this.value = value; } setValue(value) { this.value = value; } interpolate() { return 1; } stopAnimation() {} }
  const animated = { Value, View: 'View', timing: () => ({ start: fn => fn?.() }), spring: () => ({ start: fn => fn?.() }), parallel: () => ({ start: fn => fn?.() }) };
  const native = { StyleSheet: { create: value => value, hairlineWidth: 1 }, View: 'View', TextInput: 'TextInput', KeyboardAvoidingView: 'View', Modal: 'Modal', Animated: animated, Easing: { out: value => value }, Keyboard: { dismiss() {} }, LayoutAnimation: { configureNext() {}, Presets: { easeInEaseOut: {} } }, Platform: { OS: 'ios' }, useWindowDimensions: () => ({ width: ctx.width ?? 390, height: 844, fontScale: ctx.fontScale ?? 1 }), Alert: { alert: (...args) => alerts.push(args) }, AppState: { addEventListener: () => ({ remove() {} }) }, DeviceEventEmitter: { addListener: () => ({ remove() {} }), emit: value => calls.push(['emit', value]) } };
  const imports = {
    react, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }), Fragment: 'Fragment' }, 'react-native': native,
    'expo-router': { useFocusEffect: fn => effect(fn, [fn]), useRouter: () => ({ push: route => calls.push(['push', JSON.parse(JSON.stringify(route))]), replace: route => calls.push(['replace', JSON.parse(JSON.stringify(route))]), back: () => calls.push(['back']), canGoBack: () => !!ctx.canGoBack, setParams: value => calls.push(['params', value]) }) },
    'react-native-reanimated': { __esModule: true, default: { View: 'View' }, FadeInDown: { delay: () => ({ duration() {} }) }, useReducedMotion: () => true },
    'react-native-safe-area-context': { SafeAreaView: 'View', useSafeAreaInsets: () => ({ bottom: 0, right: 0 }) }, 'expo-symbols': { SymbolView: 'Symbol' },
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async key => { calls.push(['read-pref', key]); return ctx.readPreference ? ctx.readPreference(key) : ctx.preference ?? null; }, setItem: async (key, value) => calls.push(['write-pref', key, JSON.parse(value)]) } },
    '@/hooks/use-language': { useLanguage: () => ({ language: ctx.language, locale: ctx.language === 'en' ? 'en-CA' : 'ko-KR', t: translationsFor(ctx.language), tr: (value, ...args) => translateUi(ctx.language, value, ...args) }) },
    '@/hooks/use-theme': { useTheme: () => ctx.theme ?? {} }, '@/hooks/use-content-visibility': { useContentVisibility: () => () => false },
    '@/lib/auth': { useAuth: () => ctx.auth }, '@/lib/community-city': { useCommunityCity: () => ({ city: { id: 'vancouver', name: '밴쿠버', state: 'open' } }) },
    '@/lib/membership-provider': { useMembership: () => ({ membership: {}, refresh: noop }) }, '@/components/relationship-slot-card': { relationshipSlotData: () => null },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: value => calls.push(['feedback', value]) }) },
    '@/lib/supabase': { supabase: { rpc: async name => name === 'get_meetup_fee_payments' && ctx.payments === 'error' ? { error: { message: 'offline' } } : { data: name === 'get_meetup_fee_payments' ? ctx.payments ?? [] : null, error: null } } }, '@/lib/meetup-host-tools': hostTools, '@/lib/personal-info': { ageForMeetupRecommendation: () => null },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 12, four: 16, six: 24 }, Depth: { control: {}, card: {} }, MaxContentWidth: 640, TabBarHeight: 60 }, '@/constants/design-system': designSystem,
    '@/lib/chilling': chilling, '@/lib/chilling-discovery': discovery, '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버', state: 'open' }], TAGS: [{ id: 5, kind: 'meetup' }] },
    '@/lib/city-places': { subscribeCityPlaces() {}, cityPlacesRevision() {} }, '@/lib/meetup-destination': { matchesMeetupDestination: () => true, meetupDestinationQuery: () => 'source' }, '@/lib/ticketmaster': { meetupAllowed: () => true, loadTicketmasterEvent: async () => ({ event: { id: ctx.destination?.eventId, name: '실제 행사' } }) },
    '@/lib/feed-data': { loadPublicFeed: async () => ctx.posts ?? [ctx.post], appendUniquePosts: (a, b) => [...a, ...b], loadPublicPost: async () => ctx.post },
    '@/lib/community-data': { loadMyMeetups: async () => ctx.myItems ?? [{ ...ctx.post, authorId: ctx.post.author.id, role: 'approved', conversationId: 'conversation' }], recordPostShare: async () => {}, loadPendingMeetupRequests: async () => [], MEETUPS_CHANGED_EVENT: 'changed', leaveMeetup: async () => calls.push(['leave']), requestMeetupJoin: async () => calls.push(['legacy-join']) },
    '@/lib/chilling-data': { chillingProfilePreview: value => value, getChillingError: value => value.message, getChillingErrorCode: value => value.message, loadChillingProfile: async () => { if (ctx.profileError) throw new Error(ctx.profileError); return ctx.profile; }, loadMeetupParticipation: async () => { calls.push(['status-read']); return ctx.loadParticipation ? ctx.loadParticipation() : ctx.request; }, requestChillingJoin: async (...args) => { calls.push(['join', ...args.slice(1)]); if (ctx.submit) return ctx.submit(); } },
  };
  const filename = screen === 'discovery' ? 'app/(tabs)/meetups' : screen === 'mine' ? 'components/my-meetups' : 'app/meetup-join';
  const exportName = screen === 'discovery' ? 'MeetupDiscovery' : screen === 'mine' ? 'MyMeetupsContent' : 'JoinForm';
  const source = readFileSync(new URL(`../src/${filename}.tsx`, import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source + `\nexport { ${exportName} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, { exports, require: name => {
    if (name in imports) return imports[name];
    if (name.startsWith('@/components/')) return new Proxy({}, { get: (_, key) => key });
    throw new Error(`Unexpected import ${name}`);
  }, Date, Intl, JSON, setTimeout: () => 0, clearTimeout() {} });
  const render = () => { dirty = false; cursor = 0; tree = exports[exportName](screen === 'discovery' ? { destination: ctx.destination, sourceInvalid: ctx.sourceInvalid } : screen === 'mine' ? { onOpen: noop } : { postId: ctx.post.id }); effects.splice(0).forEach(fn => fn()); return tree; };
  const flush = async () => { for (let i = 0; i < 15; i++) { if (dirty && mounted) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty || !mounted) return tree; } throw new Error('component did not settle'); };
  return { ctx, calls, alerts, get tree() { return tree; }, render, flush, control: id => nodes(tree).find(node => node.props?.analyticsId === id), unmountLayout() { mounted = false; hooks.filter(hook => hook?.phase === 'layout').forEach(hook => hook.cleanup?.()); }, unmount() { mounted = false; hooks.forEach(hook => hook?.cleanup?.()); }, rerender() { dirty = true; } };
}

test('discovery starts at ALL, remembers explicit type/My, and passes kind only when selected', async () => {
  const ui = mountParticipant('discovery'); await ui.flush();
  let kind = nodes(ui.tree).find(node => node.type === 'MeetupKindSwitch'); assert.equal(kind.props.value, null);
  ui.control('app_tabs_meetups.pressable.3').props.onPress(); assert.deepEqual(ui.calls.at(-1), ['push', { pathname: '/meetup-create', params: {} }]);
  kind.props.onChange('group'); await ui.flush(); ui.control('app_tabs_meetups.pressable.3').props.onPress();
  assert.equal(ui.calls.at(-1)[1].params.kind, 'group');
  ui.control('meetup.discovery.mine').props.onPress(); await ui.flush(); assert.ok(nodes(ui.tree).some(node => node.type === 'MyMeetups'));
  assert.equal(ui.calls.findLast(([name]) => name === 'write-pref')[2].view, 'mine'); ui.unmount();
});
test('stored state restores, a slow preference read cannot override a tap, and unmount prevents old writes', async () => {
  const stored = mountParticipant('discovery', { preference: JSON.stringify({ kind: 'once', view: 'mine' }) }); await stored.flush();
  assert.ok(nodes(stored.tree).some(node => node.type === 'MyMeetups')); stored.unmount();
  let resolve; const ui = mountParticipant('discovery', { readPreference: () => new Promise(yes => { resolve = yes; }) }); await ui.flush();
  const oldMine = ui.control('meetup.discovery.mine'); oldMine.props.onPress(); await ui.flush(); resolve(JSON.stringify({ kind: 'group', view: 'browse' })); await ui.flush();
  assert.ok(nodes(ui.tree).some(node => node.type === 'MyMeetups')); const before = ui.calls.length; ui.unmount(); oldMine.props.onPress(); assert.equal(ui.calls.length, before);
});
test('place context stays browse despite saved My and preserves exact source when creating', async () => {
  const destination = { kind: 'place', cityId: 'vancouver', place: { id: 'exact-place', name: '실제 장소' } };
  const ui = mountParticipant('discovery', { destination, preference: JSON.stringify({ kind: 'all', view: 'mine' }) }); await ui.flush();
  assert.ok(nodes(ui.tree).some(node => node.type === 'FlatList')); ui.control('app_tabs_meetups.pressable.3').props.onPress();
  assert.deepEqual(ui.calls.at(-1)[1].params, { placeCityId: 'vancouver', placeId: 'exact-place' }); ui.unmount();
});
test('application previews the same global profile before answer and requires fresh per-post consent', async () => {
  const ui = mountParticipant('join'); await ui.flush();
  const all = nodes(ui.tree), preview = all.findIndex(node => node.type === 'ChillingProfileCard'), answer = all.findIndex(node => node.type === 'TextInput');
  assert.ok(preview >= 0 && preview < answer); assert.equal(all[preview].props.profile, participantProfile);
  all[answer].props.onChangeText('함께 걷고 싶어요.'); await ui.flush(); assert.equal(ui.control('app_meetup-join.pressable.8').props.disabled, true);
  ui.control('app_meetup-join.pressable.7').props.onPress(); await ui.flush(); assert.equal(ui.control('app_meetup-join.pressable.8').props.disabled, false);
  ui.control('app_meetup-join.pressable.6').props.onPress(); assert.deepEqual(ui.calls.at(-1), ['push', { pathname: '/meetup-profile', params: { returnPostId: participantPost.id } }]);
  ui.control('app_meetup-join.pressable.8').props.onPress(); await ui.flush(); assert.equal(ui.calls.find(([name]) => name === 'join')[4], 'profile-r1');
  assert.ok(nodes(ui.tree).some(node => node.type === 'StateCard' && node.props.kind === 'pending')); ui.unmount();
});
test('pending and approved remain distinct, and retained cancellation cannot run after leaving screen', async () => {
  for (const status of ['pending', 'approved']) {
    const ui = mountParticipant('join', { request: { id: 'request', status } }); await ui.flush();
    assert.ok(nodes(ui.tree).some(node => node.type === 'StateCard' && node.props.kind === (status === 'approved' ? 'success' : 'pending')));
    if (status === 'pending') { ui.control('app_meetup-join.pressable.12').props.onPress(); const confirm = ui.alerts.at(-1)[2].find(button => button.style === 'destructive'); ui.unmount(); confirm.onPress(); await ui.flush(); assert.equal(ui.calls.some(([name]) => name === 'leave'), false); }
    else ui.unmount();
  }
});
test('late application success does not fetch or write status after account/screen teardown; back keeps native fallback', async () => {
  let resolve; const ui = mountParticipant('join', { submit: () => new Promise(yes => { resolve = yes; }) }); await ui.flush();
  nodes(ui.tree).find(node => node.type === 'TextInput').props.onChangeText('답변'); ui.control('app_meetup-join.pressable.7').props.onPress(); await ui.flush();
  ui.control('app_meetup-join.pressable.8').props.onPress(); const reads = ui.calls.filter(([name]) => name === 'status-read').length; ui.unmount(); resolve(); await ui.flush(); assert.equal(ui.calls.filter(([name]) => name === 'status-read').length, reads);
  const back = mountParticipant('join'); await back.flush(); back.control('app_meetup-join.pressable.1').props.onPress(); assert.deepEqual(back.calls.at(-1), ['replace', '/(tabs)/meetups']); back.unmount();
});

test('layout teardown invalidates retained cancellation before old passive cleanup runs', async () => {
  const ui = mountParticipant('join', { request: { id: 'request', status: 'pending' } }); await ui.flush();
  ui.control('app_meetup-join.pressable.12').props.onPress();
  const confirm = ui.alerts.at(-1)[2].find(button => button.style === 'destructive');
  ui.unmountLayout(); // Account B can already own the client while the old A passive effect is pending.
  confirm.onPress(); await ui.flush(); assert.equal(ui.calls.some(([name]) => name === 'leave'), false);
  ui.unmount();
});
test('an explicit ALL tap wins over a delayed saved type and My view', async () => {
  let resolve; const ui = mountParticipant('discovery', { readPreference: () => new Promise(yes => { resolve = yes; }) }); await ui.flush();
  nodes(ui.tree).find(node => node.type === 'MeetupKindSwitch').props.onAll();
  resolve(JSON.stringify({ kind: 'group', view: 'mine' })); await ui.flush();
  assert.equal(nodes(ui.tree).find(node => node.type === 'MeetupKindSwitch').props.value, null);
  assert.ok(nodes(ui.tree).some(node => node.type === 'FlatList'));
  assert.deepEqual(ui.calls.find(([name]) => name === 'write-pref')[2], { kind: 'all', view: 'browse' }); ui.unmount();
});

const fill = async ui => { nodes(ui.tree).find(node => node.type === 'TextInput').props.onChangeText('답변'); ui.control('app_meetup-join.pressable.7').props.onPress(); await ui.flush(); };
test('pending applicant goes to the meetups tab, never the host request inbox; host gets the review action', async () => {
  const ui = mountParticipant('join', { request: { id: 'request', status: 'pending' } }); await ui.flush();
  const cta = ui.control('app_meetup-join.pressable.3'); assert.equal(cta.props.label, '내 모임에서 보기');
  cta.props.onPress(); assert.deepEqual(ui.calls.at(-1), ['replace', '/(tabs)/meetups']); ui.unmount();
  const host = mountParticipant('join', { auth: { isAuthed: true, me: { id: 'host', nickname: '소라' }, promptLogin() {} } }); await host.flush();
  const review = host.control('app_meetup-join.pressable.3'); assert.equal(review.props.label, '참여 신청자 검토하기');
  review.props.onPress(); assert.deepEqual(host.calls.at(-1), ['push', { pathname: '/chat', params: { view: 'requests' } }]); host.unmount();
});
test('an unavailable profile photo keeps the meetup and status visible, blocks submit and offers the profile', async () => {
  const ui = mountParticipant('join', { profileError: 'CHILLING_PROFILE_PHOTOS_UNAVAILABLE' }); await ui.flush();
  assert.ok(text(ui.tree).includes(participantPost.title)); assert.equal(ui.control('app_meetup-join.pressable.8').props.disabled, true);
  const open = ui.control('app_meetup-join.pressable.5'); assert.equal(text(open), '모임 프로필 열기');
  open.props.onPress(); assert.deepEqual(ui.calls.at(-1), ['push', { pathname: '/meetup-profile', params: { returnPostId: participantPost.id } }]); ui.unmount();
  const pending = mountParticipant('join', { profileError: 'CHILLING_PROFILE_PHOTOS_UNAVAILABLE', request: { id: 'request', status: 'pending' } }); await pending.flush();
  assert.ok(nodes(pending.tree).some(node => node.type === 'StateCard' && node.props.kind === 'pending')); pending.unmount();
});
test('full or host-capacity rejection disables submit without repeating the full message as a footer alert', async () => {
  for (const code of ['MEETUP_FULL', 'MEETUP_HOST_CAPACITY_LIMIT']) {
    const ui = mountParticipant('join', { submit: () => { throw new Error(code); } }); await ui.flush(); await fill(ui);
    ui.control('app_meetup-join.pressable.8').props.onPress(); await ui.flush();
    assert.equal(ui.control('app_meetup-join.pressable.8').props.disabled, true); assert.equal(ui.control('app_meetup-join.pressable.8').props.label, '정원이 모두 찼어요');
    assert.equal(nodes(ui.tree).some(node => node.props?.accessibilityRole === 'alert' && text(node) === code), code !== 'MEETUP_FULL'); ui.unmount();
  }
});
test('reapply cooldown shows minutes only with a secondary status check', async () => {
  const ui = mountParticipant('join', { request: { id: 'request', status: 'rejected', created_at: new Date().toISOString(), responded_at: new Date().toISOString() } }); await ui.flush();
  const card = nodes(ui.tree).find(node => node.type === 'StateCard' && node.props.kind === 'blocked');
  assert.equal(card.props.actionLabel, undefined); assert.doesNotMatch(card.props.body, /\d+:\d{2}:\d{2}/);
  assert.ok(nodes(ui.tree).some(node => node.props?.analyticsId === 'app_meetup-join.pressable.9' && text(node) === '현재 상태 확인')); ui.unmount();
});
test('a paused meetup shows 모집 마감 and disables the request; a host pause during submit reads the same', async () => {
  const paused = mountParticipant('join', { post: { ...participantPost, room: { ...participantPost.room, recruitingClosed: true } } }); await paused.flush(); await fill(paused);
  assert.ok(nodes(paused.tree).some(node => node.type === 'StateCard' && node.props.title === '모집 마감'));
  const cta = paused.control('app_meetup-join.pressable.8');
  assert.equal(cta.props.disabled, true); assert.equal(cta.props.label, '지금은 새 신청을 받지 않아요');
  cta.props.onPress(); await paused.flush(); assert.equal(paused.calls.some(([name]) => name === 'join'), false); paused.unmount();
  const late = mountParticipant('join', { submit: () => { throw new Error('MEETUP_RECRUITING_CLOSED'); } }); await late.flush(); await fill(late);
  late.control('app_meetup-join.pressable.8').props.onPress(); await late.flush();
  assert.equal(late.control('app_meetup-join.pressable.8').props.disabled, true);
  assert.equal(nodes(late.tree).some(node => node.props?.accessibilityRole === 'alert' && text(node) === 'MEETUP_RECRUITING_CLOSED'), false, 'the card explains it once');
  late.unmount();
  const host = mountParticipant('join', { post: { ...participantPost, room: { ...participantPost.room, recruitingClosed: true } }, auth: { isAuthed: true, me: { id: 'host', nickname: '소라' }, promptLogin() {} } }); await host.flush();
  assert.equal(host.control('app_meetup-join.pressable.3').props.label, '참여 신청자 검토하기'); host.unmount();
});

const feeRoom = { ...participantPost.room, fee: { amount: 15.5, note: 'e-Transfer', dueOn: '2031-11-01' } };
test('applicants see the fee with the schedule and approved members see their own mark', async () => {
  const applicant = mountParticipant('join', { post: { ...participantPost, room: feeRoom } }); await applicant.flush();
  assert.deepEqual(nodes(applicant.tree).find(node => node.type === 'ChillingEventSchedule').props.room.fee, feeRoom.fee); applicant.unmount();
  for (const [status, payments, paid] of [['approved', [{ user_id: 'viewer', paid_at: '2031-01-01' }], true], ['approved', [], false], ['approved', 'error', null], ['pending', [{ user_id: 'viewer' }], null]]) {
    const ui = mountParticipant('join', { post: { ...participantPost, room: feeRoom }, request: { id: 'request', status }, payments }); await ui.flush();
    const line = nodes(ui.tree).find(node => node.type === 'MeetupFeeLine');
    assert.equal(line.props.fee, feeRoom.fee); assert.equal(line.props.paid, paid, `${status} ${JSON.stringify(payments)}`); ui.unmount();
  }
  const none = mountParticipant('join', { request: { id: 'request', status: 'approved' } }); await none.flush();
  assert.equal(nodes(none.tree).some(node => node.type === 'MeetupFeeLine'), false); none.unmount();
});

test('the meetup card, schedule and fee line render the compact CAD fee in both languages', () => {
  const source = readFileSync(new URL('../src/components/chilling-event.tsx', import.meta.url), 'utf8');
  // English copy comes from the shared i18n table; here it only needs the CAD amount and a localized date.
  for (const [language, expected, status] of [['ko', /^회비 \$15\.50 · e-Transfer · 11월 1일까지$/, /^회비 \$20\.00 · 아직 안 냈어요$/], ['en', /\$15\.50 · e-Transfer · .*November 1/, /\$20\.00 · /]]) {
    const exports = {}, imports = {
      react: { memo: value => value, useState: value => [value, () => {}] }, 'react/jsx-runtime': { jsx: (type, props) => typeof type === 'function' ? type(props) : { type, props }, jsxs: (type, props) => typeof type === 'function' ? type(props) : { type, props }, Fragment: 'Fragment' },
      'react-native': { StyleSheet: { create: value => value, hairlineWidth: 1 }, View: 'View' }, 'expo-image': { Image: 'Image' },
      '@/hooks/use-language': { useLanguage: () => ({ language, locale: language === 'en' ? 'en-CA' : 'ko-KR', tr: (value, ...args) => translateUi(language, value, ...args) }) },
      '@/hooks/use-theme': { useTheme: () => ({}) }, '@/lib/auth': { useAuth: () => ({ me: { id: 'viewer' }, isAuthed: true }) }, '@/lib/chilling': chilling, '@/lib/meetup-host-tools': hostTools,
      '@/lib/feed-data': { getPostImageSource: () => null }, '@/lib/community-data': {}, '@/lib/supabase': {}, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => {
      if (name in imports) return imports[name];
      if (name.startsWith('@/components/')) return new Proxy({}, { get: (_, key) => key });
      throw new Error(`Unexpected import ${name}`);
    }, Date, Intl });
    const lines = tree => nodes(tree).filter(node => node.type === 'ThemedText').map(text);
    assert.ok(lines(exports.ChillingEventSchedule({ room: feeRoom })).some(line => expected.test(line)), language);
    const card = exports.ChillingEvent({ post: { ...participantPost, room: feeRoom }, city: 'Vancouver', onOpen() {}, onAuthor() {} });
    assert.ok(lines(card).some(line => expected.test(line)), language);
    assert.match(nodes(card).find(node => node.props?.analyticsId === 'components_chilling-event.pressable.2').props.accessibilityLabel, /\$15\.50/);
    assert.match(lines(exports.MeetupFeeLine({ fee: { amount: 20 }, paid: false }))[0], status);
    assert.equal(lines(exports.ChillingEventSchedule({ room: participantPost.room })).some(line => line.includes('$')), false);
  }
});
