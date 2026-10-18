import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const file = new URL('../src/lib/adsense.ts', import.meta.url);
const ads = {};
vm.runInNewContext(ts.transpileModule(existsSync(file) ? readFileSync(file, 'utf8') : '', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: ads, URL, URLSearchParams, WeakMap, WeakSet });
const input = { enabled: 'true', client: 'ca-pub-1234567890123456', slot: '1234567890', origin: 'https://gling.example', cmpId: '300' };
const consent = { cmpId: 300, listenerId: 1, cmpStatus: 'loaded', eventStatus: 'useractioncomplete', tcString: 'test-cmp-string', vendor: { consents: { 755: true } }, purpose: { consents: { 1: true, 2: true, 7: true, 9: true, 10: true } } };

test('web config defaults off and rejects missing, malformed, native IDs and non-public origins', () => {
  assert.equal(typeof ads.parseWebAdConfig, 'function');
  assert.equal(ads.parseWebAdConfig({}), null);
  assert.equal(ads.parseWebAdConfig({ ...input, enabled: 'false' }), null);
  for (const key of Object.keys(input)) assert.equal(ads.parseWebAdConfig({ ...input, [key]: '' }), null, key);
  for (const patch of [{ client: 'ca-app-pub-1234567890123456/1234567890' }, { client: 'ca-pub-1&x=y' }, { slot: '123<script>' }, { cmpId: '0' }, { cmpId: 'NaN' }, { origin: 'http://gling.example' }, { origin: 'https://user:secret@gling.example' }, { origin: 'https://gling.example/private' }, { origin: 'https://gling.example?token=private' }, { origin: 'https://localhost' }]) assert.equal(ads.parseWebAdConfig({ ...input, ...patch }), null, JSON.stringify(patch));
  assert.deepEqual(JSON.parse(JSON.stringify(ads.parseWebAdConfig(input))), { client: input.client, slot: input.slot, origin: input.origin, cmpId: 300 });
});

test('web seller declaration matches the verified owned Google seller and environment remains disabled', () => {
  const web = new URL('../public/ads.txt', import.meta.url);
  assert.ok(existsSync(web), 'the public web seller file must be exportable');
  const app = readFileSync(new URL('../public/app-ads.txt', import.meta.url), 'utf8');
  assert.equal(readFileSync(web, 'utf8').trim(), app.trim());
  assert.equal(app.trim(), 'google.com, pub-2361293253164911, DIRECT, f08c47fec0942fa0');
  const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(env, /^EXPO_PUBLIC_ADSENSE_ENABLED=false$/m);
  for (const field of ['CLIENT', 'SLOT', 'ORIGIN', 'CMP_ID']) assert.match(env, new RegExp(`^EXPO_PUBLIC_ADSENSE_${field}=$`, 'm'));
});

test('only the configured public feed/events/map route is eligible; private routes and parameters fail closed', () => {
  assert.equal(typeof ads.webAdPageAllowed, 'function');
  const config = ads.parseWebAdConfig(input);
  for (const [surface, pathname] of [['feed', '/'], ['feed', '/meetups'], ['events', '/events'], ['map', '/map']]) assert.equal(ads.webAdPageAllowed(config, { origin: input.origin, pathname, search: '' }, surface), true);
  for (const pathname of ['/chat', '/post', '/events/secret', '/login', '/profile', '/settings', '/admin']) assert.equal(ads.webAdPageAllowed(config, { origin: input.origin, pathname, search: '' }, 'feed'), false);
  assert.equal(ads.webAdPageAllowed(config, { origin: 'https://other.example', pathname: '/', search: '' }, 'feed'), false);
  assert.equal(ads.webAdPageAllowed(config, { origin: input.origin, pathname: '/map', search: '?conversationId=private&latitude=49.2' }, 'map'), false);
});

