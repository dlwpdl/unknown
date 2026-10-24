import { deliveryPartnerPlace } from '../src/lib/delivery-partners.ts';
import { placeMapRoute } from '../src/lib/discovery.ts';
import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as product from '../src/lib/product-analytics.ts';
import * as preferences from '../src/lib/notification-preferences.ts';
import * as maps from '../src/lib/post-maps.ts';
import { mapMessage } from '../src/lib/post-map-html.ts';
import { merchantMapsUrl, safeMerchantSourceUrl } from '../src/lib/merchant-source.ts';
import { analyticsScreen } from '../src/lib/analytics.ts';
import * as realBehavior from '../src/lib/behavior-analytics.ts';
import { getOAuthCallbackPath } from '../src/lib/kakao-auth.ts';

const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';
const noticeId = '9f100000-0000-4000-8000-000000000001';
const city = { id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver', province: 'BC', state: 'open' };
const catalog = JSON.parse(readFileSync(new URL('../src/lib/city-places.catalog.json', import.meta.url), 'utf8'));
const notification = { id: noticeId, kind: 'trending_post', category: 'trending', title: 'Notice', body: 'private body', route: '/post/9f100000-0000-4000-8000-000000000002', read_at: null, created_at: '2026-10-14' };
const event = { id: 'G5vYZabc', name: 'Event', country: 'CA', ticketUrl: 'https://www.ticketmaster.ca/private?ticket=value', venue: 'Venue' };
const response = (data = {}, actionIdentifier = DEFAULT_ACTION) => ({ actionIdentifier,
  notification: { request: { identifier: 'native-request', content: { data: { userId: 'member', notificationId: noticeId, route: '/post/9f100000-0000-4000-8000-000000000002', ...data } } } } });
const payload = (kind, targetId = null, cityId = null, platform = 'ios') => ({ p_kind: kind, p_target_id: targetId, p_city_id: cityId, p_platform: platform });
const plain = value => JSON.parse(JSON.stringify(value));
const nodes = value => !value || typeof value !== 'object' ? [] : [...(value.type ? [value] : []), ...Object.values(value).flatMap(nodes)];

// Native/network boundaries are replaced; the real components, hooks and collector run.
function mount(file, exportName = 'default', props = {}, options = {}) {
  const hooks = [], effects = [], calls = [], order = [], alerts = [], opened = [], read = [], navigated = [], listeners = new Map(), windows = new Map();
  const hidden = () => false;
  let cursor = 0, dirty = true, tree, transport;
  const ctx = { auth: { isAuthed: true, isAdmin: false, isAuthLoading: false, me: { id: 'member', cityId: 'vancouver' } },
    params: { id: event.id, cityId: 'vancouver' }, rows: [notification], focused: true, platform: 'ios', event,
    entryUrl: 'gling://events?utm_source=instagram', pathname: '/events', ...options };
  const effect = (fn, deps = []) => {
    const slot = cursor++, previous = hooks[slot];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    const state = hooks[slot] = { deps, cleanup: previous?.cleanup };
    effects.push(() => { state.cleanup?.(); state.cleanup = fn(); });
  };
  const react = {
    useEffect: effect, useLayoutEffect: effect,
    useState(initial) { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial;
      return [hooks[slot], next => { const value = typeof next === 'function' ? next(hooks[slot]) : next; if (!Object.is(value, hooks[slot])) { hooks[slot] = value; dirty = true; } }]; },
    useRef(initial) { return hooks[cursor++] ??= { current: initial }; },
    useCallback(fn, deps) { const slot = cursor++, previous = hooks[slot]; if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) hooks[slot] = { fn, deps }; return hooks[slot].fn; },
    useMemo(fn, deps) { const slot = cursor++, previous = hooks[slot]; if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) hooks[slot] = { value: fn(), deps }; return hooks[slot].value; },
  };
  const subscription = (key, listener) => { listeners.set(key, listener); return { remove: () => listeners.delete(key) }; };
  const channel = { on: () => channel, subscribe: () => channel };
  const supabase = { channel: () => channel, removeChannel() {}, rpc(name, args) {
    calls.push([name, plain(args)]); order.push(name);
    return ctx.rpc?.(name, args) ?? Promise.resolve({ data: true, error: null });
  } };
  const router = { navigate: route => { order.push(`navigate:${route}`); navigated.push(plain(route)); }, push: route => order.push(`push:${route}`), back() {} };
  const Linking = { openURL: url => { opened.push(url); return ctx.openURL?.(url) ?? Promise.resolve(); },
    getInitialURL: () => ctx.getInitialURL?.() ?? Promise.resolve(ctx.entryUrl), addEventListener: (_name, listener) => subscription('url', listener) };
  const native = new Proxy({ StyleSheet: { create: value => value, hairlineWidth: 1 }, Platform: { OS: ctx.platform }, Linking,
    Alert: { alert: (...args) => alerts.push(args) }, LayoutAnimation: { configureNext() {}, Types: { easeOut: 'easeOut' }, Properties: { opacity: 'opacity' } },
    AppState: { currentState: 'active', addEventListener: (_name, listener) => subscription('app-state', listener) },
    DeviceEventEmitter: { addListener: (name, listener) => subscription(name, listener) },
  }, { get: (target, key) => target[key] ?? key });
  const imports = {
    react, 'react-native': native, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'expo-router': { useRootNavigationState: () => ({ key: 'root' }), useRouter: () => router, useLocalSearchParams: () => ctx.params,
      useIsFocused: () => ctx.focused, useFocusEffect: fn => effect(() => ctx.focused ? fn() : undefined, [fn, ctx.focused]), usePathname: () => ctx.pathname, Link: { AppleZoomTarget: 'ZoomTarget' } },
    'expo-notifications': { DEFAULT_ACTION_IDENTIFIER: DEFAULT_ACTION, setNotificationHandler() {}, getLastNotificationResponse: () => ctx.initialResponse ?? null,
      clearLastNotificationResponseAsync: async () => {}, addNotificationResponseReceivedListener: listener => subscription('response', listener), addPushTokenListener: listener => subscription('token', listener) },
    'expo-linking': Linking, 'expo-application': { nativeApplicationVersion: '1.2.2', nativeBuildVersion: '64' },
    'expo-constants': { __esModule: true, default: { expoConfig: { version: '9.9.9', ios: { buildNumber: '999' } } } },
    'react-native-reanimated': { useReducedMotion: () => true }, 'react-native-webview': { __esModule: true, default: 'WebView' },
    '@/lib/auth': { useAuth: () => ctx.auth }, '@/lib/product-analytics': product, '@/lib/notification-preferences': preferences,
    '@/lib/push-notifications': { pushSupported: true, pushConfigured: true, registerPushDevice: async () => {} },
    '@/lib/supabase': { supabase }, '@/lib/analytics': { analyticsScreen },
    '@/lib/kakao-auth': { getOAuthCallbackPath },
    '@/lib/community-data': { loadNotifications: async () => ctx.rows, loadNotificationActors: async () => new Map(), markNotificationsRead: async (_client, ids) => read.push(plain(ids)) },
    '@/lib/ticketmaster': { loadTicketmasterEvent: async () => { if (ctx.eventError) throw new Error('offline'); return { event: ctx.event }; },
      recordTicketmasterEventClick: async (cityId, id) => order.push(`recommendation:${cityId}:${id}`), eventNotice: () => '', eventTime: () => '', eventPriceLabel: () => '', meetupAllowed: () => true },
    '@/hooks/use-city-places': { useCityPlacesRevision: () => 0 },
    '@/hooks/use-content-visibility': { useContentVisibility: () => hidden },
    '@/components/saved-entry': { SavedEntryButton: 'SavedEntryButton', useSavedEntry: () => ({ error: '' }) },
    '@/lib/city-places': { getCityRecommendations: id => catalog.cities[id]?.places ?? [], CITY_PLACES_COLLECTED_AT: catalog.collectedAt, getCityPlaces: id => { if (ctx.catalogError) throw new Error('missing'); return catalog.cities[id]?.places ?? []; } },
    '@/lib/community-city': { useCommunityCity: () => ({ city, setCity() {} }) }, '@/lib/mock': { CITIES: [city] },
    '@/lib/discovery': { placeMapRoute },
    '@/lib/delivery-partners': { deliveryPartnerPlace },
    '@/lib/webshops': { loadCityBusinessLinks: async () => ({}) },
    '@/lib/merchant-source': { merchantMapsUrl, safeMerchantSourceUrl }, '@/lib/post-maps': maps,
    '@/lib/post-map-html': { mapMessage, mapHtml: () => '<html/>', mapPinScript: () => '', mapPreviews: new Map(), rememberMapPreview() {} },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/constants/theme': { Depth: {}, Spacing: {} }, '@/lib/event-videos': { eventVideo: () => null }, '@/lib/feed-data': { relativeTime: () => '' },
    '@/lib/behavior-analytics': ctx.realBehavior ? realBehavior : { configureBehavior: value => { transport = value; }, behavior() {}, behaviorScreen() {}, flushBehavior: async () => {} },
    '@/i18n/ko': { t: new Proxy({}, { get: () => new Proxy({}, { get: (_target, key) => String(key) }) }) },
  };
  const load = file => {
    const exports = {}, source = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, { exports, URL, AbortController, setInterval: () => 1, clearInterval() {},
      window: { location: { href: ctx.entryUrl, origin: 'https://gling.ej-entertainment.com', protocol: 'https:' }, addEventListener: (name, fn) => windows.set(name, fn), removeEventListener: name => windows.delete(name) },
      require: withLanguageImports(name => imports[name] ?? new Proxy({}, { get: (_target, key) => key })),
    });
    return exports;
  };
  imports['@/lib/notification-refresh'] = load('lib/notification-refresh.ts');
  imports['@/lib/error-reporting'] = load('lib/error-reporting.ts');
  const exports = load(file);
  const render = () => {
    dirty = true;
    for (let i = 0; dirty; i++) { assert.ok(i < 30, 'effects settle'); dirty = false; cursor = 0; effects.length = 0;
      tree = exports[exportName](props); for (const run of effects) run(); }
    return tree;
  };
  const ui = { ctx, calls, order, alerts, opened, read, navigated, listeners, windows, render,
    nodes: () => nodes(tree), product: () => calls.filter(([name]) => name === 'record_product_event').map(([, args]) => args),
    async settle() { for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } },
    behavior: () => transport({ session: 'fixed-session', events: [{ seq: 1, screen: 'events', kind: 'view', target: 'screen', value: 1 }] }),
    cleanup() { for (const hook of hooks) hook?.cleanup?.(); },
  };
  render(); return ui;
}

