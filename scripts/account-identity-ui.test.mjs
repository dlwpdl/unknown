import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { nicknameError, normalizeNickname } from '../src/lib/nickname.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join(' ') : String(tree);
const control = (tree, id) => { const node = nodes(tree).find(n => n.props?.analyticsId === id); assert.ok(node, id); return node; };
const button = (tree, label) => { const node = nodes(tree).find(n => n.type === 'button' && text(n).trim() === label); assert.ok(node, label); return node; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const plain = value => JSON.parse(JSON.stringify(value));
const theme = { text: '#111', textSecondary: '#555', line: '#ccc', card: '#fff', accent: '#7050c0', accentInk: '#fff', danger: '#a00' };
const fixedInstant = '2026-10-18T00:30:00Z';
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [fixedInstant])); } static now() { return Date.parse(fixedInstant); } }

function mount(file, exported, props, extra = {}) {
  const state = [], effects = [], pendingEffects = [], feedback = [], importsRead = [];
  let cursor = 0, changed = false, tree, currentProps = props;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { const next = typeof value === 'function' ? value(state[i]) : value; if (!Object.is(state[i], next)) { state[i] = next; changed = true; } }]; },
    useRef(initial) { const i = cursor++; return state[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || deps.some((value, j) => !Object.is(value, effects[i].deps[j]))) pendingEffects.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  const imports = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, value, key) => ({ type, props: value, key }), jsxs: (type, value, key) => ({ type, props: value, key }), Fragment: 'Fragment' },
    'react-native': { View: 'View', TextInput: 'TextInput', StyleSheet: { create: value => value } },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/themed-text': { ThemedText: 'Text' },
    '@/constants/theme': { Colors: { admin: theme }, Spacing: { one: 4, two: 8, three: 12 } },
    '@/hooks/use-language': { useLanguage: () => ({ tr: value => value }) }, '@/hooks/use-theme': { useTheme: () => theme },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) },
    '@/lib/nickname': { nicknameError, normalizeNickname }, ...extra,
  };
  const exports = {}, source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(compiled, { exports, Date: FixedDate, Intl, Error, window: { confirm: () => true }, require: name => { importsRead.push(name); assert.ok(Object.hasOwn(imports, name), 'Unexpected import ' + name); return imports[name]; } });
  function render(next = {}) { currentProps = { ...currentProps, ...next }; cursor = 0; changed = false; return tree = exports[exported](currentProps); }
  async function settle() { for (let i = 0; i < 12; i++) { if (changed) render(); pendingEffects.splice(0).forEach(fn => fn()); await new Promise(setImmediate); if (!changed && !pendingEffects.length) break; } return tree; }
  render();
  return { render, settle, feedback, importsRead, unmount() { effects.forEach(effect => effect?.cleanup?.()); }, get tree() { return tree; } };
}

function nickname(onSave) { return mount('../src/components/nickname-editor.tsx', 'NicknameEditor', { nickname: '원래 이름', onSave }); }
const nicknameInput = tree => { const node = nodes(tree).find(n => n.type === 'TextInput' && n.props.accessibilityLabel === '새 닉네임'); assert.ok(node); return node; };

test('nickname save blocks repeated clicks and keyboard submission and retains the reviewed old name', async () => {
  const pending = deferred(), calls = [], view = nickname((...args) => { calls.push(args); return pending.promise; }); await view.settle();
  control(view.tree, 'profile.nickname.edit').props.onPress(); await view.settle();
  nicknameInput(view.tree).props.onChangeText('  새로운 이름  '); await view.settle();
  view.render({ nickname: '다른 곳에서 바뀐 이름' });
  const save = control(view.tree, 'profile.nickname.save');
  save.props.onPress(); save.props.onPress(); nicknameInput(view.tree).props.onSubmitEditing(); await view.settle();
  assert.deepEqual(calls, [['새로운 이름', '원래 이름']]);
  assert.equal(control(view.tree, 'profile.nickname.save').props.disabled, true);
  assert.equal(control(view.tree, 'profile.nickname.cancel').props.disabled, true);
  assert.equal(nicknameInput(view.tree).props.editable, false);
  pending.resolve(); await view.settle();
  assert.ok(!nodes(view.tree).some(n => n.type === 'TextInput'));
  assert.match(text(view.tree), /닉네임을 변경했어요/); assert.ok(view.feedback.includes('success'));
});