test('runtime CMP consent is mandatory, denied/unknown/stubbed signals never allow requests, and listeners clean up', () => {
  assert.equal(typeof ads.observeWebAdConsent, 'function');
  const decisions = [], calls = [];
  let notify;
  const api = (command, version, callback, id) => { calls.push([command, version, id]); if (command === 'addEventListener') notify = callback; };
  const stop = ads.observeWebAdConsent(300, value => decisions.push(value), { __tcfapi: api });
  for (const data of [null, {}, { ...consent, cmpStatus: 'stub' }, { ...consent, cmpId: 9 }, { ...consent, eventStatus: 'cmpuishown' }, { ...consent, tcString: '' }, { ...consent, vendor: { consents: {} } }, { ...consent, purpose: { consents: {} } }]) notify(data, true);
  assert.ok(decisions.every(value => value === false));
  notify(consent, true); assert.equal(decisions.at(-1), true);
  notify({ ...consent, purpose: { consents: {} } }, true); assert.equal(decisions.at(-1), false);
  stop(); notify(consent, true); assert.equal(decisions.at(-1), false);
  assert.deepEqual(calls.at(-1), ['removeEventListener', 2, 1]);
  const absent = []; ads.observeWebAdConsent(300, value => absent.push(value), {}); assert.deepEqual(absent, [false]);
});

