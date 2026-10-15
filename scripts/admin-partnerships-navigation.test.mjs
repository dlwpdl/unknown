import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as admin from '../src/lib/admin.ts';

function app(section) {
  const state = [], effects = [], calls = [];
  let cursor = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }]; },
    useRef: value => ({ current: value }), useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn),
  };
  const exported = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-screen.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: exported, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { View: 'View', Platform: { OS: 'web' }, StyleSheet: { create: value => value } };
    if (name === 'expo-router') return { useLocalSearchParams: () => ({ section }) };
    if (name === '@/lib/admin') return admin;
    if (name === '@/lib/auth') return { useAuth: () => ({ isAuthed: true, isAdmin: true, isAuthLoading: false, me: { id: 'admin' } }) };
    if (name === '@/lib/admin-data') return { loadAdminDashboard: async () => { calls.push('dashboard'); return {}; } };
    if (name === '@/constants/theme') return { Colors: { admin: {} }, Spacing: {} };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() {} }) };
    if (name === '@/components/admin/admin-shell') return { AdminShell: 'AdminShell' };
    if (name === '@/components/admin/admin-partnerships') return { AdminPartnershipsView: 'AdminPartnershipsView' };
    return {};
  }, window: { confirm: () => false, addEventListener() {}, removeEventListener() {} } });
  return { calls, render() { cursor = 0; return exported.AdminScreen(); }, effects };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];

test('businesses and creators have separate navigation while the existing merchant URL remains stable', () => {
  assert.equal(admin.initialAdminSection('merchants'), 'merchants');
  assert.equal(admin.ADMIN_SECTIONS.find(row => row.id === 'merchants').label, '업체 관리');
  assert.deepEqual(admin.ADMIN_NAV_GROUPS.find(row => row.label === '제휴 운영').sections, ['merchants', 'creators', 'campaigns', 'benefits']);
  const sections = admin.ADMIN_NAV_GROUPS.flatMap(group => group.sections);
  assert.equal(new Set(sections).size, sections.length);
});
for (const kind of ['creators','campaigns','benefits']) test(`${kind} mounts its protected workspace without fetching unrelated chat/report dashboard data`, async () => {
  const screen = app(kind); const tree = screen.render();
  const workspace = nodes(tree).find(node => node.type === 'AdminPartnershipsView');
  assert.ok(workspace); assert.equal(workspace.props.kind, kind);
  for (const effect of screen.effects) effect();
  await new Promise(setImmediate);
  assert.deepEqual(screen.calls, []);
});

test('switching admin sections preserves a dirty partnership editor when discard is declined', () => {
  const screen = app('creators');
  let tree = screen.render();
  nodes(tree).find(node => node.type === 'AdminPartnershipsView').props.onStateChange({ dirty: true, busy: false });
  tree = screen.render(); nodes(tree).find(node => node.type === 'AdminShell').props.onSection('users');
  assert.equal(nodes(screen.render()).find(node => node.type === 'AdminShell').props.activeSection, 'creators');
});
