import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { calculateMerchantCost, MERCHANT_CHANNELS } from '../src/lib/merchant-workspace.ts';

const source = readFileSync(new URL('../src/components/merchant-workspace.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source + '\nexports.MerchantTools = MerchantTools; exports.MerchantWorkspaceContent = MerchantWorkspaceContent; exports.Action = Action;', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const merchant = (id = 'merchant-a') => ({ id, name: id === 'merchant-a' ? '테스트 가게' : '두 번째 가게', city_name: '밴쿠버', city_id: 'vancouver', owner_id: 'owner', owner_verified_at: '2026-10-17', plan: 'basic' });
const fixture = (fullAccess = true) => ({ merchant: merchant(), can_manage_business: fullAccess, items: [], drafts: [], movements: [], posts: [], metrics: null, reports: [] });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const visibleNodes = tree => !tree || typeof tree !== 'object' || [tree.props?.style].flat(Infinity).some(style => style?.display === 'none') ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(visibleNodes)];
const find = (tree, label) => visibleNodes(tree).find(n => [label, label.replaceAll('업체', '비즈니스')].some(value => n.props?.label === value || n.props?.title === value));

// Runs the original component with dependency-aware hooks, including effect cleanup.
function mount(name = 'MerchantTools', options = {}) {
  const state = [], pending = [], effects = [], refs = [], exports = {}, confirmations = [], feedback = [];
  let cursor = 0, changed = true, tree, serial = 0;
  const auth = { me: { id: 'owner' }, isAuthed: true };
  const api = { workspace: async () => fixture(), merchants: async () => [merchant()], ...options };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { const next = typeof value === 'function' ? value(state[i]) : value; if (!Object.is(next, state[i])) { state[i] = next; changed = true; } }]; },
    useRef(initial) { const i = cursor++; return refs[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || deps.some((v, j) => !Object.is(v, effects[i].deps[j]))) { pending.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); } },
  };
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }), Fragment: 'Fragment' },
    'react-native': { View: 'View', TextInput: 'TextInput', Platform: { OS: 'web' }, StyleSheet: { create: v => v }, Alert: {} },
    '@react-native-async-storage/async-storage': { default: { getItem: async () => null } },
    '@/hooks/use-language': { useLanguage: () => ({ tr: v => v, locale: 'ko' }) }, '@/i18n': { tr: v => v },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/lib/auth': { useAuth: () => auth },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/merchant-source': { merchantEventId: () => `draft-${++serial}` },
    '@/lib/merchant-workspace': { calculateMerchantCost, MERCHANT_CHANNELS, loadMerchantWorkspace: (...args) => api.workspace(...args), loadMyMerchants: (...args) => api.merchants(...args) },
    '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버', state: 'open' }], TAGS: [] }, '@/lib/image-upload': { MAX_POST_IMAGES: 20 },
    '@/lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: auth.me } } }) }, storage: { from: () => ({ createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: `signed:${path}` })) }) }) } } },
    '@/components/analytics-controls': { Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch' },
    'expo-symbols': { SymbolView: 'SymbolView' },
  };
  const require = path => imports[path] ?? new Proxy({}, { get: (_, key) => key === '__esModule' ? true : String(key) });
  vm.runInNewContext(compiled, { exports, require, Error, Map, Promise, console, window: { confirm: message => { confirmations.push(message); return api.confirm ?? true; } } });
  let props = name === 'MerchantTools' ? { id: 'merchant-a', refreshSignal: 0, onDirty: () => {}, ...options.props } : { ...options.props };
  function render(next = {}) { props = { ...props, ...next }; cursor = 0; changed = false; tree = exports[name](props); return tree; }
  async function settle() {
    for (let i = 0; i < 12; i++) { if (changed) render(); pending.splice(0).forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); if (!changed && !pending.length) break; }
    return tree;
  }
  async function press(label) { const control = find(tree, label); assert.ok(control, `missing control: ${label}`); assert.ok(!control.props.disabled, `disabled: ${label}`); await control.props.onPress(); return settle(); }
  function edit(label, value) { const field = find(tree, label); assert.ok(field, `missing field: ${label}`); field.props.onChange(value); }
  render();
  return { render, settle, press, edit, api, auth, confirmations, feedback, get tree() { return tree; } };
}

