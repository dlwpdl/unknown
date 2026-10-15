import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as userData from '../src/lib/admin-user-data.ts';
import { isCompactAdminWidth } from '../src/lib/admin-layout.ts';

function view(width, directory) {
  const state = [], cleanups = [], calls = [], users = [];
  let index = 0, ipLookups = 0;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
    useRef(initial) { const slot = index++; if (!(slot in state)) state[slot] = { current: initial }; return state[slot]; },
    useEffect(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot][i])) { cleanups[slot]?.(); state[slot] = deps; cleanups[slot] = fn(); } },
    useMemo(fn) { return fn(); },
  };
  const exports = {};
  const imports = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { Pressable: 'Pressable', View: 'View', StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width }) },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/constants/theme': { Colors: { admin: {} }, Spacing: {} },
    '@/lib/admin-user-data': userData, '@/lib/admin-layout': { isCompactAdminWidth },
    '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버' }] }, '@/lib/admin-labels': { shortId: id => id.slice(0, 8) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/ip-geo': { lookupIpGeo: async () => { ipLookups++; return null; } },
    '@/lib/supabase': { supabase: { async rpc(name, args) { calls.push({ name, args }); return { data: directory, error: null }; } } },
    './admin-table-controls': Object.fromEntries(['AdminFilterBar', 'AdminFilterReset', 'AdminMultiFilter', 'AdminSearch', 'AdminSelect', 'AdminTableSummary'].map(name => [name, name])),
  };
  const source = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-user-directory.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? {}, Date, Intl });
  const props = { refreshData: {}, onUser: id => users.push(id) };
  return { render() { index = 0; return exports.AdminUserDirectoryPanel(props); }, calls, users, get ipLookups() { return ipLookups; } };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const memberId = 'bb9bf916-6e4e-48dc-aec7-a1821cc2bc3d';
const directory = { total: 1, viewer: { id: '76f7bb6c-2e1b-4692-a794-dc5ab1e0dfe4', email: null, role: 'admin' }, rows: [{
  id: memberId, nickname: '동네 이웃', city_id: 'vancouver', neighborhood: '다운타운', bio: null, verification_level: 1,
  account_status: 'active', account_status_note: null, deleted_at: null, created_at: '2026-10-10T10:00:00Z',
  email: 'neighbor@example.test', login_name: 'neighbor@example.test', email_confirmed_at: '2026-10-10T10:00:00Z',
  full_name: '테스트 이웃', date_of_birth: '1998-03-05', age: 28, personal_info_updated_at: null, gender: 'female',
  session_ip: '192.0.2.33', session_created_at: '2026-10-13T10:00:00Z', session_updated_at: '2026-10-14T10:00:00Z',
  last_sign_in_at: '2026-10-14T10:00:00Z', auth_role: 'authenticated', providers: ['google'], account_type: 'member',
}] };

for (const width of [1200, 390]) test(`member list at ${width}px omits technical and personal detail while opening the exact member`, async () => {
  const screen = view(width, directory);
  screen.render(); await new Promise(setImmediate);
  const tree = screen.render();
  const visible = text(tree);
  for (const value of [memberId, memberId.slice(0, 8), directory.viewer.id, '192.0.2.33', 'neighbor@example.test', '1998-03-05']) assert.equal(visible.includes(value), false, `${value} belongs in member detail`);
  assert.match(visible, /동네 이웃/); assert.match(visible, /밴쿠버/); assert.match(visible, /정상/); assert.match(visible, /실제 가입자/);
  const button = nodes(tree).find(node => node.type === 'button' && node.props?.['aria-label'] === '동네 이웃, 상세 활동 보기');
  assert.ok(button);
  assert.equal(button.props.title, undefined, 'the hover tooltip does not expose the member ID');
  button.props.onClick();
  assert.deepEqual(screen.users, [memberId]);
  await new Promise(setImmediate);
  assert.equal(screen.ipLookups, 0, 'listing members does not issue unused geolocation lookups');
});

test('member ID search still reaches the existing audited search RPC with the selected filters', async () => {
  const screen = view(1200, directory);
  screen.render(); await new Promise(setImmediate);
  let tree = screen.render();
  nodes(tree).find(node => node.type === 'AdminSearch').props.onChange(` ${memberId} `);
  tree = screen.render();
  nodes(tree).find(node => node.props?.label === '로그인 방식').props.onChange(['google']);
  tree = screen.render();
  nodes(tree).find(node => node.type === 'AdminSearch').props.onSubmit();
  screen.render(); await new Promise(setImmediate);
  const request = screen.calls.at(-1);
  assert.equal(request.name, 'search_admin_users');
  assert.equal(request.args.p_query, memberId);
  assert.equal(request.args.p_offset, 0);
  assert.deepEqual(Array.from(request.args.p_filters.providers), ['google']);
});
