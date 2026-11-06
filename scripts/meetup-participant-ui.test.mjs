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
import * as meetupLanguage from '../src/lib/meetup-language.ts';
import * as newcomer from '../src/lib/newcomer.ts';

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
  const native = { StyleSheet: { create: value => value, hairlineWidth: 1 }, View: 'View', TextInput: 'TextInput', RefreshControl: 'RefreshControl', KeyboardAvoidingView: 'View', Modal: 'Modal', Animated: animated, Easing: { out: value => value }, Keyboard: { dismiss() {} }, LayoutAnimation: { configureNext() {}, Presets: { easeInEaseOut: {} } }, Platform: { OS: 'ios' }, useWindowDimensions: () => ({ width: ctx.width ?? 390, height: 844, fontScale: ctx.fontScale ?? 1 }), Alert: { alert: (...args) => alerts.push(args) }, AppState: { addEventListener: () => ({ remove() {} }) }, DeviceEventEmitter: { addListener: () => ({ remove() {} }), emit: value => calls.push(['emit', value]) } };
  const imports = {
    react, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }), Fragment: 'Fragment' }, 'react-native': native,
    'expo-router': { useFocusEffect: fn => effect(fn, [fn]), usePreventRemove: (active, fn) => { ctx.preventRemove = active ? fn : null; }, useRouter: () => ({ push: route => calls.push(['push', JSON.parse(JSON.stringify(route))]), replace: route => calls.push(['replace', JSON.parse(JSON.stringify(route))]), back: () => calls.push(['back']), canGoBack: () => !!ctx.canGoBack, setParams: value => calls.push(['params', value]) }) },
    'react-native-reanimated': { __esModule: true, default: { View: 'View' }, FadeInDown: { delay: () => ({ duration() {} }) }, useReducedMotion: () => true },
    'react-native-safe-area-context': { SafeAreaView: 'View', useSafeAreaInsets: () => ({ bottom: 0, right: 0 }) }, 'expo-symbols': { SymbolView: 'Symbol' },
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async key => { calls.push(['read-pref', key]); return ctx.readPreference ? ctx.readPreference(key) : ctx.preference ?? null; }, setItem: async (key, value) => calls.push(['write-pref', key, JSON.parse(value)]) } },
    '@/hooks/use-language': { useLanguage: () => ({ language: ctx.language, locale: ctx.language === 'en' ? 'en-CA' : 'ko-KR', t: translationsFor(ctx.language), tr: (value, ...args) => translateUi(ctx.language, value, ...args) }) },
    '@/hooks/use-chat-identity': { useChatIdentity: () => null }, '@/app/profile/merchant': { default: 'MerchantScreen' }, '@/hooks/use-theme': { useTheme: () => ctx.theme ?? {} }, '@/hooks/use-content-visibility': { useContentVisibility: () => () => false },
    '@/lib/auth': { useAuth: () => ctx.auth }, '@/lib/community-city': { useCommunityCity: () => ({ city: { id: 'vancouver', name: '밴쿠버', state: 'open' } }) },
    '@/lib/membership-provider': { useMembership: () => ({ membership: {}, refresh: noop }) }, '@/components/relationship-slot-card': { relationshipSlotData: () => null },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: value => calls.push(['feedback', value]) }) },
    '@/lib/push-prompt': { requestPushPrompt: reason => calls.push(['push-prompt', reason]) },
    '@/lib/shared-link-preview': { loadSharedLinkPost: async () => { calls.push(['guest-read']); return ctx.guestPost ?? ctx.post; } }, '@/lib/sharing': { SHARED_POST_RETURN_KEY: 'gling.sharedPostReturn' }, 'expo-image': { Image: 'Image' },
    '@/lib/supabase': { supabase: { rpc: async name => name === 'get_meetup_fee_payments' && ctx.payments === 'error' ? { error: { message: 'offline' } } : { data: name === 'get_meetup_fee_payments' ? ctx.payments ?? [] : name === 'get_meetup_languages' ? ctx.languages ?? null : null, error: null } } }, '@/lib/meetup-host-tools': hostTools, '@/lib/personal-info': { ageForMeetupRecommendation: () => null },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 12, four: 16, six: 24 }, Depth: { control: {}, card: {} }, MaxContentWidth: 640, TabBarHeight: 60 }, '@/constants/design-system': designSystem,
    '@/lib/newcomer': newcomer, '@/components/newcomer': { useNewcomerStatus: () => ({ status: ctx.newcomerStatus ?? null, loading: false, refresh: noop }) },
    '@/lib/chilling': chilling, '@/lib/meetup-language': meetupLanguage, '@/lib/chilling-discovery': discovery, '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버', state: 'open' }], TAGS: [{ id: 5, kind: 'meetup' }] },
    '@/lib/city-places': { subscribeCityPlaces() {}, cityPlacesRevision() {} }, '@/lib/meetup-destination': { matchesMeetupDestination: () => true, meetupDestinationQuery: () => 'source' }, '@/lib/ticketmaster': { meetupAllowed: () => true, loadTicketmasterEvent: async () => ({ event: { id: ctx.destination?.eventId, name: '실제 행사' } }) },
    '@/lib/feed-data': { loadPublicFeed: async () => ctx.posts ?? [ctx.post], appendUniquePosts: (a, b) => [...a, ...b], loadPublicPost: async () => ctx.post },
    '@/lib/community-data': { loadMyMeetups: async () => ctx.myItems ?? [{ ...ctx.post, authorId: ctx.post.author.id, role: 'approved', conversationId: 'conversation' }], recordPostShare: async () => {}, loadPendingMeetupRequests: async () => [], MEETUPS_CHANGED_EVENT: 'changed', leaveMeetup: async () => calls.push(['leave']), requestMeetupJoin: async () => calls.push(['legacy-join']) },
    '@/lib/chilling-data': { chillingProfilePreview: value => value, getChillingError: value => value.message, getChillingErrorCode: value => value.message, loadChillingProfile: async () => { if (ctx.profileError) throw new Error(ctx.profileError); return ctx.profile; }, loadMeetupParticipation: async () => { calls.push(['status-read']); return ctx.loadParticipation ? ctx.loadParticipation() : ctx.request; }, requestChillingJoin: async (...args) => { calls.push(['join', ...args.slice(1)]); if (ctx.submit) return ctx.submit(); }, saveChillingProfile: async (_, input) => { calls.push(['save-profile', input]); if (ctx.saveError) throw new Error(ctx.saveError); ctx.profile = { ...input, revision: 'made-r1' }; } },
    '@/components/chilling-host-profile': { MeetupChips: 'MeetupChips', useMyOpenMeetupRequests: () => ctx.myRequests ?? {} },
  };
  const filename = screen === 'discovery' ? 'app/(tabs)/meetups' : screen === 'mine' ? 'components/my-meetups' : 'app/meetup-join';
  const exportName = screen === 'discovery' ? 'MeetupDiscovery' : screen === 'mine' ? 'MyMeetupsContent' : 'JoinForm';
  const source = readFileSync(new URL(`../src/${filename}.tsx`, import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source + `\nexport { ${exportName} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, { exports, require: name => {
    if (name in imports) return imports[name];
    if (name.startsWith('@/components/')) return new Proxy({}, { get: (_, key) => key });
    throw new Error(`Unexpected import ${name}`);
  }, Date, Intl, JSON, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: fn => fn() });
  const render = () => { dirty = false; cursor = 0; tree = exports[exportName](screen === 'discovery' ? { destination: ctx.destination, sourceInvalid: ctx.sourceInvalid, routedMine: ctx.routedMine } : screen === 'mine' ? { onOpen: noop } : { postId: ctx.post.id }); effects.splice(0).forEach(fn => fn()); return tree; };
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
test('the join screen opens My directly: the route beats a saved view, keeps the saved kind, is cleared after use, and works on a live tab', async () => {
  const hasMine = ui => nodes(ui.tree).some(node => node.type === 'MyMeetups');
  const browse = JSON.stringify({ kind: 'once', view: 'browse' });
  const cold = mountParticipant('discovery', { routedMine: true, preference: browse }); await cold.flush();
  assert.ok(hasMine(cold)); assert.equal(nodes(cold.tree).find(node => node.type === 'MeetupKindSwitch').props.value, 'once');
  assert.equal(cold.calls.find(([name]) => name === 'params')[1].view, '');
  assert.equal(cold.calls.some(([name]) => name === 'write-pref'), false, 'a route visit does not overwrite the saved view'); cold.unmount();
  const live = mountParticipant('discovery', { preference: browse }); await live.flush(); assert.equal(hasMine(live), false);
  live.ctx.routedMine = true; live.rerender(); await live.flush(); assert.ok(hasMine(live));
  assert.equal(live.calls.find(([name]) => name === 'params')[1].view, ''); live.unmount();
});
test('search keeps the filter row and opens beside it, and My keeps every entry in its summary rows', async () => {
  const ui = mountParticipant('discovery'); ui.render();
  const header = () => nodes(ui.tree).find(node => node.type === 'FlatList').props.ListHeaderComponent;
  assert.ok(nodes(header()).some(node => node.type === 'MeetupKindSwitch'), 'the filter row is there while the list is still loading'); await ui.flush();
  ui.control('app_tabs_meetups.pressable.13').props.onPress(); await ui.flush();
  assert.ok(nodes(header()).some(node => node.type === 'TextInput'), 'the search field scrolls with the button that opened it');
  ui.control('meetup.discovery.mine').props.onPress(); await ui.flush();
  const row = nodes(ui.tree).find(node => node.type === 'MyMeetups').props.summaryRows.find(item => item?.props?.analyticsId === 'app_tabs_meetups.pressable.2');
  row.props.onPress(); assert.deepEqual(ui.calls.at(-1), ['push', '/meetup-profile']); ui.unmount();
});
test('filters open in the shared drag sheet and close from its action', async () => {
  const ui = mountParticipant('discovery'); await ui.flush();
  const sheet = () => nodes(ui.tree).find(node => node.type === 'DragSheet');
  assert.equal(sheet().props.visible, false);
  ui.control('app_tabs_meetups.pressable.14').props.onPress(); await ui.flush(); assert.equal(sheet().props.visible, true);
  sheet().props.onClose(); await ui.flush(); assert.equal(sheet().props.visible, false);
  ui.control('app_tabs_meetups.pressable.14').props.onPress(); await ui.flush();
  ui.control('app_tabs_meetups.pressable.15').props.onPress(); await ui.flush(); assert.equal(sheet().props.visible, false); ui.unmount();
});
test('place context stays browse despite saved My and preserves exact source when creating', async () => {
  const destination = { kind: 'place', cityId: 'vancouver', place: { id: 'exact-place', name: '실제 장소' } };
  const ui = mountParticipant('discovery', { destination, preference: JSON.stringify({ kind: 'all', view: 'mine' }) }); await ui.flush();
  assert.ok(nodes(ui.tree).some(node => node.type === 'FlatList')); ui.control('app_tabs_meetups.pressable.3').props.onPress();
  assert.deepEqual(ui.calls.at(-1)[1].params, { placeCityId: 'vancouver', placeId: 'exact-place' }); ui.unmount();
});
test('application shows the same global profile one tap away; the send button is the per-post consent', async () => {
  const ui = mountParticipant('join'); await ui.flush();
  const sheet = () => nodes(ui.tree).find(node => node.type === 'DragSheet');
  assert.equal(sheet().props.visible, false);
  ui.control('app_meetup-join.pressable.13').props.onPress(); await ui.flush();
  assert.equal(sheet().props.visible, true); assert.equal(nodes(sheet()).find(node => node.type === 'ChillingProfileCard').props.profile, participantProfile);
  nodes(ui.tree).find(node => node.type === 'TextInput').props.onChangeText('함께 걷고 싶어요.'); await ui.flush();
  assert.equal(ui.control('app_meetup-join.pressable.8').props.disabled, false); assert.equal(ui.control('app_meetup-join.pressable.8').props.label, '동의하고 신청 보내기');
  assert.equal(ui.control('app_meetup-join.pressable.7'), undefined, 'no separate consent box');
  // The edit screen opens only once the sheet has really gone.
  ui.control('app_meetup-join.pressable.6').props.onPress(); await ui.flush(); assert.equal(sheet().props.visible, false); assert.equal(ui.calls.some(([name]) => name === 'push'), false);
  sheet().props.onDismissed(); assert.deepEqual(ui.calls.at(-1), ['push', { pathname: '/meetup-profile', params: { returnPostId: participantPost.id } }]);
  sheet().props.onDismissed(); assert.equal(ui.calls.filter(([name]) => name === 'push').length, 1, 'closing it again does not reopen the editor');
  ui.control('app_meetup-join.pressable.8').props.onPress(); await ui.flush(); assert.equal(ui.calls.find(([name]) => name === 'join')[4], 'profile-r1');
  assert.ok(nodes(ui.tree).some(node => node.type === 'StateCard' && node.props.kind === 'pending')); ui.unmount();
});
test('the footer says what is left, and leaving asks first only while an unsent answer exists', async () => {
  const ui = mountParticipant('join'); await ui.flush();
  const hint = () => nodes(ui.tree).find(node => node.props?.accessibilityLiveRegion === 'polite' && node.type === 'ThemedText');
  assert.equal(text(hint()), '답변을 쓰면 보낼 수 있어요'); assert.equal(ui.ctx.preventRemove, null);
  nodes(ui.tree).find(node => node.type === 'TextInput').props.onChangeText('답변'); await ui.flush();
  assert.equal(text(hint()), '호스트에게만 보내요');
  let left = 0; ui.ctx.preventRemove({ repeat: () => { left++; } });
  const [heading, , buttons] = ui.alerts.at(-1); assert.equal(heading, '쓰던 답변이 사라져요');
  assert.equal(buttons.find(button => button.style === 'cancel').text, '계속 쓰기'); assert.equal(left, 0);
  buttons.find(button => button.style === 'destructive').onPress(); assert.equal(left, 1);
  ui.control('app_meetup-join.pressable.8').props.onPress(); await ui.flush();
  assert.equal(ui.ctx.preventRemove, null, 'a sent answer never asks'); ui.unmount();
});
test('a request shows where it is on a step line, and approval moves it on', async () => {
  for (const [status, states] of [['pending', ['done', 'now', 'next']], ['approved', ['done', 'done', 'now']]]) {
    const ui = mountParticipant('join', { request: { id: 'request', status } }); await ui.flush();
    assert.deepEqual([...nodes(ui.tree).find(node => node.props?.steps).props.steps].map(step => step.state), states); ui.unmount();
  }
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
  nodes(ui.tree).find(node => node.type === 'TextInput').props.onChangeText('답변'); await ui.flush();
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

const fill = async ui => { nodes(ui.tree).find(node => node.type === 'TextInput').props.onChangeText('답변'); await ui.flush(); };
test('pending applicant goes to the meetups tab, never the host request inbox; host gets the review action', async () => {
  const ui = mountParticipant('join', { request: { id: 'request', status: 'pending' } }); await ui.flush();
  const cta = ui.control('app_meetup-join.pressable.3'); assert.equal(cta.props.label, '내 모임에서 보기');
  cta.props.onPress(); assert.deepEqual(ui.calls.at(-1), ['replace', { pathname: '/(tabs)/meetups', params: { view: 'mine' } }]); ui.unmount();
  const host = mountParticipant('join', { auth: { isAuthed: true, me: { id: 'host', nickname: '소라' }, promptLogin() {} } }); await host.flush();
  const review = host.control('app_meetup-join.pressable.3'); assert.equal(review.props.label, '참여 신청자 검토하기');
  review.props.onPress(); assert.deepEqual(host.calls.at(-1), ['push', { pathname: '/chat', params: { view: 'requests' } }]); host.unmount();
});
test('an unavailable profile photo keeps the meetup and status visible, blocks submit and offers the profile', async () => {
  const ui = mountParticipant('join', { profileError: 'CHILLING_PROFILE_PHOTOS_UNAVAILABLE' }); await ui.flush();
  assert.ok(text(ui.tree).includes(participantPost.title)); assert.equal(ui.control('app_meetup-join.pressable.8'), undefined);
  const open = ui.control('app_meetup-join.pressable.5'); assert.equal(open.props.label, '모임 프로필 열기');
  open.props.onPress(); assert.deepEqual(ui.calls.at(-1), ['push', { pathname: '/meetup-profile', params: { returnPostId: participantPost.id } }]); ui.unmount();
  const pending = mountParticipant('join', { profileError: 'CHILLING_PROFILE_PHOTOS_UNAVAILABLE', request: { id: 'request', status: 'pending' } }); await pending.flush();
  assert.ok(nodes(pending.tree).some(node => node.type === 'StateCard' && node.props.kind === 'pending')); pending.unmount();
});
const inputs = ui => nodes(ui.tree).filter(node => node.type === 'TextInput');
const firstApplication = async (options = {}) => {
  const ui = mountParticipant('join', { profile: null, ...options }); await ui.flush();
  const [, intro, answer] = inputs(ui);
  intro.props.onChangeText('주말에 걸어요'); answer.props.onChangeText('쓰던 답변'); await ui.flush();
  return ui;
};
test('without a profile one screen saves it and sends the request, in that order, with the saved revision', async () => {
  const ui = mountParticipant('join', { profile: null }); await ui.flush();
  assert.equal(inputs(ui)[0].props.value, '하늘', 'the app nickname is already filled in');
  const cta = () => ui.control('app_meetup-join.pressable.8');
  assert.equal(cta().props.disabled, true); assert.equal(ui.control('app_meetup-join.pressable.5'), undefined, 'no detour to the profile screen');
  ui.unmount();
  const filled = await firstApplication();
  const send = filled.control('app_meetup-join.pressable.8'); assert.equal(send.props.disabled, false); assert.equal(send.props.label, '동의하고 신청 보내기');
  send.props.onPress(); await filled.flush();
  const order = filled.calls.filter(([name]) => name === 'save-profile' || name === 'join');
  assert.deepEqual(order.map(([name]) => name), ['save-profile', 'join']);
  const saved = order[0][1]; assert.equal(saved.displayName, '하늘'); assert.equal(saved.intro, '주말에 걸어요'); assert.equal(saved.shareWithMembers, false, 'a first application never widens who sees the profile');
  assert.equal(order[1][4], 'made-r1');
  assert.ok(nodes(filled.tree).some(node => node.type === 'StateCard' && node.props.kind === 'pending')); assert.equal(filled.ctx.preventRemove, null); filled.unmount();
});
test('a saved profile whose request failed says so, keeps the answer, and retries without saving again', async () => {
  let fail = true;
  const ui = await firstApplication({ submit: () => { if (fail) throw new Error('offline'); } });
  ui.control('app_meetup-join.pressable.8').props.onPress(); await ui.flush();
  assert.ok(nodes(ui.tree).some(node => node.type === 'StateCard' && node.props.title === '프로필은 저장했어요'));
  assert.equal(inputs(ui)[0].props.value, '쓰던 답변');
  fail = false; ui.control('app_meetup-join.pressable.8').props.onPress(); await ui.flush();
  assert.equal(ui.calls.filter(([name]) => name === 'save-profile').length, 1); assert.equal(ui.calls.filter(([name]) => name === 'join').length, 2);
  assert.ok(nodes(ui.tree).some(node => node.type === 'StateCard' && node.props.kind === 'pending')); ui.unmount();
});
test('a profile that could not be saved sends nothing and keeps everything written', async () => {
  const ui = await firstApplication({ saveError: 'offline' });
  ui.control('app_meetup-join.pressable.8').props.onPress(); await ui.flush();
  assert.equal(ui.calls.some(([name]) => name === 'join'), false);
  assert.equal(inputs(ui)[1].props.value, '주말에 걸어요'); assert.equal(inputs(ui)[2].props.value, '쓰던 답변');
  assert.equal(nodes(ui.tree).some(node => node.props?.title === '프로필은 저장했어요'), false); ui.unmount();
});
test('list cards know which meetups already have my request', async () => {
  const ui = mountParticipant('discovery', { myRequests: { [participantPost.id]: 'pending' } }); await ui.flush();
  const list = nodes(ui.tree).find(node => node.type === 'FlatList');
  const card = list.props.renderItem({ item: participantPost, index: 0 });
  assert.equal(nodes(card).find(node => node.type === 'ChillingEvent').props.requestStatus, 'pending'); ui.unmount();
});
test('a language exchange asks which side you speak, sends it, and moves only a full side to the waitlist', async () => {
  const exchange = { ...participantPost, room: { ...participantPost.room, capacity: 5, category: 'casual', languageExchange: { languages: ['ko', 'en'], share: 50 } } };
  const languages = { sides: [{ language: 'ko', seats: 2, approved: 1, pending: null, waiting: null }, { language: 'en', seats: 2, approved: 2, pending: null, waiting: null }], mine: null, requests: null, unknown: null };
  const ui = mountParticipant('join', { post: exchange, languages }); await ui.flush(); await fill(ui);
  const cta = () => ui.control('app_meetup-join.pressable.8'), picker = () => nodes(ui.tree).find(node => node.type === 'MeetupLanguagePicker');
  assert.equal(cta().props.disabled, true); assert.equal(cta().props.label, '할 줄 아는 말을 골라 주세요');
  assert.equal(nodes(ui.tree).some(node => node.type === 'MeetupWaitlist'), false, 'an open meetup shows no waitlist before a side is chosen');
  picker().props.onChange('en'); await ui.flush();
  assert.equal(cta().props.disabled, true); assert.equal(cta().props.label, '고른 언어 쪽은 자리가 다 찼어요');
  assert.deepEqual({ ...nodes(ui.tree).find(node => node.type === 'MeetupWaitlist').props.language }, { speaks: 'en', learns: 'ko' }); assert.equal(nodes(ui.tree).find(node => node.type === 'MeetupWaitlist').props.cta, 'secondary');
  picker().props.onChange('ko'); await ui.flush();
  assert.equal(cta().props.disabled, false); assert.equal(nodes(ui.tree).some(node => node.type === 'MeetupWaitlist'), false);
  cta().props.onPress(); await ui.flush();
  assert.deepEqual({ ...ui.calls.find(([name]) => name === 'join').at(-1) }, { speaks: 'ko', learns: 'en' }); ui.unmount();
  // The server's side check still wins when the counts were stale.
  const late = mountParticipant('join', { post: exchange, languages: null, submit: () => { throw new Error('LANGUAGE_SIDE_FULL'); } }); await late.flush(); await fill(late);
  nodes(late.tree).find(node => node.type === 'MeetupLanguagePicker').props.onChange('ko'); await late.flush();
  late.control('app_meetup-join.pressable.8').props.onPress(); await late.flush();
  assert.equal(late.control('app_meetup-join.pressable.8').props.label, '고른 언어 쪽은 자리가 다 찼어요');
  assert.equal(nodes(late.tree).some(node => node.props?.accessibilityRole === 'alert' && text(node) === 'LANGUAGE_SIDE_FULL'), false); late.unmount();
});
test('full or host-capacity rejection replaces the form with the waitlist and keeps the answer', async () => {
  for (const code of ['MEETUP_FULL', 'MEETUP_HOST_CAPACITY_LIMIT']) {
    const ui = mountParticipant('join', { submit: () => { throw new Error(code); } }); await ui.flush(); await fill(ui);
    ui.control('app_meetup-join.pressable.8').props.onPress(); await ui.flush();
    assert.equal(ui.control('app_meetup-join.pressable.8'), undefined); assert.equal(nodes(ui.tree).some(node => node.type === 'TextInput'), false);
    assert.ok(nodes(ui.tree).some(node => node.type === 'StateCard' && node.props.title === '정원이 모두 찼어요'));
    const waitlist = nodes(ui.tree).find(node => node.type === 'MeetupWaitlist'); assert.equal(waitlist.props.cta, 'primary'); assert.equal(waitlist.props.fallback.props.label, '다른 모임 찾기');
    assert.match(text(ui.tree), /쓴 답변은 남아 있어요/);
    assert.equal(nodes(ui.tree).some(node => node.props?.accessibilityRole === 'alert' && text(node) === code), code !== 'MEETUP_FULL'); ui.unmount();
  }
});
test('reapply cooldown says when it opens, offers other meetups, and can be pulled to refresh', async () => {
  const ui = mountParticipant('join', { request: { id: 'request', status: 'rejected', created_at: new Date().toISOString(), responded_at: new Date().toISOString() } }); await ui.flush();
  const card = nodes(ui.tree).find(node => node.type === 'StateCard' && node.props.kind === 'blocked');
  assert.equal(card.props.actionLabel, undefined); assert.doesNotMatch(card.props.body, /\d+:\d{2}:\d{2}/); assert.match(card.props.body, /이 화면에서 다시 신청할 수 있어요/);
  assert.equal(nodes(ui.tree).some(node => node.type === 'TextInput'), false);
  assert.equal(ui.control('app_meetup-join.pressable.3').props.label, '다른 모임 찾기');
  const before = ui.calls.length; ui.control('app_meetup-join.scrollview.1').props.refreshControl.props.onRefresh(); await ui.flush(); assert.ok(ui.calls.length > before); ui.unmount();
  const writing = mountParticipant('join'); await writing.flush(); assert.equal(writing.control('app_meetup-join.scrollview.1').props.refreshControl, undefined, 'pulling never reloads over a half-written answer'); writing.unmount();
});
test('logged out (시안 A): guest read, meetup head and one bottom action per state', async () => {
  const guest = (room, extra = {}) => { const asked = []; const guestPost = { ...participantPost, imageUris: [], room: { ...participantPost.room, ...room }, ...extra };
    const ui = mountParticipant('join', { guestPost, post: { ...participantPost, title: 'AUTHED_ONLY_READ' }, auth: { isAuthed: false, me: { id: '' }, promptLogin: reason => asked.push(reason) } }); return { ui, asked }; };
  const bar = ui => { const action = ['app_meetup-join.pressable.2', 'app_meetup-join.pressable.3'].map(ui.control).find(Boolean); return { action, text: text(nodes(ui.tree).find(node => node.props?.accessibilityLiveRegion === 'polite')) }; };
  const open = guest({}, { imageUris: ['https://example.test/cover'] }); await open.ui.flush();
  assert.ok(open.ui.calls.some(([name]) => name === 'guest-read')); assert.ok(text(open.ui.tree).includes(participantPost.title)); assert.ok(!text(open.ui.tree).includes('AUTHED_ONLY_READ'));
  assert.equal(nodes(open.ui.tree).find(node => node.type === 'Image').props.accessibilityLabel, `${participantPost.title} 사진`);
  assert.equal(nodes(open.ui.tree).find(node => node.type === 'MeetupChips').props.hideOpen, true);
  assert.deepEqual({ ...nodes(open.ui.tree).find(node => node.type === 'MeetupFacts').props, post: undefined }, { post: undefined, canEnterChat: false, own: false });
  assert.ok(text(open.ui.tree).includes('로그인하면 소라님이 남긴 질문에 답하고 신청을 보낼 수 있어요.'));
  let { action, text: meta } = bar(open.ui); assert.equal(meta, '5자리 남음승인 후 참여'); assert.equal(action.props.label, '로그인하고 신청하기'); assert.equal(action.props.compact, true);
  action.props.onPress(); assert.deepEqual(open.asked, ['참여하려면 로그인해 주세요.']); assert.ok(open.ui.calls.some(([name, kind]) => name === 'feedback' && kind === 'selection'));
  assert.equal(nodes(open.ui.tree).some(node => node.props?.analyticsId === 'app_meetup-join.pressable.8'), false, 'no request form before login'); open.ui.unmount();

  const full = guest({ memberCount: 8 }); await full.ui.flush();
  ({ action, text: meta } = bar(full.ui)); assert.equal(meta, '정원이 모두 찼어요자리가 나면 순서대로 알려 드려요.'); assert.equal(action.props.label, '로그인하고 빈자리 알림 받기');
  assert.equal(nodes(full.ui.tree).some(node => node.type === 'Image'), false, 'no photo, no photo slot'); assert.ok(!text(full.ui.tree).includes('남긴 질문')); action.props.onPress(); assert.equal(full.asked.length, 1); full.ui.unmount();

  const ended = guest({ startsAt: '2020-06-12T17:00:00Z', endsAt: '2020-06-12T19:00:00Z' }); await ended.ui.flush();
  ({ action, text: meta } = bar(ended.ui)); assert.equal(meta, '종료된 모임이에요새 참여 신청과 승인을 할 수 없어요.'); assert.equal(action.props.label, '다른 모임 찾기');
  action.props.onPress(); assert.deepEqual(ended.ui.calls.at(-1), ['replace', '/(tabs)/meetups']); assert.equal(ended.asked.length, 0); ended.ui.unmount();

  const gone = guest({}); gone.ui.ctx.guestPost = { ...participantPost, room: undefined }; await gone.ui.flush();
  assert.equal(nodes(gone.ui.tree).find(node => node.type === 'StateCard').props.title, '이 모임을 볼 수 없어요'); assert.equal(gone.ui.control('app_meetup-join.pressable.2'), undefined); gone.ui.unmount();
});
test('a paused meetup offers no form; a host pause during submit reads the same', async () => {
  const paused = mountParticipant('join', { post: { ...participantPost, room: { ...participantPost.room, recruitingClosed: true } } }); await paused.flush();
  assert.ok(nodes(paused.tree).some(node => node.type === 'StateCard' && node.props.title === '지금은 새 신청을 받지 않아요'));
  assert.equal(paused.control('app_meetup-join.pressable.8'), undefined); assert.equal(nodes(paused.tree).some(node => node.type === 'TextInput'), false);
  paused.control('app_meetup-join.pressable.3').props.onPress(); assert.deepEqual(paused.calls.at(-1), ['replace', '/(tabs)/meetups']); paused.unmount();
  const late = mountParticipant('join', { submit: () => { throw new Error('MEETUP_RECRUITING_CLOSED'); } }); await late.flush(); await fill(late);
  late.control('app_meetup-join.pressable.8').props.onPress(); await late.flush();
  assert.equal(late.control('app_meetup-join.pressable.8'), undefined);
  assert.equal(nodes(late.tree).some(node => node.props?.accessibilityRole === 'alert' && text(node) === 'MEETUP_RECRUITING_CLOSED'), false, 'the card explains it once');
  late.unmount();
  const host = mountParticipant('join', { post: { ...participantPost, room: { ...participantPost.room, recruitingClosed: true } }, auth: { isAuthed: true, me: { id: 'host', nickname: '소라' }, promptLogin() {} } }); await host.flush();
  assert.equal(host.control('app_meetup-join.pressable.3').props.label, '참여 신청자 검토하기'); host.unmount();
});

const feeRoom = { ...participantPost.room, fee: { amount: 15.5, note: 'e-Transfer', dueOn: '2031-11-01' } };
test('applicants see the fee on the meetup card and approved members see their own mark', async () => {
  const applicant = mountParticipant('join', { post: { ...participantPost, room: feeRoom } }); await applicant.flush();
  assert.match(text(applicant.tree), /회비 \$15\.50/); assert.match(text(applicant.tree), /e-Transfer · 11월 1일까지/); applicant.unmount();
  const feeRow = ui => nodes(ui.tree).find(node => node.type === 'ListRow' && /회비/.test(node.props.title));
  for (const [payments, mark] of [[[{ user_id: 'viewer', paid_at: '2031-01-01' }], /냈음$/], [[], /아직 안 냈어요$/], ['error', /까지$/]]) {
    const ui = mountParticipant('join', { post: { ...participantPost, room: feeRoom }, request: { id: 'request', status: 'approved' }, payments }); await ui.flush();
    assert.match(feeRow(ui).props.detail, mark, JSON.stringify(payments)); ui.unmount();
  }
  const pending = mountParticipant('join', { post: { ...participantPost, room: feeRoom }, request: { id: 'request', status: 'pending' }, payments: [{ user_id: 'viewer' }] }); await pending.flush();
  assert.equal(feeRow(pending), undefined); assert.doesNotMatch(text(pending.tree), /냈음/); pending.unmount();
  const none = mountParticipant('join', { request: { id: 'request', status: 'approved' } }); await none.flush();
  assert.equal(feeRow(none), undefined); none.unmount();
});

test('the meetup card, schedule and fee line render the compact CAD fee in both languages', () => {
  const source = readFileSync(new URL('../src/components/chilling-event.tsx', import.meta.url), 'utf8');
  // English copy comes from the shared i18n table; here it only needs the CAD amount and a localized date.
  for (const [language, expected, status] of [['ko', /^회비 \$15\.50 · e-Transfer · 11월 1일까지$/, /^회비 \$20\.00 · 아직 안 냈어요$/], ['en', /\$15\.50 · e-Transfer · .*November 1/, /\$20\.00 · /]]) {
    const exports = {}, imports = {
      react: { memo: value => value, useState: value => [value, () => {}] }, 'react/jsx-runtime': { jsx: (type, props) => typeof type === 'function' ? type(props) : { type, props }, jsxs: (type, props) => typeof type === 'function' ? type(props) : { type, props }, Fragment: 'Fragment' },
      'react-native': { StyleSheet: { create: value => value, hairlineWidth: 1 }, View: 'View' }, 'expo-image': { Image: 'Image' }, '@/constants/design-system': { ControlMotion: { settleMs: 180 } },
      '@/hooks/use-language': { useLanguage: () => ({ language, locale: language === 'en' ? 'en-CA' : 'ko-KR', tr: (value, ...args) => translateUi(language, value, ...args) }) },
      '@/hooks/use-chat-identity': { useChatIdentity: () => null }, '@/hooks/use-theme': { useTheme: () => ({}) }, '@/lib/auth': { useAuth: () => ({ me: { id: 'viewer' }, isAuthed: true }) }, '@/lib/chilling': chilling, '@/lib/meetup-language': meetupLanguage, '@/lib/meetup-host-tools': hostTools,
      '@/lib/feed-data': { getPostImageSource: () => null }, '@/lib/community-data': {}, '@/lib/supabase': {}, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
      '@/components/newcomer': { MeetupLabelBadges: 'MeetupLabelBadges', useMeetupLabelPrefix: () => '' },
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
test('a newcomer-only meetup shows the newcomer note instead of the request form to longer-term members', async () => {
  const post = { ...participantPost, room: { ...participantPost.room, newcomerWelcome: true, newcomerOnly: true } };
  const note = tree => nodes(tree).some(node => node.props?.title === '새 멤버만 신청할 수 있는 모임이에요');
  const ui = mountParticipant('join', { post, newcomerStatus: { newcomer: false, periodDays: 60, endsAt: null, requested: false, attended: false } }); await ui.flush();
  assert.ok(note(ui.tree)); ui.unmount();
  const fresh = mountParticipant('join', { post, newcomerStatus: { newcomer: true, periodDays: 60, endsAt: '2099-01-01T00:00:00Z', requested: false, attended: false } }); await fresh.flush();
  assert.ok(!note(fresh.tree)); fresh.unmount();
});
