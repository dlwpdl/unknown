import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const id = '11111111-1111-4111-8111-111111111111';
const rawPlace = { kind: 'place', id: 'osm:node:42', cityId: 'vancouver' };
const resolved = { kind: 'merchant', id, cityId: 'vancouver' };
const state = (saved = false, target = resolved, available = true) => ({ target, saved, available, savedAt: saved ? '2026-10-23T12:00:00Z' : null, folderIds: [] });
const tick = () => new Promise(setImmediate);
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];

function mount({ load = async () => state(), save = async (_client, _target, value) => state(value), target = rawPlace } = {}) {
  const slots = [], cleanups = [], reads = [], writes = [], feedback = [], logins = [];
  let index = 0, effects = [], focused = true, hidden = () => false, visible = true;
  const auth = { isAuthed: true, isAuthLoading: false, me: { id: 'viewer' }, promptLogin: text => logins.push(text) };
  const effect = (fn, deps) => {
    const slot = index++;
    if (slots[slot] && deps.every((value, i) => Object.is(value, slots[slot][i]))) return;
    slots[slot] = deps;
    effects.push(() => { cleanups[slot]?.(); cleanups[slot] = fn(); });
  };
  const react = {
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useRef(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useEffect: effect, useLayoutEffect: effect,
  };
  const modules = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'expo-router': { useIsFocused: () => focused }, 'expo-symbols': { SymbolView: 'Symbol' },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/gling-loader': { GlingLoader: 'Loader' },
    '@/constants/design-system': { ControlStyles: { icon: {} }, IconSize: { toolbar: 21 }, controlPresentation: (_theme, props) => ({ container: { opacity: props.busy ? 0.45 : 1 } }) },
    '@/hooks/use-language': { useLanguage: () => ({ language: 'ko' }) }, '@/hooks/use-theme': { useTheme: () => ({ accent: '#cbb9ff' }) },
    '@/hooks/use-content-visibility': { useContentVisibility: () => hidden }, '@/lib/auth': { useAuth: () => auth },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) }, '@/lib/supabase': { supabase: {} },
    '@/lib/saved-items': {
      loadSavedItemState: (...args) => { reads.push(args[1]); return load(...args); },
      setSavedItem: (...args) => { writes.push([args[1], args[2]]); return save(...args); },
    },
  };
  const exported = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/components/saved-entry.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports: exported, require: name => modules[name] ?? {} });
  let entry;
  return {
    auth, reads, writes, feedback, logins,
    render() { index = 0; entry = exported.useSavedEntry(target, visible); while (effects.length) effects.shift()(); return entry; },
    button() { return exported.SavedEntryButton({ entry, kind: target.kind === 'user' ? 'user' : 'place', analyticsId: target.kind === 'user' ? 'save.user' : 'save.place' }); },
    target(value) { target = value; }, focus(value) { focused = value; }, visibility() { hidden = () => true; }, visible(value) { visible = value; },
    unmount() { cleanups.forEach(fn => fn?.()); },
  };
}

test('canonical saved state renders one bookmark and writes the raw place reference once', async () => {
  let finish;
  const view = mount({ save: (_client, _target, value) => new Promise(resolve => { finish = () => resolve(state(value)); }) });
  view.render(); await tick(); let entry = view.render();
  assert.equal(entry.state.target.kind, 'merchant');
  const button = nodes(view.button()).find(node => node.type === 'Pressable');
  assert.equal(button.props.analyticsId, 'save.place');
  button.props.onPress(); button.props.onPress();
  assert.equal(view.writes.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(view.writes[0])), [rawPlace, true]);
  assert.equal(view.render().state.saved, false);
  finish(); await tick(); entry = view.render(); assert.equal(entry.state.saved, true); assert.deepEqual(view.feedback, ['selection', 'success']); view.unmount();
});

test('guest save prompts login while auth loading and private reads stay blocked', () => {
  const view = mount(); view.auth.isAuthed = false; let entry = view.render(); entry.onPress();
  assert.equal(view.reads.length, 0); assert.equal(view.writes.length, 0); assert.equal(view.logins.length, 1);
  view.auth.isAuthLoading = true; entry = view.render(); entry.onPress(); assert.equal(view.logins.length, 1); view.unmount();
});

test('read failure stays unknown and retries; rejected writes keep the last verified state', async () => {
  let fail = true;
  const view = mount({ load: async () => { if (fail) throw Error('private diagnostic'); return state(true); }, save: async () => { throw Error('private mutation'); } });
  view.render(); await tick(); let entry = view.render(); assert.equal(entry.state, null); assert.ok(entry.error); assert.doesNotMatch(entry.error, /private/);
  assert.match(nodes(view.button()).find(node => node.type === 'Pressable').props.accessibilityLabel, /다시 확인/);
  fail = false; entry.onPress(); view.render(); await tick(); entry = view.render(); assert.equal(entry.state.saved, true);
  entry.onPress(); await tick(); entry = view.render(); assert.equal(entry.state.saved, true); assert.ok(entry.error); assert.equal(view.feedback.includes('success'), false); view.unmount();
});

for (const boundary of ['account', 'target', 'visibility', 'focus']) test(`late saved reads cannot cross the ${boundary} boundary`, async () => {
  const pending = [];
  const view = mount({ load: () => new Promise(resolve => pending.push(resolve)) });
  view.render();
  if (boundary === 'account') view.auth.me.id = 'another-viewer';
  if (boundary === 'target') view.target({ kind: 'user', id });
  if (boundary === 'visibility') view.visibility();
  if (boundary === 'focus') view.focus(false);
  view.render(); pending[0](state(true)); await tick();
  assert.notEqual(view.render().state?.saved, true);
  assert.equal(view.writes.length, 0); view.unmount();
});

for (const boundary of ['account', 'target', 'visibility', 'focus', 'unavailable-profile', 'unmount']) test(`late save cannot cross the ${boundary} boundary`, async () => {
  let finish;
  const view = mount({ save: () => new Promise(resolve => { finish = resolve; }) });
  view.render(); await tick(); const old = view.render(); old.onPress();
  if (boundary === 'account') view.auth.me.id = 'another-viewer';
  if (boundary === 'target') view.target({ kind: 'user', id });
  if (boundary === 'visibility') view.visibility();
  if (boundary === 'focus') view.focus(false);
  if (boundary === 'unavailable-profile') view.visible(false);
  if (boundary === 'unmount') view.unmount(); else view.render();
  finish(state(true)); await tick();
  assert.equal(view.feedback.includes('success'), false);
  if (boundary !== 'unmount') assert.notEqual(view.render().state?.saved, true);
  old.onPress(); assert.equal(view.writes.length, 1); view.unmount();
});

test('a saved unavailable target can be removed while an unavailable unsaved target cannot be saved', async () => {
  const view = mount({ load: async () => state(true, resolved, false), save: async (_client, _target, value) => state(value, resolved, false) });
  view.render(); await tick(); view.render().onPress(); await tick(); assert.equal(view.render().state.saved, false); assert.equal(view.button(), null);
  view.render().onPress(); assert.equal(view.writes.length, 1); view.unmount();
});

test('personal saving invokes only saved-state methods for a known visible profile', async () => {
  const target = { kind: 'user', id };
  const view = mount({ target, load: async () => state(false, target), save: async (_client, _target, value) => state(value, target) });
  view.visible(false); view.render(); assert.equal(view.reads.length, 0);
  view.visible(true); view.render(); await tick(); view.render().onPress(); await tick(); assert.equal(view.render().state.saved, true); assert.deepEqual(JSON.parse(JSON.stringify(view.writes[0][0])), target); view.unmount();
});
