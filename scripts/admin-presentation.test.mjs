import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as admin from '../src/lib/admin.ts';
import * as labels from '../src/lib/admin-labels.ts';
import { filterReportRows } from '../src/components/admin/admin-report-filter.ts';

function view(file, name, extra = '') {
  const state = [], feedback = [];
  let index = 0;
  const imports = {
    react: { useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; } },
    'react/jsx-runtime': { Fragment: 'Fragment', jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', TextInput: 'TextInput', Platform: { OS: 'web' }, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 1200 }) },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/constants/theme': { Colors: { admin: {} }, Spacing: {} },
    '@/lib/admin': admin, '@/lib/admin-labels': labels, '@/lib/admin-layout': { isCompactAdminWidth: () => false },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/components/admin/admin-trust-review-content': { isTrustTarget: () => false },
    './admin-report-filter': { filterReportRows },
    './admin-table-controls': Object.fromEntries(['AdminFilterBar', 'AdminFilterReset', 'AdminMultiFilter', 'AdminSearch', 'AdminTableSummary'].map(name => [name, name])),
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8') + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? {}, Date, Intl });
  const expand = node => !node || typeof node !== 'object' ? node : Array.isArray(node) ? node.map(expand) : typeof node.type === 'function' ? expand(node.type(node.props)) : { ...node, props: { ...node.props, children: expand(node.props?.children) } };
  return { render(props) { index = 0; return expand(exports[name](props)); }, feedback };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);

test('analytics member links show a human fallback and still open the exact member', () => {
  const screen = view('../src/components/admin/admin-analytics.tsx', 'UserLink', '\nexports.UserLink = UserLink;');
  const users = [], id = '936b58ac-1468-47c9-8a84-764dc819e44c';
  const tree = screen.render({ id, nickname: '', onUser: value => users.push(value) });
  assert.equal(text(tree).includes(id.slice(0, 8)), false);
  assert.match(text(tree), /회원|이름 미확인/);
  tree.props.onPress();
  assert.deepEqual(users, [id]);
  assert.deepEqual(screen.feedback, ['selection']);
});

test('internal UI targets and session identifiers appear only when detailed behavior records are opened', () => {
  const screen = view('../src/components/admin/admin-analytics.tsx', 'Behavior', '\nexports.Behavior = Behavior;');
  const props = { data: { behavior: { screens: [], steps: [{ platform: 'ios', screen: 'onboarding', target: 'signup_complete', count: 7, sessions: 6 }], actions: [{ platform: 'ios', screen: 'feed', kind: 'press', target: 'components_hidden-test.pressable.4', value: 0, count: 3, sessions: 2 }], recent: [{ sessionId: '973d36fa-9d81-4db4-b65c-685c2c015deb', seq: 2, anonymous: false, createdAt: '2026-10-14T10:00:00Z', platform: 'ios', screen: 'feed', kind: 'press', target: 'components_hidden-test.pressable.4', value: 0 }] } } };
  let tree = screen.render(props);
  assert.equal(text(tree).includes('components_hidden-test'), false);
  assert.equal(text(tree).includes('973d36fa'), false);
  assert.equal(text(tree).includes('signup_complete'), false);
  assert.ok(text(tree).includes('회원가입 완료'));
  const toggle = nodes(tree).find(node => node.type === 'Pressable' && /세부 분석 기록/.test(text(node)));
  assert.ok(toggle);
  toggle.props.onPress();
  tree = screen.render(props);
  assert.ok(text(tree).includes('components_hidden-test.pressable.4'));
  assert.ok(text(tree).includes('973d36fa-9d81-4db4-b65c-685c2c015deb'));
  assert.ok(text(tree).includes('signup_complete'));
  assert.deepEqual(screen.feedback, ['selection']);
});

test('audit and error records retain operational context while their exact IDs are disclosed on demand', () => {
  const screen = view('../src/components/admin/admin-analytics.tsx', 'Logs', '\nexports.Logs = Logs;');
  const props = { data: { auditSummary: [], audit: [{ id: 91, actorId: '9d817992-89e8-42c4-93bc-eb3c2f13a2c1', scope: 'posts', createdAt: '2026-10-14T10:00:00Z' }], errors: [{ id: 572938462, status: 'failed', attempts: 3, createdAt: '2026-10-14T10:00:00Z' }] } };
  let tree = screen.render(props);
  assert.ok(text(tree).includes('게시글'));
  assert.ok(text(tree).includes('실패'));
  assert.equal(text(tree).includes('9d817992'), false);
  assert.equal(text(tree).includes('572938462'), false);
  const toggle = nodes(tree).find(node => node.type === 'Pressable' && /문제 추적 정보/.test(text(node)));
  assert.ok(toggle); toggle.props.onPress();
  tree = screen.render(props);
  assert.ok(text(tree).includes('9d817992-89e8-42c4-93bc-eb3c2f13a2c1'));
  assert.ok(text(tree).includes('572938462'));
});

test('report evidence paths stay in tracing disclosure and accessible selection preserves the exact batch ID', async () => {
  const screen = view('../src/components/admin/admin-report-queue.tsx', 'AdminReportQueue');
  const report = { id: '2f7a81bd-f81f-488e-94a4-a4503cbe7396', reported_user_id: 'member-a', reporter_id: 'member-b', target_type: 'post', target_id: 'post-a', reason_code: 'spam', details: '신고 설명', status: 'open', created_at: '2026-10-14T10:00:00Z', evidence: { body: '원문 그대로', image_paths: ['private/evidence/photo-original.jpg'] } };
  const resolved = [];
  const props = { reports: [report], profiles: new Map([['member-a', { nickname: '동네 이웃' }], ['member-b', { nickname: '산책 친구' }]]), actions: [], resolving: false, onUser() {}, onResolve: async (...args) => { resolved.push(args); return args[0]; } };
  let tree = screen.render(props);
  const path = nodes(tree).find(node => node.type === 'Text' && text(node) === 'private/evidence/photo-original.jpg');
  assert.ok(path);
  const disclosure = nodes(tree).find(node => node.type === 'details' && nodes(node).includes(path));
  assert.ok(disclosure, 'attachment storage paths belong inside the tracing disclosure');
  assert.ok(text(disclosure).includes('문제 추적 정보'));
  assert.ok(text(tree).includes('원문 그대로'));
  disclosure.props.onToggle();
  const checkbox = nodes(tree).find(node => node.type === 'input' && node.props?.type === 'checkbox' && node.props['aria-label']?.includes('동네 이웃'));
  assert.ok(checkbox);
  assert.equal(checkbox.props['aria-label'].includes(report.id), false);
  checkbox.props.onChange({ target: { checked: true } });
  tree = screen.render(props);
  const bulk = nodes(tree).find(node => node.type === 'button' && text(node) === '선택 경고');
  await bulk.props.onClick();
  assert.deepEqual(Array.from(resolved[0][0]), [report.id]);
  assert.equal(resolved[0][1], 'warned');
  assert.ok(screen.feedback.length >= 3);
});