test('own default push taps record before navigation, including cold start, without waiting on telemetry', async t => {
  for (const cold of [false, true]) {
    const ui = mount('components/notification-observer.tsx', 'NotificationObserver', {}, { initialResponse: cold ? response() : null,
      rpc: name => name === 'record_product_event' ? new Promise(() => {}) : Promise.resolve({ data: { push_enabled: false }, error: null }) });
    t.after(ui.cleanup);
    if (!cold) ui.listeners.get('response')(response());
    assert.deepEqual(ui.product(), [payload('notification_push_open', noticeId)]);
    assert.ok(ui.order.indexOf('record_product_event') < ui.order.indexOf('navigate:/post/9f100000-0000-4000-8000-000000000002'));
    assert.deepEqual(ui.read, [[noticeId]]);
    ui.listeners.get('response')(response());
    assert.equal(ui.product().length, 1, 'a repeated native response does not count again');
  }
});

test('foreign, custom-action, invalid-ID and stale push callbacks never record', async t => {
  const ui = mount('components/notification-observer.tsx', 'NotificationObserver'); t.after(ui.cleanup);
  const tap = ui.listeners.get('response');
  tap(response({ userId: 'other' })); tap(response({}, 'reply')); tap(response({ notificationId: '------------------------------------' }));
  assert.deepEqual(ui.product(), []);
  ui.ctx.auth = { ...ui.ctx.auth, me: { id: 'other' } }; ui.render();
  tap(response()); assert.deepEqual(ui.product(), []);
});

