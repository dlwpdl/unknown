import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// The business report page with a report already loaded, every component expanded into plain { type, props } nodes.
function page(report) {
  const jsx = (type, props) => ({ type, props });
  let states = 0;
  const modules = {
    react: { useState: initial => [states++ ? (typeof initial === 'function' ? initial() : initial) : report, () => {}],
      useRef: current => ({ current }), useCallback: fn => fn, useEffect() {} },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'expo-asset': { Asset: { fromModule: () => ({ uri: 'wordmark' }) } }, 'expo-router/head': { __esModule: true, default: 'Head' },
    '@/constants/design-system': { ControlMetrics: { radius: {} }, MiniCard: {},
      Typography: new Proxy({}, { get: () => ({ fontWeight: 400, fontSize: 16, lineHeight: 20, letterSpacing: 0 }) }) },
    '@/constants/theme': { Colors: { admin: {}, dark: {} }, Spacing: {} },
    '@/hooks/use-color-scheme': { useColorScheme: () => 'light' }, '@/hooks/use-theme': { ThemeOverrideProvider: 'Theme' },
    '@/lib/event-links': {}, './event-copy': { EVENT_COPY: { ko: { foot: '' } } }, './event-parts': { EventLoadState: 'EventLoadState' },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/public-web/event-report.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  { exports, require: name => name.endsWith('.css') || name.endsWith('.png') ? {} : modules[name] });
  const expand = node => Array.isArray(node) ? node.map(expand) : !node || typeof node !== 'object' ? node
    : typeof node.type === 'function' ? expand(node.type(node.props)) : { ...node, props: { ...node.props, children: expand(node.props.children) } };
  return expand(exports.default());
}
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props.children)
  : typeof node === 'string' || typeof node === 'number' ? String(node) : '';

const report = { title: '테스트 캠페인', business: '테스트 가게', currency: 'CAD', starts_on: '2026-10-17', fix_on: '2026-11-15', fixed_at: null,
  synced_at: '2026-11-03T22:00:00Z', guests: { total: 3, discount: 2, winner: 1, by_day: [{ day: '2026-10-18', n: 3 }] },
  money: { guest_sales_cents: 9000, discount_total_cents: 1000, hosted_meals_cents: 5000, store_spend_cents: 6000, per_guest_cents: 2000, confirmed: true },
  contents: [{ label: 'A', kind: 'creator_content', reel: true, first_seen: '2026-10-20', views: 1200, views_at: '2026-11-02T18:00:00Z',
    likes: 30, comments: 2, shares: 1, saves: 4, confirmed: true }], views_total: 1200,
  store: [['2026-10-16', 1000, true], ['2026-11-20', 1100, false]].map(([day, value, before]) => ({ metric: 'ig_followers', value,
    period_start: day, period_end: day, source: 'store_report', confirmed: true, before_start: before })),
  people: { reviewed: 5, confirmed: 2, visited: 2, posted: 2 } };

// Owner 2026-11-03: fixed after the last visiting team's reel, not on day 30 (11/15).
test('before the fix the report says it is fixed once the visits end, with no day-30 date', () => {
  const tree = page(report), meta = nodes(tree).find(node => node.props.className === 'rpt-meta');
  assert.deepEqual(nodes(meta).filter(node => node.props['data-tone'] === 'dash').map(text), ['방문 끝난 뒤 확정']);
  assert.doesNotMatch(text(tree), /30일|11\/15|예정/);
});

// The fix keeps the numbers of the day it is pressed (save_admin_campaign_report), which can be after day 30.
test('a report fixed after day 30 does not call its numbers day-30 numbers', () => {
  const words = text(page({ ...report, fixed_at: '2026-11-25T20:00:00Z' }));
  assert.match(words, /숫자 확정 · /);
  assert.match(words, /영상 1개가 1,200번 조회됐어요/);
  assert.match(words, /확정한 날 값/);
  assert.doesNotMatch(words, /30일|방문 끝난 뒤 확정/);
});
