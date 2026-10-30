import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../src/components/merchant-access-gate.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const visible = tree => !tree || typeof tree !== 'object' || [tree.props?.style].flat(Infinity).some(style => style?.display === 'none') ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(visible)];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function mount(initialProps = {}) {
  const state = [], effects = [], pending = [], exports = {};
  let cursor = 0, changed = true, tree, foreground;
  const auth = { me: { id: 'owner' }, isAuthed: true }, api = { load: async () => true, business: async () => ({ enabled: true, merchants: [] }) };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { const next = typeof value === 'function' ? value(state[i]) : value; if (!Object.is(next, state[i])) { state[i] = next; changed = true; } }]; },
    useRef(initial) { const i = cursor++; return state[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || deps.some((value, j) => !Object.is(value, effects[i].deps[j]))) pending.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }), Fragment: 'Fragment' },
    'react-native': { View: 'View', Platform: { OS: 'web' }, AppState: { addEventListener: (_event, fn) => { foreground = fn; return { remove() {} }; } } },
    '@/hooks/use-language': { useLanguage: () => ({ tr: value => value }) }, '@/lib/auth': { useAuth: () => auth },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/merchant-workspace': { getMyMerchantAccess: () => api.load(), getMyBusinessWorkspaceAccess: () => api.business() }, '@/lib/supabase': { supabase: {} }, '@/lib/legal-documents': { CONTACT_EMAIL: 'gling@ej-entertainment.com' },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/themed-text': { ThemedText: 'Text' },
  };
  vm.runInNewContext(compiled, { exports, require: name => { assert.ok(imports[name], name); return imports[name]; }, Error });
  let props = { children: { type: 'PrivateEditor', props: { children: 'unsaved' } }, refreshSignal: 0, ...initialProps };
  function render(next = {}) { props = { ...props, ...next }; cursor = 0; changed = false; return tree = exports.MerchantAccessGate(props); }
  async function settle() { for (let i = 0; i < 10; i++) { if (changed) render(); pending.splice(0).forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); if (!changed && !pending.length) break; } return tree; }
  render();
  return { api, auth, render, settle, foreground: () => foreground('active'), retry: () => { nodes(tree).find(n => n.props?.analyticsId === 'merchant.access.retry').props.onPress(); return settle(); }, get tree() { return tree; } };
}

test('gate keeps same-account children mounted and hidden on transient errors and retry', async () => {
  const screen = mount(); await screen.settle(); assert.ok(visible(screen.tree).some(n => n.type === 'PrivateEditor'));
  screen.api.load = async () => { throw Error('offline'); }; screen.render({ refreshSignal: 1 }); await screen.settle();
  assert.ok(nodes(screen.tree).some(n => n.type === 'PrivateEditor')); assert.ok(!visible(screen.tree).some(n => n.type === 'PrivateEditor'));
  const pending = deferred(); screen.api.load = () => pending.promise; await screen.retry();
  assert.ok(nodes(screen.tree).some(n => n.type === 'PrivateEditor')); assert.ok(!visible(screen.tree).some(n => n.type === 'PrivateEditor'));
  pending.resolve(true); await screen.settle(); assert.ok(visible(screen.tree).some(n => n.type === 'PrivateEditor'));
});

test('confirmed revoke, auth loss and account change remove the previous private subtree', async () => {
  for (const loss of ['revoke', 'auth', 'account', 'AUTH_REQUIRED', 'ACCOUNT_LOCKED', 'MERCHANT_ACCOUNT_REQUIRED', 'ADMIN_REQUIRED']) {
    const screen = mount(); await screen.settle();
    if (loss === 'auth') screen.auth.isAuthed = false;
    else if (loss === 'account') screen.auth.me = { id: 'other-owner' };
    else screen.api.load = async () => { if (loss === 'revoke') return false; throw Error(loss); };
    screen.render({ refreshSignal: 1 });
    if (loss === 'account') assert.ok(!nodes(screen.tree).some(n => n.type === 'PrivateEditor'), 'old account hidden before effects');
    else { await screen.settle(); assert.ok(!nodes(screen.tree).some(n => n.type === 'PrivateEditor'), loss); }
  }
});

test('foreground checks fail closed and an older success cannot replace the latest revoke', async () => {
  const screen = mount(); await screen.settle();
  const older = deferred(), latest = deferred(); let count = 0;
  screen.api.load = () => ++count === 1 ? older.promise : latest.promise;
  screen.foreground(); await screen.settle(); assert.ok(!visible(screen.tree).some(n => n.type === 'PrivateEditor'));
  screen.foreground(); latest.resolve(false); await screen.settle(); older.resolve(true); await screen.settle();
  assert.ok(!nodes(screen.tree).some(n => n.type === 'PrivateEditor'));
});

test('business mode uses business approval without invoking the admin access path', async () => {
  const screen = mount({ businessOnly: true });
  screen.api.load = async () => { throw Error('ADMIN_REQUIRED'); };
  await screen.settle();
  assert.ok(visible(screen.tree).some(n => n.type === 'PrivateEditor'));
});

test('admin access cannot replace revoked business approval', async () => {
  const screen = mount({ businessOnly: true }); screen.api.business = async () => ({ enabled: false, merchants: [] });
  await screen.settle(); assert.ok(!nodes(screen.tree).some(n => n.type === 'PrivateEditor'));
});

test('switching from admin access to business mode hides the previous subtree before revalidation', async () => {
  const screen = mount(); await screen.settle();
  const waiting = deferred(); screen.api.business = () => waiting.promise;
  screen.render({ businessOnly: true });
  assert.ok(!nodes(screen.tree).some(n => n.type === 'PrivateEditor'));
  await screen.settle(); waiting.resolve({ enabled: false, merchants: [] }); await screen.settle();
  assert.ok(!nodes(screen.tree).some(n => n.type === 'PrivateEditor'));
});