test('nickname conflict keeps the entered draft and original revision; cancel starts a fresh review without writing', async () => {
  const calls = [], view = nickname(async (...args) => { calls.push(args); throw Error('NICKNAME_CHANGED'); }); await view.settle();
  control(view.tree, 'profile.nickname.edit').props.onPress(); await view.settle();
  nicknameInput(view.tree).props.onChangeText('충돌한 새 이름'); await view.settle();
  control(view.tree, 'profile.nickname.save').props.onPress(); await view.settle();
  assert.equal(nicknameInput(view.tree).props.value, '충돌한 새 이름');
  assert.match(text(nodes(view.tree).find(n => n.props?.accessibilityRole === 'alert')), /다른 곳에서 바뀌었어요/);
  assert.equal(control(view.tree, 'profile.nickname.save').props.disabled, false);
  assert.ok(view.feedback.includes('warning')); assert.deepEqual(calls, [['충돌한 새 이름', '원래 이름']]);
  view.render({ nickname: '최신 이름' });
  control(view.tree, 'profile.nickname.cancel').props.onPress(); await view.settle();
  assert.ok(!nodes(view.tree).some(n => n.props?.accessibilityRole === 'alert'));
  control(view.tree, 'profile.nickname.edit').props.onPress(); await view.settle();
  assert.equal(nicknameInput(view.tree).props.value, '최신 이름');
  nicknameInput(view.tree).props.onChangeText('재시도 이름'); await view.settle();
  control(view.tree, 'profile.nickname.save').props.onPress(); await view.settle();
  assert.deepEqual(calls[1], ['재시도 이름', '최신 이름']);
});

test('invalid nickname remains editable without invoking a mutation', async () => {
  const calls = [], view = nickname(async (...args) => calls.push(args)); await view.settle();
  control(view.tree, 'profile.nickname.edit').props.onPress(); await view.settle();
  nicknameInput(view.tree).props.onChangeText('가'); await view.settle();
  control(view.tree, 'profile.nickname.save').props.onPress(); await view.settle();
  assert.deepEqual(calls, []); assert.equal(nicknameInput(view.tree).props.value, '가'); assert.match(text(view.tree), /2~20자/);
});

const account = { id: 'member-a', nickname: '검토한 회원', email: 'reviewed@example.test', account_status: 'active' };
const business = { id: 'business-a', name: '지모코', city_name: '밴쿠버', record_kind: 'business', timezone: 'America/Vancouver', owner_id: null, updated_at: '2026-10-17T22:00:00Z' };
function userBusiness(api = {}) {
  const calls = [], changed = [];
  const service = {
    MERCHANT_DEFAULT_FILTERS: { sort: 'name_asc', city_id: '', status: '', consent: '', record_kind: '', account: '' },
    loadAdminUserBusinesses: async (_client, id) => { calls.push(['linked', id]); return []; },
    loadMerchants: async (_client, ...args) => { calls.push(['search', ...args]); return { merchants: [business] }; },
    loadMerchant: async (_client, ...args) => { calls.push(['reload', ...args]); return { merchant: { ...business, updated_at: '2026-10-18T00:30:00Z' } }; }, ...api,
  };
  const view = mount('../src/components/admin/admin-user-business.tsx', 'AdminUserBusiness', { account, onChanged: () => changed.push(account.id) }, {
    './admin-merchant-connections': { AdminMerchantConnections: 'AdminMerchantConnections' }, '@/lib/admin-merchants': service,
    '@/lib/merchant-connections': { MERCHANT_ACCOUNT_ROLES: { owner: '소유자', operator: '운영 담당자' } }, '@/lib/supabase': { supabase: {} }, './admin-merchants.css': {},
  });
  return { ...view, calls, changed, get tree() { return view.tree; } };
}
const search = tree => { const node = nodes(tree).find(n => n.type === 'form' && n.props.className === 'merchant-search'); assert.ok(node); node.props.onSubmit({ preventDefault() {} }); };
const selectBusiness = tree => { const node = nodes(tree).find(n => n.type === 'button' && text(n).includes('지모코')); assert.ok(node); node.props.onClick(); };
const connection = tree => { const node = nodes(tree).find(n => n.type === 'AdminMerchantConnections'); assert.ok(node); return node; };

test('admin selection requests only businesses, filters source records, and pins the reviewed account', async () => {
  const pending = deferred(); let requests = 0;
  const view = userBusiness({ loadMerchants: async (_client, query, offset, filters) => { requests++; assert.equal(query, '지모코'); assert.equal(offset, 0); assert.equal(filters.record_kind, 'business'); return pending.promise; } }); await view.settle();
  nodes(view.tree).find(n => n.type === 'input').props.onChange({ target: { value: '지모코' } }); await view.settle();
  search(view.tree); search(view.tree); await view.settle(); assert.equal(requests, 1);
  assert.equal(button(view.tree, '검색 중…').props.disabled, true);
  pending.resolve({ merchants: [business, { ...business, id: 'source', name: '대리등록 자료', record_kind: 'source' }, { ...business, id: 'unknown', name: '미분류', record_kind: undefined }] }); await view.settle();
  assert.ok(!text(view.tree).includes('대리등록 자료')); assert.ok(!text(view.tree).includes('미분류'));
  selectBusiness(view.tree); await view.settle();
  const form = connection(view.tree);
  assert.equal(form.props.initialAccount, account); assert.equal(form.props.merchant, business);
  assert.deepEqual(view.calls, [['linked', account.id]]);
});