test('inbox loading and bulk read never count; only a current account row tap counts', async t => {
  const ui = mount('app/(tabs)/notifications.tsx'); t.after(ui.cleanup); await ui.settle();
  assert.deepEqual(ui.read, [[noticeId]]); assert.deepEqual(ui.product(), []);
  const list = ui.nodes().find(node => node.type === 'FlatList');
  const row = nodes(list.props.renderItem({ item: notification, index: 0 })).find(node => node.props?.analyticsId === 'app_tabs_notifications.pressable.2');
  row.props.onPress(); assert.deepEqual(ui.product(), [payload('notification_inbox_open', noticeId)]);
  assert.ok(ui.order.indexOf('record_product_event') < ui.order.indexOf('push:/post/9f100000-0000-4000-8000-000000000002'));
  ui.ctx.auth = { ...ui.ctx.auth, me: { id: 'other', cityId: 'vancouver' } }; ui.render();
  row.props.onPress(); assert.equal(ui.product().length, 1, 'a retained row callback cannot report for the next account');
});

test('event views need loaded focused data and preserve the recommendation click', async t => {
  const ui = mount('app/events/[id].tsx', 'default', {}, { focused: false }); t.after(ui.cleanup); await ui.settle();
  assert.deepEqual(ui.product(), []);
  ui.ctx.focused = true; ui.render();
  assert.deepEqual(ui.product(), [payload('event_view', event.id, 'vancouver')]);
  assert.ok(ui.order.includes(`recommendation:vancouver:${event.id}`));
  for (const options of [{ event: null }, { eventError: true }, { auth: { isAuthed: false, me: { id: 'member' } } }]) {
    const missing = mount('app/events/[id].tsx', 'default', {}, options); t.after(missing.cleanup); await missing.settle(); assert.deepEqual(missing.product(), []);
  }
});