function browser() {
  const scripts = [], intersections = [], mutations = [], listeners = new Map();
  const document = { visibilityState: 'visible', createElement: () => ({ addEventListener(name, fn) { this[name] = fn; } }), head: { appendChild: script => scripts.push(script) }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const window = { document, adsbygoogle: [],
    IntersectionObserver: class { constructor(fn, options) { this.fn = fn; this.options = options; intersections.push(this); } observe() {} disconnect() { this.stopped = true; } },
    MutationObserver: class { constructor(fn) { this.fn = fn; mutations.push(this); } observe() {} disconnect() { this.stopped = true; } },
  };
  const unit = () => ({ isConnected: true, status: null, getAttribute() { return this.status; }, getBoundingClientRect: () => ({ width: 320 }) });
  return { window, document, scripts, intersections, mutations, listeners, unit };
}
const flush = () => new Promise(setImmediate);

test('near-viewport ads share one official script, push each unit once and hide unfilled inventory', async () => {
  assert.equal(typeof ads.mountWebAdUnit, 'function');
  const env = browser(), states = [], config = ads.parseWebAdConfig(input);
  const first = env.unit(), second = env.unit();
  const stopA = ads.mountWebAdUnit(first, config, () => true, status => states.push(status), env.window);
  const stopB = ads.mountWebAdUnit(second, config, () => true, () => {}, env.window);
  assert.equal(env.scripts.length, 0, 'offscreen slots do not load advertising code');
  for (const observer of env.intersections) observer.fn([{ isIntersecting: true }]);
  assert.equal(env.scripts.length, 1);
  const script = env.scripts[0];
  assert.equal(script.src, `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${input.client}`);
  assert.equal(script.async, true); assert.equal(script.crossOrigin, 'anonymous');
  script.load(); await flush();
  assert.equal(env.window.adsbygoogle.length, 2);
  for (const observer of env.intersections) observer.fn([{ isIntersecting: true }]); await flush();
  assert.equal(env.window.adsbygoogle.length, 2, 'intersection/visibility updates never refresh ads');
  first.status = 'unfilled'; env.mutations[0].fn(); assert.equal(states.at(-1), 'unfilled');
  stopA(); stopB(); assert.ok(env.intersections.every(observer => observer.stopped)); assert.ok(env.mutations.every(observer => observer.stopped)); assert.equal(env.listeners.size, 0);
});

test('denial, background tabs, script failure and unmount before load cannot push an ad', async () => {
  assert.equal(typeof ads.mountWebAdUnit, 'function');
  for (const scenario of ['denied', 'background', 'unmounted', 'revoked', 'failed']) {
    const env = browser(); let allowed = scenario !== 'denied';
    env.document.visibilityState = scenario === 'background' ? 'hidden' : 'visible';
    const stop = ads.mountWebAdUnit(env.unit(), ads.parseWebAdConfig(input), () => allowed, () => {}, env.window);
    for (const observer of env.intersections) observer.fn([{ isIntersecting: true }]);
    if (scenario === 'unmounted') stop();
    if (scenario === 'revoked') allowed = false;
    if (env.scripts[0]) env.scripts[0][scenario === 'failed' ? 'error' : 'load']();
    await flush(); assert.equal(env.window.adsbygoogle.length, 0, scenario);
    stop();
  }
});

test('a delayed script cannot request after scrolling away or hiding; natural return submits once', async () => {
  for (const scenario of ['away', 'hidden']) {
    const env = browser();
    const stop = ads.mountWebAdUnit(env.unit(), ads.parseWebAdConfig(input), () => true, () => {}, env.window);
    env.intersections[0].fn([{ isIntersecting: true }]);
    if (scenario === 'away') env.intersections[0].fn([{ isIntersecting: false }]);
    else env.document.visibilityState = 'hidden';
    env.scripts[0].load(); await flush();
    assert.equal(env.window.adsbygoogle.length, 0, scenario);
    if (scenario === 'away') env.intersections[0].fn([{ isIntersecting: true }]);
    else { env.document.visibilityState = 'visible'; env.listeners.get('visibilitychange')(); }
    await flush();
    assert.equal(env.window.adsbygoogle.length, 1, `${scenario} return`);
    assert.equal(env.scripts.length, 1);
    env.intersections[0].fn([{ isIntersecting: true }]); await flush();
    assert.equal(env.window.adsbygoogle.length, 1); stop();
  }
});

function component(config) {
  const file = new URL('../src/components/feed-ad.web.tsx', import.meta.url), exports = {}, hooks = [], pending = [], calls = [];
  let at = 0, notify, status;
  const react = {
    useState(initial) { const slot = at++; if (!(slot in hooks)) hooks[slot] = initial; return [hooks[slot], value => { hooks[slot] = value; }]; },
    useRef(current) { const slot = at++; return hooks[slot] ??= { current }; },
    useEffect(fn, deps) { const slot = at++, old = hooks[slot]; if (old && deps.every((value, index) => Object.is(value, old.deps[index]))) return; hooks[slot] = { deps }; pending.push(() => { old?.cleanup?.(); hooks[slot].cleanup = fn(); }); },
  };
  vm.runInNewContext(ts.transpileModule(existsSync(file) ? readFileSync(file, 'utf8') : '', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, window: { location: { origin: input.origin, pathname: '/', search: '' } }, require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === '@/constants/theme') return { WebNightColors: {} };
      if (name === '@/lib/ads.web') return { webAdConfig: config };
      if (name === '@/lib/adsense') return { ...ads, observeWebAdConsent: (_cmpId, fn) => { calls.push('consent'); notify = fn; fn(false); return () => calls.push('consent-stop'); }, mountWebAdUnit: (_unit, _config, allowed, fn) => { assert.equal(allowed(), true); calls.push('mount'); status = fn; return () => calls.push('stop'); } };
      throw new Error(`Web advertising must not import a native SDK: ${name}`);
    },
  });
  return { calls, consent: value => notify(value), status: value => status(value), render() {
    assert.equal(typeof exports.FeedAd, 'function'); at = 0;
    const tree = exports.FeedAd();
    const ins = [tree?.props.children].flat().find(node => node?.type === 'ins'); if (ins) ins.props.ref.current = {};
    pending.splice(0).forEach(fn => fn()); return tree;
  }, cleanup() { hooks.forEach(hook => hook?.cleanup?.()); } };
}

test('web component renders nothing when unconfigured/denied, uses official tags when allowed and leaves no fake no-fill card', () => {
  const disabled = component(null); assert.equal(disabled.render(), null); assert.deepEqual(disabled.calls, []);
  const view = component(ads.parseWebAdConfig(input)); assert.equal(view.render(), null);
  view.consent(false); assert.equal(view.render(), null); assert.ok(!view.calls.includes('mount'));
  view.consent(true); let tree = view.render();
  const ins = tree.props.children.find(node => node?.type === 'ins');
  assert.equal(ins.props.className, 'adsbygoogle'); assert.equal(ins.props['data-ad-client'], input.client); assert.equal(ins.props['data-ad-slot'], input.slot); assert.equal(ins.props['data-full-width-responsive'], 'false');
  view.status('filled'); tree = view.render(); assert.equal(tree.props.style.visibility, 'visible');
  view.status('unfilled'); tree = view.render(); assert.equal(tree.props.style.visibility, 'hidden');
  view.consent(false); assert.equal(view.render(), null); assert.ok(view.calls.includes('stop')); view.cleanup();
});
