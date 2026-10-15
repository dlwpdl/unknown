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

test('collapsed trending settings keep edited fields mounted and retain the quiet-time warning', async () => {
  const view = panelView(); view.render(); await view.load();
  const field = root => nodes(root).find(node => node.type === 'TextInput' && node.props.accessibilityLabel === '집계 구간(시간)');
  const toggle = root => nodes(root).find(node => node.type === 'Pressable' && text(node).includes('발송 기준 설정'));
  assert.ok(field(view.render()), 'collapsed configuration fields must remain mounted');
  assert.equal(toggle(view.render()).props['aria-expanded'], false);
  toggle(view.render()).props.onPress();
  field(view.render()).props.onChangeText('36');
  toggle(view.render()).props.onPress();
  assert.equal(field(view.render()).props.value, '36');
  toggle(view.render()).props.onPress();
  assert.equal(field(view.render()).props.value, '36');
  assert.equal(view.feedback.at(-1), 'selection');
  assert.match(text(view.render()), /조용한 시간/);
});

test('Ticketmaster keeps per-currency figures and settlement warning outside collapsed methodology', async () => {
  const view = panelView('admin-ticketmaster', 'AdminTicketmasterView'); view.render(); await view.load();
  const toggle = root => nodes(root).find(node => node.type === 'Pressable' && text(node).includes('정산·출금과 갱신 기준'));
  const scope = root => nodes(root).find(node => node.type === 'View' && node.props['aria-hidden'] !== undefined);
  assert.equal(toggle(view.render()).props['aria-expanded'], false);
  assert.equal(scope(view.render()).props['aria-hidden'], true);
  const root = view.render();
  assert.match(text(root), /CAD.*12\.00.*USD.*7\.00/);
  assert.doesNotMatch(text(root), /19\.00/);
  const warning = nodes(root).find(node => node.type === 'Text' && text(node).includes('정산 완료는 은행 입금과 다릅니다'));
  assert.ok(warning && !nodes(scope(root)).includes(warning));
  toggle(view.render()).props.onPress();
  assert.equal(scope(view.render()).props['aria-hidden'], false);
  assert.equal(view.feedback.at(-1), 'selection');
  toggle(view.render()).props.onPress();
  assert.equal(scope(view.render()).props['aria-hidden'], true);
});