test('ticket launch counts only after success and ignores a late success for a changed account', async t => {
  let resolve, reject;
  const ui = mount('app/events/[id].tsx', 'default', {}, { openURL: () => new Promise((yes, no) => { resolve = yes; reject = no; }) });
  t.after(ui.cleanup); await ui.settle();
  const ticket = () => ui.nodes().find(node => node.props?.analyticsId === 'ticketmaster.purchase');
  ticket().props.onPress(); assert.equal(ui.product().length, 1);
  resolve(); await ui.settle(); assert.deepEqual(ui.product().at(-1), payload('event_website', event.id, 'vancouver'));
  ticket().props.onPress(); reject(new Error('cancelled/private URL')); await ui.settle(); assert.equal(ui.product().length, 2);
  ticket().props.onPress(); ui.ctx.auth = { ...ui.ctx.auth, me: { id: 'other' } }; ui.render();
  const count = ui.product().length; resolve(); await ui.settle(); assert.equal(ui.product().length, count);
});

test('catalog place view needs focus, and website/source launches are distinguished', async t => {
  const ui = mount('app/places/[id].tsx', 'default', {}, { params: { id: 'osm:node:652955238', cityId: 'vancouver' }, focused: false });
  t.after(ui.cleanup); assert.deepEqual(ui.product(), []);
  ui.ctx.focused = true; ui.render(); assert.deepEqual(ui.product(), [payload('place_view', 'osm:node:652955238', 'vancouver')]);
  ui.nodes().find(node => node.props?.analyticsId === 'places.detail.source').props.onPress(); await ui.settle(); assert.equal(ui.product().length, 1);
  ui.nodes().find(node => node.props?.analyticsId === 'places.detail.website').props.onPress(); await ui.settle();
  assert.deepEqual(ui.product().at(-1), payload('place_website', 'osm:node:652955238', 'vancouver'));
  const map = ui.nodes().find(node => node.type === 'PostMapLink'); assert.equal(typeof map.props.onOpened, 'function');
  map.props.onOpened(); assert.deepEqual(ui.product().at(-1), payload('place_directions', 'osm:node:652955238', 'vancouver'));
  for (const options of [{ params: { id: 'osm:node:0' } }, { catalogError: true }]) {
    const missing = mount('app/places/[id].tsx', 'default', {}, options); t.after(missing.cleanup); assert.deepEqual(missing.product(), []);
  }
});