async function composer(screen) {
  await screen.settle();
  if (find(screen.tree, '홍보글 작성')) await screen.press('홍보글 작성');
  else { const drafts = find(screen.tree, '홍보글'); assert.ok(drafts); await drafts.props.onPress(); await screen.settle(); }
  await screen.press('직접 작성할게요');
}

test('temporary workspace failures preserve unsaved text, photos and dirty state while hiding stale data', async () => {
  const dirty = [], screen = mount(); screen.render({ onDirty: v => dirty.push(v) });
  await composer(screen); screen.edit('제목', '미저장 제목'); await screen.settle();
  nodes(screen.tree).find(n => n.type === 'PostPhotoEditor').props.onChange([{ uri: 'local:unsaved-photo' }]); await screen.settle();
  screen.api.workspace = async () => { throw Error('Failed to fetch'); };
  screen.render({ refreshSignal: 1 }); await screen.settle();
  assert.ok(!find(screen.tree, '제목'), 'unverified workspace is not rendered');
  screen.api.workspace = async () => fixture(); await screen.press('다시 불러오기');
  assert.equal(find(screen.tree, '제목').props.value, '미저장 제목');
  assert.equal(nodes(screen.tree).find(n => n.type === 'PostPhotoEditor').props.images[0].uri, 'local:unsaved-photo');
  assert.equal(dirty.at(-1), true);
});

test('actual access loss clears private editor state before a later successful read', async () => {
  for (const reason of ['MERCHANT_ACCESS_REQUIRED', 'MERCHANT_ACCOUNT_REQUIRED', 'AUTH_REQUIRED', 'ACCOUNT_LOCKED', 'ACCOUNT_CHANGED', 'ADMIN_REQUIRED']) {
    const dirty = [], screen = mount(); screen.render({ onDirty: v => dirty.push(v) }); await composer(screen);
    screen.edit('제목', 'private'); await screen.settle();
    screen.api.workspace = async () => { throw Error(reason); }; screen.render({ refreshSignal: 1 }); await screen.settle();
    assert.ok(!find(screen.tree, '제목'));
    screen.api.workspace = async () => fixture(); await screen.press('다시 불러오기');
    if (find(screen.tree, '홍보글 작성')) await screen.press('홍보글 작성');
    if (find(screen.tree, '직접 작성할게요')) await screen.press('직접 작성할게요');
    assert.equal(find(screen.tree, '제목').props.value, '', reason); assert.equal(dirty.at(-1), false, reason);
  }
});

test('choosing the same merchant preserves parent dirty state and the next different choice still warns', async () => {
  const screen = mount('MerchantWorkspaceContent', { merchants: async () => [merchant(), merchant('merchant-b')] }); await screen.settle();
  await screen.press('테스트 가게');
  let tools = nodes(screen.tree).find(n => n.type?.name === 'MerchantTools'); assert.ok(tools);
  tools.props.onDirty(true); await screen.settle();
  const choose = nodes(screen.tree).find(n => n.type?.name === 'MerchantTools')?.props.onChoose; if (choose) { choose(); await screen.settle(); }
  await screen.press('테스트 가게');
  assert.equal(screen.confirmations.length, 0, 'same choice must not ask to discard');
  if (choose) { choose(); await screen.settle(); }
  screen.api.confirm = false; await screen.press('두 번째 가게');
  assert.equal(screen.confirmations.length, 1); tools = nodes(screen.tree).find(n => n.type?.name === 'MerchantTools');
  assert.equal(tools.props.id, 'merchant-a');
});

test('sole merchant opens overview, and registration can return to the merchant list', async () => {
  const screen = mount('MerchantWorkspaceContent'); await screen.settle();
  assert.equal(nodes(screen.tree).find(n => n.type?.name === 'MerchantTools')?.props.id, 'merchant-a');
  const choose = nodes(screen.tree).find(n => n.type?.name === 'MerchantTools')?.props.onChoose; if (choose) { choose(); await screen.settle(); }
  await screen.press('업체 등록'); await screen.press('업체 등록 취소');
  assert.ok(find(screen.tree, '테스트 가게'));
});

