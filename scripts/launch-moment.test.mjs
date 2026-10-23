import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function launch({ ready = true, reduced = false } = {}) {
  let now = 0, nextTimer = 0, cursor = 0, dirty = false, mounted = true;
  const timers = new Map(), slots = [], pendingEffects = [], animations = [], completed = [];
  const schedule = (fn, delay) => { const id = ++nextTimer; timers.set(id, { at: now + delay, fn }); return id; };
  const cancel = id => timers.delete(id);
  let hideResolve, hideReject, hideCalls = 0;
  const hidden = new Promise((resolve, reject) => { hideResolve = resolve; hideReject = reject; });
  const hooks = {
    useState(initial) { const key = cursor++; if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial; return [slots[key], value => { const next = typeof value === 'function' ? value(slots[key]) : value; if (slots[key] !== next) { slots[key] = next; dirty = true; } }]; },
    useRef(initial) { const key = cursor++; if (!(key in slots)) slots[key] = { current: initial }; return slots[key]; },
    useEffect(fn, deps) { const key = cursor++; if (!slots[key] || deps.some((value, index) => value !== slots[key].deps[index])) pendingEffects.push(() => { slots[key]?.cleanup?.(); slots[key] = { deps, cleanup: fn() }; }); },
  };
  const timing = (value, config) => {
    let timer, callback;
    return { start(done) { callback = done; animations.push({ at: now, config }); timer = schedule(() => { value.setValue(config.toValue); callback = null; done?.({ finished: true }); }, config.duration); }, stop() { cancel(timer); const done = callback; callback = null; done?.({ finished: false }); } };
  };
  const parallel = children => {
    let callback, left;
    return { start(done) { callback = done; left = children.length; for (const child of children) child.start(result => { if (!callback) return; if (!result.finished) { const finish = callback; callback = null; finish(result); } else if (!--left) { const finish = callback; callback = null; finish({ finished: true }); } }); }, stop() { for (const child of children) child.stop(); callback = null; } };
  };
  const sequence = children => {
    let index = 0, callback;
    const step = result => { if (!callback) return; if (!result.finished || index === children.length) { const done = callback; callback = null; done(result); } else children[index++].start(step); };
    return { start(done) { callback = done; index = 0; step({ finished: true }); }, stop() { const done = callback; callback = null; children[index - 1]?.stop(); done?.({ finished: false }); } };
  };
  const Animated = { Value: class { constructor(value) { this.value = value; } setValue(value) { this.value = value; } }, timing, parallel, sequence, loop: child => ({ start() {}, stop() { child.stop(); } }), View: 'AnimatedView', Image: 'AnimatedImage' };
  const exported = {}, modules = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { Animated, Easing: { in: value => value, out: value => value, inOut: value => value, cubic: 'cubic', quad: 'quad' }, Image: 'Image', StyleSheet: { create: value => value } },
    'expo-splash-screen': { hideAsync() { hideCalls++; return hidden; } }, 'react-native-reanimated': { useReducedMotion: () => reduced }, '@/hooks/use-language': { useLanguage: () => ({ tr: value => value }) },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/launch-moment.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports: exported, require: name => name.startsWith('@/assets/') ? name : modules[name], setTimeout: schedule, clearTimeout: cancel });
  const props = { ready, onComplete: () => completed.push(now) };
  let tree;
  function render() { if (!mounted) return tree; cursor = 0; dirty = false; tree = exported.LaunchMoment(props); while (pendingEffects.length) pendingEffects.shift()(); return tree; }
  async function settle() { for (let index = 0; index < 5; index++) { await Promise.resolve(); if (mounted && dirty) render(); } }
  const nodes = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(next => Array.isArray(next) ? next.flatMap(nodes) : nodes(next))];
  render();
  return {
    animations, completed, get hideCalls() { return hideCalls; }, get time() { return now; }, get timerCount() { return timers.size; },
    layout() { tree.props.onLayout(); render(); },
    async load(error = false) { for (const node of nodes(tree).filter(node => ['Image', 'AnimatedImage'].includes(node.type))) { const handler = node.props[error ? 'onError' : 'onLoad']; assert.equal(typeof handler, 'function', 'Every required splash image has a load/error readiness handler.'); handler(); } await settle(); },
    async reveal() { hideResolve(); await settle(); }, async failHide() { hideReject(new Error('native hide unavailable')); await settle(); },
    async ready(value) { props.ready = value; render(); await settle(); },
    async advance(milliseconds) { const end = now + milliseconds; while (true) { const entry = [...timers.entries()].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!entry) break; timers.delete(entry[0]); now = entry[1].at; entry[1].fn(); await settle(); } now = end; await settle(); },
    unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('fast data readiness cannot spend the visible intro behind native splash or an unloaded logo', async () => {
  const view = launch(); view.layout(); view.layout();
  assert.equal(view.hideCalls, 1);
  await view.advance(1000); assert.equal(view.animations.length, 0, 'Native splash is still covering the intro.');
  await view.reveal(); assert.equal(view.animations.length, 0, 'Logo/glow have not loaded.');
  await view.load(); const visibleAt = view.time;
  await view.advance(1999); assert.equal(view.completed.length, 0, 'Fast data must still show the whole visible brand moment.');
  await view.advance(1); assert.equal(view.completed.length, 1); assert.ok(view.completed[0] - visibleAt >= 2000);
  await view.advance(5000); assert.equal(view.completed.length, 1);
});

test('slow readiness holds the settled logo until content is allowed, then completes once', async () => {
  const view = launch({ ready: false }); view.layout(); await view.load(); await view.reveal();
  await view.advance(5000); assert.deepEqual(view.completed, []);
  await view.ready(true); await view.advance(1000); assert.equal(view.completed.length, 1);
  await view.ready(true); await view.advance(5000); assert.equal(view.completed.length, 1);
});

test('reduced motion retains an equivalent visible static logo without any animated transforms', async () => {
  const view = launch({ reduced: true }); view.layout(); await view.load(); await view.reveal();
  await view.advance(1999); assert.equal(view.completed.length, 0); assert.equal(view.animations.length, 0);
  await view.advance(1); assert.equal(view.completed.length, 1); assert.equal(view.animations.length, 0);
});

test('failed hide and images fail open, and missing native callbacks have a bounded escape', async () => {
  const failed = launch(); failed.layout(); await failed.load(true); await failed.failHide(); await failed.advance(3000); assert.equal(failed.completed.length, 1);
  const missing = launch(); missing.layout(); await missing.advance(5000); assert.equal(missing.completed.length, 1);
});

test('unmount cancels waiting, entry, settled hold and exit without completing a removed gate', async () => {
  for (const elapsed of [0, 400, 1300, 1800]) {
    const view = launch(); view.layout(); if (elapsed) { await view.load(); await view.reveal(); await view.advance(elapsed); }
    view.unmount(); await view.reveal(); await view.advance(10000);
    assert.equal(view.completed.length, 0, `Unmounted at ${elapsed}ms`); assert.equal(view.timerCount, 0);
  }
});

test('an interrupted exit never signals completion and a later ready transition can finish', async () => {
  const view = launch(); view.layout(); await view.load(); await view.reveal(); await view.advance(1800);
  await view.ready(false); await view.advance(1000); assert.equal(view.completed.length, 0);
  await view.ready(true); await view.advance(1000); assert.equal(view.completed.length, 1);
});