test('place launches that fail or outlive the account never claim success', async t => {
  let resolve;
  const ui = mount('app/places/[id].tsx', 'default', {}, { params: { id: 'osm:node:652955238', cityId: 'vancouver' }, openURL: async () => { throw new Error('cancelled'); } });
  t.after(ui.cleanup);
  const website = () => ui.nodes().find(node => node.props?.analyticsId === 'places.detail.website');
  website().props.onPress(); await ui.settle(); assert.equal(ui.product().length, 1); assert.equal(ui.alerts.length, 1);
  ui.ctx.openURL = () => new Promise(yes => { resolve = yes; }); website().props.onPress();
  const map = ui.nodes().find(node => node.type === 'PostMapLink');
  ui.ctx.auth = { ...ui.ctx.auth, me: { id: 'other' } }; ui.render(); const count = ui.product().length;
  resolve(); map.props.onOpened(); await ui.settle(); assert.equal(ui.product().length, count);
});

test('map-link callback runs only after launch success and map failures contain no URL/error', async t => {
  let opened = 0, resolve, reject;
  const ui = mount('components/post-map-link.tsx', 'PostMapLink', { url: 'https://maps.app.goo.gl/Example', label: 'private location', onOpened: () => { opened++; } },
    { openURL: () => new Promise((yes, no) => { resolve = yes; reject = no; }), rpc: async () => ({ error: new Error('offline') }) });
  t.after(ui.cleanup); ui.render().props.onPress(); assert.equal(opened, 0);
  resolve(); await ui.settle(); assert.equal(opened, 1);
  ui.render().props.onPress(); reject(new Error('private location/path')); await ui.settle();
  assert.equal(opened, 1); assert.equal(ui.alerts.length, 1); assert.deepEqual(ui.product(), [payload('map_error')]);
  ui.render().props.onPress(); ui.ctx.auth = { ...ui.ctx.auth, me: { id: 'other' } }; ui.render(); reject(new Error('late'));
  await ui.settle(); assert.equal(ui.product().length, 1);
});

test('native map error callbacks and bridge errors use the same fixed event and ignore stale callbacks', async t => {
  const ui = mount('components/post-pin-map.tsx', 'PostPinMap', { pin: { latitude: 49, longitude: -123 } }); t.after(ui.cleanup);
  const webview = () => ui.nodes().find(node => node.type === 'WebView');
  const failure = webview().props.onError;
  failure({ nativeEvent: { description: 'private map URL' } });
  webview().props.onMessage({ nativeEvent: { data: '{"type":"error"}' } });
  assert.deepEqual(ui.product(), [payload('map_error'), payload('map_error')]);
  ui.ctx.auth = { ...ui.ctx.auth, me: { id: 'other' } }; ui.render(); failure({}); assert.equal(ui.product().length, 2);
});

test('web map failures accept only the actual iframe bridge and contain no private map data', t => {
  const ui = mount('components/post-pin-map.tsx', 'PostPinMap', { pin: { latitude: 49, longitude: -123 } }, { platform: 'web' }); t.after(ui.cleanup);
  const iframe = ui.nodes().find(node => node.type === 'iframe'), contentWindow = { postMessage() {} };
  iframe.props.ref.current = { contentWindow };
  const receive = ui.windows.get('message');
  receive({ source: {}, origin: 'https://gling.ej-entertainment.com', data: '{"type":"error"}' });
  receive({ source: contentWindow, origin: 'https://evil.test', data: '{"type":"error"}' });
  assert.deepEqual(ui.product(), []);
  receive({ source: contentWindow, origin: 'https://gling.ej-entertainment.com', data: '{"type":"error"}' });
  assert.deepEqual(ui.product(), [payload('map_error', null, null, 'web')]);
  ui.cleanup(); receive({ source: contentWindow, origin: 'https://gling.ej-entertainment.com', data: '{"type":"error"}' });
  assert.equal(ui.product().length, 1);
});

