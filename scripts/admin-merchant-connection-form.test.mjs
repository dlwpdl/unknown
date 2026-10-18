import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as adminMerchants from '../src/lib/admin-merchants.ts';
import * as merchantSource from '../src/lib/merchant-source.ts';
import * as merchantConnections from '../src/lib/merchant-connections.ts';

const merchants = ['first', 'second'].map((id, i) => ({ id, name: `업체 ${i + 1}`, city_id: 'vancouver', city_name: '밴쿠버', timezone: 'America/Vancouver', industry: '카페', services: '', address: '', contact: `contact${i + 1}@example.test`, status: 'trial', consent: 'pending', consent_note: '', trial_ends_at: null, post_count: i + 1, report_count: 0, updated_at: '2026-10-09T00:00:00Z' }));

function app() {
  const state = [], refs = [], feedback = [], prompts = [];
  let stateIndex = 0, refIndex = 0, allowReplace = false;
  state[5] = { key: `:0:0:0:0:${JSON.stringify(adminMerchants.MERCHANT_DEFAULT_FILTERS)}`, rows: merchants, more: false, owners: { owned: '벤더 회원' } };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-merchants.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, Date, window: { confirm(message) { prompts.push(message); return allowReplace; } }, require(name) {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('.png')) return 'preview-logo';
    if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
    if (name === 'react') return {
      useEffect() {},
      useRef: initial => { const i = refIndex++; return refs[i] ??= { current: initial }; },
      useState: initial => { const i = stateIndex++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
        return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    };
    if (name === 'expo-asset') return { Asset: { fromModule: uri => ({ uri }) } };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) };
    if (name === '@/lib/mock') return { CITIES: [{ id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver', timezone: 'America/Vancouver' }], TAGS: [] };
    if (name === '@/lib/merchant-source') return { ...merchantSource, merchantEventId: () => 'new-merchant' };
    if (name === '@/lib/admin-merchants') return adminMerchants;
    if (name === './admin-ai-connection') return { AdminAiConnection: 'AdminAiConnection' };
    if (name === './admin-table-controls') return { AdminSelect: 'AdminSelect', AdminFilterBar: 'AdminFilterBar', AdminFilterReset: 'AdminFilterReset' };
    if (name === './admin-merchant-connections') return { AdminMerchantConnections: 'AdminMerchantConnections' };
    return {};
  } });
  const render = () => { stateIndex = refIndex = 0; return exports.AdminMerchantsView({ refreshSignal: 0 }); };
  return { render, feedback, prompts, allow() { allowReplace = true; }, detail() {
    const merchant = merchants[0], period = state[7];
    state[8] = { key: `${merchant.id}:${period.start}:${period.end}:0:0`, data: { merchant, posts: [], reports: [], available_posts: [], metrics: { linked_posts: 0, new_posts: 0, displayed_views: 0, first_reads: 0, unique_readers: 0, source_clicks: 0, member_clickers: 0, anonymous_sessions: 0 } } };
  }, refreshMerchant(next) {
    state[5] = { ...state[5], rows: state[5].rows.map(merchant => merchant.id === next.id ? next : merchant) };
  } };
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return [node?.props?.children].flat(Infinity).map(text).join(' ');
}


const merchantButton = (view, name) => nodes(view.render()).find(n => n.type === 'button' && n.props['aria-pressed'] !== undefined && text(n).trim().startsWith(name));
const connectionForm = view => nodes(view.render()).find(n => n.type === 'AdminMerchantConnections');

test('period and directory refresh keep the reviewed connection form mounted with its existing revision', () => {
  const view = app(); merchantButton(view, '업체 1').props.onClick(); view.detail();
  const original = connectionForm(view); original.props.onDirty(true);
  nodes(nodes(view.render()).find(n => n.type === 'form' && n.props.className === 'merchant-period')).find(n => n.type === 'input' && n.props.type === 'date').props.onChange({ target: { value: '2026-10-01' } });
  assert.equal(connectionForm(view)?.key, original.key);
  assert.equal(connectionForm(view)?.props.merchant, original.props.merchant);
  nodes(view.render()).find(n => n.type === 'AdminSelect' && n.props.label === '정렬').props.onChange('name_desc');
  assert.equal(connectionForm(view)?.key, original.key);
  assert.equal(connectionForm(view)?.props.merchant, original.props.merchant);
  nodes(view.render()).find(n => n.type === 'form' && n.props.className === 'merchant-search').props.onSubmit({ preventDefault() {} });
  assert.equal(connectionForm(view)?.key, original.key);
  assert.equal(connectionForm(view)?.props.merchant, original.props.merchant);
  assert.equal(view.prompts.length, 0);
});

test('an unsaved connection blocks business replacement and profile save until discard is confirmed', () => {
  const view = app(); merchantButton(view, '업체 1').props.onClick(); view.detail();
  const original = connectionForm(view); original.props.onDirty(true);
  merchantButton(view, '업체 2').props.onClick();
  assert.equal(view.prompts.length, 1); assert.equal(connectionForm(view)?.key, original.key);
  nodes(view.render()).find(n => n.type === 'form' && n.props.className === 'merchant-section').props.onSubmit({ preventDefault() {} });
  assert.equal(view.prompts.length, 2); assert.equal(connectionForm(view)?.key, original.key);
  view.allow(); merchantButton(view, '업체 2').props.onClick();
  assert.equal(connectionForm(view), undefined);
  assert.ok(nodes(view.render()).some(n => n.type === 'input' && n.props.value === '업체 2'));
});


