import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as ticketmaster from '../supabase/functions/_shared/ticketmaster.ts';

function carousel({ web = false, focused = true, activeCard = true, reducedMotion = false, screenReader = false, eventCount = 8, now = '2026-10-12T06:59:00Z', nextRefreshAt } = {}) {
  let hook = 0, dirty = false, time = Date.parse(now), focus = focused, tree;
  const hooks = [], pending = [], timers = new Map(), listeners = new Map(), requests = [], motion = [], scrolls = [];
  const events = Array.from({ length: eventCount }, (_, index) => ({ id: `f${index}`, name: `f${index} Festival`, startsAt: `2099-01-${String(index + 1).padStart(2, '0')}T20:00:00Z`, localDate: `2099-01-${String(index + 1).padStart(2, '0')}`, status: 'onsale', timeUnconfirmed: false, city: 'Vancouver', country: 'CA', venue: 'Park', image: 'https://example.invalid/image.jpg', ticketUrl: null }));
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const state = initial => {
    const index = hook++;
    if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
    return [hooks[index].value, value => { const next = typeof value === 'function' ? value(hooks[index].value) : value; if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; } }];
  };
  const effect = (callback, deps) => {
    const index = hook++, old = hooks[index];
    if (!same(old?.deps, deps)) { old?.cleanup?.(); hooks[index] = { deps }; pending.push(() => { hooks[index].cleanup = callback(); }); }
  };
  const memo = (callback, deps) => {
    const index = hook++; if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: callback, deps }; return hooks[index].value;
  };
  const on = (name, callback) => { const callbacks = listeners.get(name) ?? new Set(); callbacks.add(callback); listeners.set(name, callbacks); return { remove: () => callbacks.delete(callback) }; };
  const addEventListener = (name, callback) => { on(name, callback); };
  const removeEventListener = (name, callback) => listeners.get(name)?.delete(callback);
  const interval = (callback, delay) => { const id = Symbol(); timers.set(id, { callback, delay }); return id; };
  const appState = { currentState: 'active', addEventListener: (_, callback) => on('appState', callback) };
  const document = { visibilityState: 'visible', addEventListener, removeEventListener };
  const window = { setInterval: interval, clearInterval: id => timers.delete(id), addEventListener, removeEventListener, matchMedia: () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} }) };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  const load = async query => { requests.push(query); return { events, nextRefreshAt, festivalSlots: [{ slot: 2, eventId: 'f7', endsAt: '2099-01-07T00:00:00Z' }] }; };
  const imports = {
    react: { useEffect: effect, useState: state, useCallback: memo, useRef: value => { const index = hook++; return hooks[index] ??= { current: value }; } },
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'expo-router': { Link: Object.assign(() => {}, { AppleZoom: 'Zoom' }), useIsFocused: () => focus, useRouter: () => ({}), useFocusEffect: callback => effect(() => focus ? callback() : undefined, [callback, focus]) },
    'react-native': { AccessibilityInfo: { isScreenReaderEnabled: async () => screenReader, addEventListener: () => ({ remove() {} }) }, AppState: appState, View: 'View', StyleSheet: { create: value => value, flatten: value => value, absoluteFill: {} }, useWindowDimensions: () => ({ width: 390 }), Easing: { inOut: value => value, sin: () => {} }, Animated: { View: 'AnimatedView', Value: class { interpolate() { return this; } setValue() {} }, timing() {}, sequence() {}, loop: () => ({ start: () => motion.push('start'), stop: () => motion.push('stop') }) } },
    'react-native-reanimated': { useReducedMotion: () => reducedMotion }, 'expo-image': { Image: 'Image' }, 'expo-symbols': { SymbolView: 'Symbol' },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/components/analytics-controls': { Pressable: 'Pressable', ScrollView: 'ScrollView' },
    '@/lib/event-videos': { eventVideo: event => event.id === 'f2' ? { youtubeId: 'video' } : null },
    '@/lib/ticketmaster': { ...ticketmaster, festivalLocalDay: city => ticketmaster.festivalLocalDay(city, time), loadTicketmasterEvents: load },
    '@/lib/public-web': { loadPublicFestivals: async () => ({ events: ticketmaster.spotlightLocalEvents(events, time, (await load({ cityId: 'vancouver' })).festivalSlots), nextRefreshAt: nextRefreshAt && Date.parse(nextRefreshAt) > time ? nextRefreshAt : undefined }) },
    '../../../supabase/functions/_shared/ticketmaster': { ...ticketmaster, festivalLocalDay: city => ticketmaster.festivalLocalDay(city, time) },
  };
  const file = web ? '../src/components/public-web/festivals.tsx' : '../src/components/local-events-carousel.tsx';
  const source = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(source + (web ? '' : '\nexports.card = FeaturedEventCard;'), { exports, require: name => imports[name] ?? {}, Date: Clock, document, window, setInterval: interval, clearInterval: id => timers.delete(id) });
  const render = async (card = false) => {
    let count = 0;
    do {
      hook = 0; dirty = false;
      tree = card ? exports.card({ event: events[0], cityId: 'vancouver', index: 0, active: activeCard, reducedMotion, onOpen() {} })
        : web ? exports.PublicFestivals({ cityId: 'vancouver', cityName: 'Vancouver' }) : exports.LocalEventsCarousel({ cityId: 'vancouver', refreshKey: 0, cityLoading: false, onCityReady: ready });
      const scroll = elements(tree).find(node => node.props?.analyticsId === 'today.events.carousel');
      if (scroll) scroll.props.ref.current = { scrollTo: position => scrolls.push(position) };
      for (const callback of pending.splice(0)) callback();
      await new Promise(resolve => setImmediate(resolve));
    } while (dirty && ++count < 12);
    assert.ok(count < 12, 'render must settle');
    return tree;
  };
  const ready = () => {};
  return { requests, motion, scrolls, render, tree: () => tree, async focus(value) { focus = value; await render(); }, async emit(name, value) { if (name === 'appState') appState.currentState = value; if (name === 'visibilitychange') document.visibilityState = value; for (const callback of [...(listeners.get(name) ?? [])]) callback(value); await render(); }, async tick(delay, advance = 0) { time += advance; for (const timer of [...timers.values()]) if (timer.delay === delay) timer.callback(); await render(); } };
}