test('behavior source is a fixed Gling entry code and visits use the installed version/build', async t => {
  for (const platform of ['ios', 'android', 'web']) {
    const ui = mount('components/app-activity.tsx', 'AppActivity', {}, { platform, entryUrl: platform === 'web' ? 'https://gling.ej-entertainment.com/events?utm_source=threads&private=value' : 'gling://events?utm_source=instagram&private=value' });
    t.after(ui.cleanup); await ui.settle(); await ui.behavior();
    const behavior = ui.calls.find(([name]) => name === 'record_behavior_events')[1];
    assert.equal(behavior.p_source, platform === 'web' ? 'threads' : 'instagram');
    assert.deepEqual(Object.keys(behavior).sort(), ['p_events', 'p_platform', 'p_session', 'p_source']);
    assert.equal(ui.calls.find(([name]) => name === 'record_app_visit')[1].p_app_version, platform === 'web' ? '9.9.9' : '1.2.2(64)');
  }
});

test('entry source resets across accounts and late initial URLs cannot override a current link', async t => {
  let finish;
  const ui = mount('components/app-activity.tsx', 'AppActivity', {}, { getInitialURL: () => new Promise(resolve => { finish = resolve; }) }); t.after(ui.cleanup);
  assert.equal(typeof ui.listeners.get('url'), 'function', 'entry URL changes need a native listener');
  ui.listeners.get('url')({ url: 'gling://events?utm_source=threads' }); finish('gling://events?utm_source=instagram'); await ui.settle(); await ui.behavior();
  assert.equal(ui.calls.at(-1)[1].p_source, 'threads');
  ui.ctx.auth = { ...ui.ctx.auth, me: { id: 'other' } }; ui.render(); await ui.settle(); await ui.behavior();
  assert.equal(ui.calls.at(-1)[1].p_source, 'unknown', 'the initial URL is not replayed into another account');
  ui.listeners.get('url')({ url: 'https://evil.test/?utm_source=instagram' }); await ui.behavior(); assert.equal(ui.calls.at(-1)[1].p_source, 'unknown');
});

test('unavailable and previous-account initial links leave current source unknown', async t => {
  let finish;
  const ui = mount('components/app-activity.tsx', 'AppActivity', {}, { auth: { isAuthed: false, isAdmin: false, me: { id: 'anonymous' } }, getInitialURL: () => new Promise(resolve => { finish = resolve; }) });
  t.after(ui.cleanup); ui.ctx.auth = { isAuthed: true, isAdmin: false, me: { id: 'new-profile' } }; ui.render();
  assert.equal(typeof finish, 'function', 'the initial native entry must be inspected once');
  finish('gling://events?utm_source=instagram'); await ui.settle(); await ui.behavior(); assert.equal(ui.calls.at(-1)[1].p_source, 'unknown');
  const offline = mount('components/app-activity.tsx', 'AppActivity', {}, { getInitialURL: async () => { throw new Error('unavailable'); } }); t.after(offline.cleanup);
  await offline.settle(); await offline.behavior(); assert.equal(offline.calls.at(-1)[1].p_source, 'unknown');
});

test('anonymous entry survives the first session and actual signup_complete, but another account and logout reset it', async t => {
  for (const source of ['instagram', 'threads']) {
    const ui = mount('components/app-activity.tsx', 'AppActivity', {}, { realBehavior: true,
      auth: { isAuthed: false, isAdmin: false, me: { id: 'me' } }, entryUrl: `gling://events?utm_source=${source}` });
    t.after(ui.cleanup); await ui.settle();
    // AuthProvider supplies the session ID before ProfileOnboarding marks the profile complete.
    ui.ctx.auth = { ...ui.ctx.auth, me: { id: '9f100000-0000-4000-8000-000000000003' } }; ui.render();
    realBehavior.behavior('success', 'signup_complete'); await ui.settle();
    const sent = () => ui.calls.filter(([name]) => name === 'record_behavior_events').at(-1)[1];
    assert.equal(sent().p_events[0].target, 'signup_complete'); assert.equal(sent().p_source, source);
    ui.ctx.auth = { ...ui.ctx.auth, isAuthed: true }; ui.render(); realBehavior.behavior('success', 'consent_complete'); await ui.settle();
    assert.equal(sent().p_source, source, 'completed first profile retains its entry code');
    ui.ctx.auth = { ...ui.ctx.auth, me: { id: '9f100000-0000-4000-8000-000000000004' } }; ui.render();
    realBehavior.behavior('success', 'signup_complete'); await ui.settle(); assert.equal(sent().p_source, 'unknown');
    ui.ctx.auth = { ...ui.ctx.auth, isAuthed: false, me: { id: 'me' } }; ui.render();
    ui.ctx.auth = { ...ui.ctx.auth, isAuthed: true, me: { id: '9f100000-0000-4000-8000-000000000003' } }; ui.render();
    realBehavior.behavior('success', 'signup_complete'); await ui.settle(); assert.equal(sent().p_source, 'unknown');
    ui.cleanup();
  }
});