function reviewedConnection() {
  const account = { id: 'a3300000-0000-4000-8000-000000000001', nickname: '검토한 회원', email: 'reviewed@example.invalid' };
  const merchant = { id: 'a3310000-0000-4000-8000-000000000001', name: '지모코', updated_at: '2026-10-17T22:00:00Z', owner_id: null };
  const admin = 'a3320000-0000-4000-8000-000000000001';
  const state = [], effects = [], queued = [], calls = [], dirty = [];
  let index = 0, changed = false, tree;
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: admin } } } }) }, rpc: async (name, args) => {
    calls.push([name, args]);
    assert.equal(name, 'get_merchant_account_connections', 'a short confirmation must never reach a connection mutation');
    return { data: { merchant_id: merchant.id, updated_at: merchant.updated_at, owner: null, operators: [], invitations: [] }, error: null };
  } };
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], value => { const next = typeof value === 'function' ? value(state[slot]) : value; if (!Object.is(next, state[slot])) { state[slot] = next; changed = true; } }]; },
    useRef(initial) { const slot = index++; return state[slot] ??= { current: initial }; },
    useEffect(fn, deps) { const slot = index++; if (!effects[slot] || deps.some((value, i) => !Object.is(value, effects[slot].deps[i]))) queued.push(() => { effects[slot]?.cleanup?.(); effects[slot] = { deps, cleanup: fn() }; }); },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }), Fragment: 'Fragment' },
    '@/lib/auth': { useAuth: () => ({ me: { id: admin }, isAdmin: true }) }, '@/lib/admin-merchants': adminMerchants,
    '@/lib/admin-user-data': { searchAdminUsers: async () => { throw Error('pinned account cannot be replaced by a search'); } },
    '@/lib/merchant-connections': merchantConnections, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/supabase': { supabase: client }, '@/lib/mock': { CITIES: [] },
  };
  const exports = {}, source = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-merchant-connections.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: name => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; }, window: { confirm: () => true }, Error });
  function render() { index = 0; changed = false; return tree = exports.AdminMerchantConnections({ merchant, initialAccount: account, busy: false, onChanged() {}, onDirty: value => dirty.push(value) }); }
  async function settle() { for (let i = 0; i < 12; i++) { if (changed) render(); queued.splice(0).forEach(fn => fn()); await new Promise(setImmediate); if (!changed && !queued.length) break; } return tree; }
  render();
  return { calls, dirty, settle, get tree() { return tree; } };
}
const noteField = tree => { const node = nodes(tree).find(n => n.type === 'textarea'); assert.ok(node); return node; };
const verification = tree => { const node = nodes(tree).find(n => n.type === 'input' && n.props.type === 'checkbox'); assert.ok(node); return node; };
const connectButton = tree => { const node = nodes(tree).find(n => n.type === 'button' && n.props.type === 'submit'); assert.ok(node); return node; };
const confirmationStatus = tree => { const node = nodes(tree).find(n => n.props?.role === 'status' && text(n).includes('확인 기록')); assert.ok(node); return text(node); };

test('five-character confirmation explains its minimum and retains the checked draft until six characters', async () => {
  const view = reviewedConnection(); await view.settle();
  assert.match(text(view.tree), /6\s*자 이상/);
  noteField(view.tree).props.onChange({ target: { value: '  소유자확인  ' } }); await view.settle();
  verification(view.tree).props.onChange({ target: { checked: true } }); await view.settle();
  assert.equal(noteField(view.tree).props.value, '  소유자확인  ');
  assert.equal(verification(view.tree).props.checked, true); assert.equal(connectButton(view.tree).props.disabled, true);
  assert.match(confirmationStatus(view.tree), /확인 기록\s*5\s*자.*6자 이상/);
  nodes(view.tree).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await view.settle();
  assert.equal(view.calls.filter(([name]) => name === 'connect_admin_merchant_account').length, 0);
  assert.equal(view.calls.length, 1, 'only the initial protected connection read is allowed');
  noteField(view.tree).props.onChange({ target: { value: '소유자확인함' } }); await view.settle();
  verification(view.tree).props.onChange({ target: { checked: true } }); await view.settle();
  assert.equal(noteField(view.tree).props.value, '소유자확인함'); assert.equal(verification(view.tree).props.checked, true);
  assert.match(confirmationStatus(view.tree), /확인 기록\s*6\s*자.*입력 조건을 충족/); assert.equal(connectButton(view.tree).props.disabled, false);
});

test('confirmation counter and helper count Unicode database characters instead of UTF-16 units', async () => {
  const view = reviewedConnection(); await view.settle();
  noteField(view.tree).props.onChange({ target: { value: '가😀나다라' } }); await view.settle();
  verification(view.tree).props.onChange({ target: { checked: true } }); await view.settle();
  assert.match(confirmationStatus(view.tree), /확인 기록\s*5\s*자.*6자 이상/); assert.equal(connectButton(view.tree).props.disabled, true);
  noteField(view.tree).props.onChange({ target: { value: '가😀나다라마' } }); await view.settle();
  verification(view.tree).props.onChange({ target: { checked: true } }); await view.settle();
  assert.match(confirmationStatus(view.tree), /확인 기록\s*6\s*자.*입력 조건을 충족/); assert.equal(connectButton(view.tree).props.disabled, false);
  let mutations = 0;
  await assert.rejects(adminMerchants.connectAdminMerchantAccount({ rpc: async () => { mutations++; return { data: 'business', error: null }; } },
    { id: 'business', updated_at: '2026-10-17T22:00:00Z' }, { id: 'member', nickname: '검토한 회원', email: null },
    { role: 'owner', method: 'direct', verified: true, note: '가😀나다라' }), /MERCHANT_CONNECTION_CONFIRMATION_REQUIRED/);
  assert.equal(mutations, 0, 'Unicode-short notes are rejected before the RPC');
});
