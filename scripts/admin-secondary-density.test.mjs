import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Render the production panel with isolated hooks and a read-only provider fixture.
function panelView(component = 'admin-trending-panel', exportName = 'AdminTrendingPanel') {
  const state = [], effects = [], feedback = [];
  let index = 0;
  const exports = {};
  const config = { enabled: true, window_hours: 24, repeat_after_hours: 48, view_weight: 1, anon_view_weight: .1, like_weight: 2, comment_weight: 3, min_score: 10, max_per_city_per_day: 2, quiet_start_hour: 22, quiet_end_hour: 8 };
  const source = ts.transpileModule(readFileSync(new URL(`../src/components/admin/${component}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, Date, Object, require(name) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react') return {
      useState(initial) { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
      useCallback: callback => callback, useEffect: callback => effects.push(callback),
    };
    if (name === 'react-native') return { View: 'View', TextInput: 'TextInput', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'web' }, StyleSheet: { create: styles => styles }, Alert: { alert() { throw new Error('unexpected mutation'); } }, Linking: { openURL() { throw new Error('no external links permitted in disclosure test'); } } };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) };
    if (name === '@/constants/theme') return { Colors: { admin: {} }, Spacing: {} };
    if (name === '@/components/state-card') return { StateCard: 'StateCard' };
    if (name === './admin-ui') return { AdminButton: 'AdminButton', AdminCard: 'AdminCard', AdminFacts: 'AdminFacts', AdminInfo: 'AdminInfo' };
    if (name === '@/lib/admin-ticketmaster') return { revenueMonths: () => ['2026-10'], loadTicketmasterRevenue: async () => ({ connected: true, generatedAt: '2026-10-14T00:00:00Z', totals: [{ currency: 'CAD', pending: '12.00', approved: '8.00', settled: '5.00' }, { currency: 'USD', pending: '7.00', approved: '3.00', settled: '1.00' }] }) };
    if (name === '@/lib/admin-data') return { loadAdminTrending: async () => ({ config, quietNow: true, preview: [], recent: [] }), saveAdminTrending() { throw new Error('no save permitted in disclosure test'); } };
    if (name === '@/lib/mock') return { CITIES: [] };
    if (name === '@/i18n/ko') return { count: String };
    return {};
  } });
  return { feedback, render() { index = 0; return exports[exportName]({ localPreview: false }); }, async load() { effects[0](); await new Promise(resolve => setImmediate(resolve)); } };
}
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join('');

test('trending settings stay visible in grouped fields, keep edits and retain the quiet-time warning', async () => {
  const view = panelView(); view.render(); await view.load();
  const field = root => nodes(root).find(node => node.type === 'TextInput' && node.props.accessibilityLabel === '집계 구간(시간)');
  assert.ok(field(view.render()), 'configuration fields must be rendered without an extra disclosure');
  for (const group of ['점수 가중치', '시간', '발송 한도']) assert.ok(nodes(view.render()).some(node => node.type === 'Text' && text(node) === group), group);
  field(view.render()).props.onChangeText('36');
  assert.equal(field(view.render()).props.value, '36');
  field(view.render()).props.onFocus();
  assert.equal(view.feedback.at(-1), 'selection');
  assert.match(text(view.render()), /조용한 시간/);
});

test('Ticketmaster keeps per-currency figures unsummed and the settlement caution in the info note', async () => {
  const view = panelView('admin-ticketmaster', 'AdminTicketmasterView'); view.render(); await view.load();
  const root = view.render();
  const figures = nodes(root).find(node => node.type === 'AdminFacts').props.items.map(item => `${item.label} ${text(item.value)}`).join(' | ');
  assert.match(figures, /확정 대기 CAD12\.00USD7\.00/);
  assert.doesNotMatch(figures, /19\.00/);
  assert.ok(nodes(root).some(node => node.props?.accessibilityLabel === 'CAD 확정 대기 48%, 정산 대기 32%, 정산 완료 20%'));
  const info = nodes(root).find(node => node.type === 'AdminInfo');
  assert.ok([info.props.text].flat().some(line => line.includes('정산 완료는 은행 입금과 달라요')));
  assert.equal(nodes(root).filter(node => node.type === 'StateCard').length, 0, 'Connected data shows figures, not an empty state.');
  nodes(root).find(node => node.type === 'Pressable' && node.props.accessibilityRole === 'tab').props.onPress();
  assert.equal(view.feedback.at(-1), 'selection');
});