test('a delayed anonymous entry belongs only to its first claimed member', async t => {
  for (const switchMember of [false, true]) {
    let finish;
    const ui = mount('components/app-activity.tsx', 'AppActivity', {}, { realBehavior: true,
      auth: { isAuthed: false, isAdmin: false, me: { id: 'me' } }, getInitialURL: () => new Promise(resolve => { finish = resolve; }) });
    t.after(ui.cleanup);
    ui.ctx.auth = { ...ui.ctx.auth, me: { id: '9f100000-0000-4000-8000-000000000003' } }; ui.render();
    if (switchMember) { ui.ctx.auth = { ...ui.ctx.auth, me: { id: '9f100000-0000-4000-8000-000000000004' } }; ui.render(); }
    finish('gling://events?utm_source=instagram'); await ui.settle(); realBehavior.behavior('success', 'signup_complete'); await ui.settle();
    assert.equal(ui.calls.filter(([name]) => name === 'record_behavior_events').at(-1)[1].p_source, switchMember ? 'unknown' : 'instagram');
    ui.cleanup();
  }
});

test('native OAuth return URLs preserve the entry code without recording the private callback', async t => {
  const ui = mount('components/app-activity.tsx', 'AppActivity', {}, { auth: { isAuthed: false, isAdmin: false, me: { id: 'me' } } }); t.after(ui.cleanup);
  await ui.settle(); ui.listeners.get('url')({ url: 'gling://auth/callback?code=private-code' }); await ui.behavior();
  assert.equal(ui.calls.at(-1)[1].p_source, 'instagram'); assert.ok(!JSON.stringify(ui.calls).includes('private-code'));
});

test('curated partner detail keeps its exact map route and hides unsupported actions while canonical places retain them', async t => {
  const partner = deliveryPartnerPlace('vancouver', 'partner:jimoco-coquitlam');
  const ui = mount('app/places/[id].tsx', 'default', {}, { params: { id: partner.id, cityId: partner.cityId } });
  t.after(ui.cleanup);
  assert.ok(ui.nodes().some(node => node.props?.children === partner.name));
  assert.ok(ui.nodes().some(node => node.type === 'PostMapLink'), 'registered location and directions remain available');
  for (const type of ['PlaceReviews', 'PlaceExternalRatings']) assert.ok(!ui.nodes().some(node => node.type === type));
  assert.ok(!ui.nodes().some(node => node.props?.analyticsId === 'ticketmaster.meetup.find'));
  ui.nodes().find(node => node.props?.analyticsId === 'places.open').props.onPress();
  const route = ui.navigated.at(-1);
  assert.equal(route.pathname, '/map');
  assert.equal(route.params.cityId, partner.cityId);
  assert.equal(route.params.placeId, partner.id);
  assert.equal(route.params.category, 'visited');
  const canonical = mount('app/places/[id].tsx', 'default', {}, { params: { id: 'osm:node:652955238', cityId: 'vancouver' } });
  t.after(canonical.cleanup);
  for (const type of ['PlaceReviews', 'PlaceExternalRatings']) assert.ok(canonical.nodes().some(node => node.type === type));
  assert.ok(canonical.nodes().some(node => node.props?.analyticsId === 'ticketmaster.meetup.find'));
  const wrongCity = mount('app/places/[id].tsx', 'default', {}, { params: { id: partner.id, cityId: 'toronto' } });
  t.after(wrongCity.cleanup);
  assert.ok(!wrongCity.nodes().some(node => node.props?.analyticsId === 'places.open'), 'a partner ID cannot resolve into a different city');
});