function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

function cards(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(cards);
  return [...(tree.props?.event ? [tree.props.event.id] : []), ...cards(tree.props?.children)];
}
test('native carousel loads only in the foreground, keeps seven positions and does not prioritize videos', async () => {
  const ui = carousel({ focused: false }); await ui.render(); assert.equal(ui.requests.length, 0);
  await ui.focus(true); assert.equal(ui.requests.length, 1);
  assert.deepEqual(cards(ui.tree()), ['f0', 'f7', 'f1', 'f2', 'f3', 'f4', 'f5']);
  await ui.tick(6000); assert.equal(ui.requests.length, 1);
  await ui.emit('appState', 'background'); await ui.tick(60000, 120000); assert.equal(ui.requests.length, 1);
  await ui.emit('appState', 'active'); assert.equal(ui.requests.length, 2);
  await ui.focus(false); await ui.focus(true); assert.equal(ui.requests.length, 3);
});
test('native carousel re-reads the saved city feed when the local day changes', async () => {
  const ui = carousel(); await ui.render(); assert.equal(ui.requests.length, 1);
  await ui.tick(60000, 120000); assert.equal(ui.requests.length, 2);
  await ui.tick(60000); assert.equal(ui.requests.length, 2);
});
test('automatic rotation moves the scroll view without replacing its native page containers', async () => {
  const ui = carousel(); await ui.render();
  const keys = () => elements(ui.tree()).find(node => node.props?.analyticsId === 'today.events.carousel').props.children.map(node => node.key);
  const original = keys();
  const pages = elements(ui.tree()).find(node => node.props?.analyticsId === 'today.events.carousel').props.children;
  assert.ok(pages.every(node => node.type === 'View' && node.props.collapsable === false));
  await ui.tick(6000);
  assert.equal(ui.scrolls.at(-1).x, 358);
  assert.deepEqual(keys(), original);
  for (let index = 0; index < 6; index++) await ui.tick(6000);
  assert.equal(ui.scrolls.at(-1).x, 0);
  assert.equal(ui.requests.length, 1);
});
test('foreground refresh resets both the active card and its visible scroll position', async () => {
  const ui = carousel(); await ui.render(); await ui.tick(6000);
  await ui.emit('appState', 'background'); await ui.emit('appState', 'active');
  assert.equal(ui.scrolls.at(-1).x, 0);
  assert.equal(ui.scrolls.at(-1).animated, false);
  assert.ok(elements(ui.tree()).find(node => node.props?.event)?.props.active);
  await ui.tick(6000); assert.equal(ui.scrolls.at(-1).x, 358);
});
test('two Vancouver cards alternate every six seconds without another data request', async () => {
  const ui = carousel({ eventCount: 2 }); await ui.render();
  for (const expected of [358, 0, 358, 0]) {
    await ui.tick(6000); assert.equal(ui.scrolls.at(-1).x, expected);
  }
  assert.equal(ui.requests.length, 1);
});
test('a single event, reduced motion, a screen reader or a background app does not auto-scroll', async () => {
  for (const options of [{ eventCount: 1 }, { reducedMotion: true }, { screenReader: true }]) {
    const ui = carousel(options); await ui.render(); const count = ui.scrolls.length; await ui.tick(6000);
    assert.equal(ui.scrolls.length, count);
  }
  const ui = carousel(); await ui.render(); const count = ui.scrolls.length; await ui.emit('appState', 'background'); await ui.tick(6000);
  assert.equal(ui.scrolls.length, count);
});
test('public carousel refreshes on foreground and city-day rollover without fetching on rotation', async () => {
  const ui = carousel({ web: true }); await ui.render(); assert.equal(ui.requests.length, 1);
  await ui.tick(6000); assert.equal(ui.requests.length, 1);
  await ui.emit('visibilitychange', 'hidden'); await ui.tick(60000, 120000); assert.equal(ui.requests.length, 1);
  await ui.emit('visibilitychange', 'visible'); assert.equal(ui.requests.length, 2);
  await ui.tick(60000, 86400000); assert.equal(ui.requests.length, 3);
});
test('offscreen and reduced-motion cards do not run photo animation loops', async () => {
  for (const options of [{ activeCard: false }, { reducedMotion: true }]) { const ui = carousel(options); await ui.render(true); assert.deepEqual(ui.motion, []); }
  const visible = carousel(); await visible.render(true); assert.deepEqual(visible.motion, ['start']);
});

test('a loaded carousel rereads when a manual exposure ends before its festival starts', async () => {
  for (const web of [false, true]) {
    const ui = carousel({ web, now: '2026-10-12T19:59:00Z', nextRefreshAt: '2026-10-12T20:03:00Z' });
    await ui.render(); assert.equal(ui.requests.length, 1);
    await ui.tick(60000, 360000); assert.equal(ui.requests.length, 2);
  }
});