test('successful connection reload uses the business local date and replaces the reviewed revision', async () => {
  const view = userBusiness(); await view.settle(); search(view.tree); await view.settle(); selectBusiness(view.tree); await view.settle();
  const before = connection(view.tree); before.props.onBusy(true); await view.settle();
  assert.equal(button(view.tree, '다른 비즈니스 선택').props.disabled, true);
  before.props.onBusy(false); before.props.onChanged(); await view.settle();
  assert.deepEqual(view.changed, [account.id]);
  assert.deepEqual(plain(view.calls.find(call => call[0] === 'reload')), ['reload', business.id, '2026-10-01', '2026-10-17']);
  assert.equal(connection(view.tree).props.merchant.updated_at, '2026-10-18T00:30:00Z');
  assert.notEqual(connection(view.tree).key, before.key); assert.equal(connection(view.tree).props.initialAccount, account);
});

test('failed connection reads expose a retry without a duplicate write and retain the pinned account', async () => {
  let reads = 0;
  const view = userBusiness({ loadAdminUserBusinesses: async () => { if (++reads === 1) throw Error('offline'); return [{ ...business, role: 'owner' }]; } }); await view.settle();
  assert.match(text(nodes(view.tree).find(n => n.props?.role === 'alert')), /비즈니스 연결을 확인하지 못했습니다/);
  button(view.tree, '연결 다시 확인').props.onClick(); await view.settle();
  assert.equal(reads, 2); assert.ok(!nodes(view.tree).some(n => n.props?.role === 'alert')); assert.match(text(view.tree), /지모코 · 소유자/); assert.deepEqual(view.changed, []);
  search(view.tree); await view.settle(); selectBusiness(view.tree); await view.settle(); assert.equal(connection(view.tree).props.initialAccount, account);
});

test('uncertain post-save reload clears the stale business and permits a fresh search without writing again', async () => {
  let reloads = 0;
  const view = userBusiness({ loadMerchant: async () => { reloads++; throw Error('offline'); } }); await view.settle(); search(view.tree); await view.settle(); selectBusiness(view.tree); await view.settle();
  connection(view.tree).props.onChanged(); await view.settle();
  assert.equal(reloads, 1); assert.deepEqual(view.changed, [account.id]);
  assert.ok(!nodes(view.tree).some(n => n.type === 'AdminMerchantConnections')); assert.match(text(view.tree), /연결은 변경됐지만 최신/);
  button(view.tree, '연결 다시 확인').props.onClick(); await view.settle();
  search(view.tree); await view.settle(); selectBusiness(view.tree); await view.settle();
  assert.equal(connection(view.tree).props.initialAccount, account); assert.equal(reloads, 1); assert.deepEqual(view.changed, [account.id]);
});

test('native admin business entry renders a React Native notice and imports no DOM connection component', async () => {
  const view = mount('../src/components/admin/admin-user-business.native.tsx', 'AdminUserBusiness', { account, onChanged() {} }); await view.settle();
  assert.match(text(view.tree), /관리자 웹에서 이용/);
  assert.ok(nodes(view.tree).every(n => ['View', 'Text'].includes(n.type)));
  assert.ok(!view.importsRead.some(name => name.endsWith('.css') || name.includes('admin-merchant-connections')));
});

test('late saved-business reload success or failure cannot replace a newer selected business draft', async () => {
  for (const outcome of ['success', 'failure']) {
    const oldReload = deferred(), next = { ...business, id: 'business-b', name: '다음 비즈니스', updated_at: '2026-10-18T00:00:00Z' };
    const view = userBusiness({ loadMerchants: async () => ({ merchants: [business, next] }), loadMerchant: () => oldReload.promise });
    await view.settle(); search(view.tree); await view.settle(); selectBusiness(view.tree); await view.settle();
    connection(view.tree).props.onChanged(); await view.settle();
    button(view.tree, '다른 비즈니스 선택').props.onClick(); await view.settle();
    nodes(view.tree).find(n => n.type === 'button' && text(n).includes(next.name)).props.onClick(); await view.settle();
    const newer = connection(view.tree); newer.props.onDirty(true); await view.settle();
    if (outcome === 'success') oldReload.resolve({ merchant: { ...business, updated_at: '2026-10-18T00:30:00Z' } });
    else oldReload.reject(Error('old request failed'));
    await view.settle();
    assert.equal(connection(view.tree).props.merchant.id, next.id, outcome);
    assert.equal(connection(view.tree).key, newer.key, 'the new connection draft must remain mounted');
    assert.equal(connection(view.tree).props.initialAccount, account);
    assert.ok(!nodes(view.tree).some(n => n.props?.role === 'alert'), 'the old error must not replace the new form');
    assert.deepEqual(view.changed, [account.id]);
  }
});