test('overview exposes every authorized tool, separates draft list/composer, and resumes dirty editing', async () => {
  const screen = mount(); await screen.settle();
  assert.ok(find(screen.tree, '홍보글 작성')); assert.ok(!find(screen.tree, '직접 작성할게요'));
  for (const title of ['글·사진', '프로필', '이용 후기', '홍보글 관리', '카페 연결', '원가 계산', '재고', '성과·멤버십', '계정 관리']) assert.ok(find(screen.tree, title), title);
  await composer(screen); screen.edit('제목', '돌아와도 남는 제목'); await screen.settle();
  await screen.press('업체 관리'); await screen.press('홍보글 관리');
  assert.ok(!find(screen.tree, '제목'), 'list does not show composer');
  await screen.press('작성 중인 초안 이어쓰기'); assert.equal(find(screen.tree, '제목').props.value, '돌아와도 남는 제목');
  await screen.press('업체 관리'); await screen.press('작성 중인 초안 이어쓰기'); assert.equal(find(screen.tree, '제목').props.value, '돌아와도 남는 제목');
  assert.equal(screen.confirmations.length, 0, 'navigation does not discard drafts');
});

test('operator overview keeps private business tools unavailable and OAuth initial channels remains supported', async () => {
  const screen = mount('MerchantTools', { workspace: async () => fixture(false) }); await screen.settle();
  assert.ok(find(screen.tree, '홍보글 작성'));
  for (const title of ['이용 후기', '카페 연결', '원가 계산', '재고', '성과·멤버십', '계정 관리']) assert.ok(!find(screen.tree, title), title);
  const callback = mount('MerchantTools', { props: { initialTab: 'channels' } }); await callback.settle();
  assert.ok(nodes(callback.tree).some(n => n.type === 'MerchantNaverCafe'));
});

test('transient merchant-list failures keep the same mounted editor but block stale workspace output', async () => {
  const screen = mount('MerchantWorkspaceContent'); await screen.settle();
  if (!nodes(screen.tree).some(n => n.type?.name === 'MerchantTools')) await screen.press('테스트 가게');
  const previous = nodes(screen.tree).find(n => n.type?.name === 'MerchantTools');
  screen.api.merchants = async () => { throw Error('offline'); }; screen.render({ refreshSignal: 1 }); await screen.settle();
  const blocked = nodes(screen.tree).find(n => n.type?.name === 'MerchantTools');
  assert.equal(blocked?.key, previous.key, 'editor remains mounted with the same identity'); assert.equal(blocked?.props.accessChecking, true);
  screen.api.merchants = async () => [merchant()]; await screen.press('다시 불러오기');
  assert.equal(nodes(screen.tree).find(n => n.type?.name === 'MerchantTools')?.props.accessChecking, false);
});


test('workspace revalidation retains hidden nested profile and dirty reply editors until access is revoked', async () => {
  const screen = mount(); await screen.settle(); await screen.press('이용 후기');
  const inbox = nodes(screen.tree).find(n => n.type === 'MerchantReviewInbox'); inbox.props.onDirty(true); await screen.settle();
  screen.api.workspace = async () => { throw Error('offline'); }; screen.render({ refreshSignal: 1 }); await screen.settle();
  assert.ok(nodes(screen.tree).some(n => n.type === 'MerchantProfileEditor'));
  assert.ok(nodes(screen.tree).some(n => n.type === 'MerchantReviewInbox'));
  assert.ok(!visibleNodes(screen.tree).some(n => ['MerchantProfileEditor', 'MerchantReviewInbox'].includes(n.type)));
  screen.api.workspace = async () => { throw Error('MERCHANT_ACCESS_REQUIRED'); }; await screen.press('다시 불러오기');
  assert.ok(!nodes(screen.tree).some(n => ['MerchantProfileEditor', 'MerchantReviewInbox'].includes(n.type)));
});
