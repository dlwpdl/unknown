import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { configureBehavior, behaviorScreen, behavior, flushBehavior, scrollThresholds } from '../src/lib/behavior-analytics.ts';

test('bounded retry batches preserve identity and order, reset on identity change, omit all content', async () => {
  const batches = [];
  let accept = false;
  configureBehavior(async batch => { batches.push(structuredClone(batch)); return accept; });
  behaviorScreen('feed');
  behavior('press', 'web_control_1');
  await flushBehavior();
  accept = true;
  await flushBehavior();
  assert.deepEqual(batches[0], batches[1]);
  assert.deepEqual(Object.keys(batches[0].events[0]), ['seq', 'screen', 'kind', 'target', 'value']);
  assert.deepEqual(batches[0].events.map(e => e.seq), [1, 2]);
  for (let i = 0; i < 150; i++) behavior('press', 'web_control_1');
  await flushBehavior();
  assert.equal(batches.at(-1).events.length, 25);
  assert.equal(batches.at(-1).events[0].seq, 53);
  configureBehavior(null);
  await flushBehavior();
  assert.equal(batches.length, 3);
});
test('scroll emits crossed thresholds once and ignores short/horizontal-invalid surfaces', () => {
  assert.deepEqual(scrollThresholds(0, 500, 2000, 0), [25]);
  assert.deepEqual(scrollThresholds(1100, 500, 2000, 25), [50, 75]);
  assert.deepEqual(scrollThresholds(1500, 500, 2000, 75), [100]);
  assert.deepEqual(scrollThresholds(1500, 500, 2000, 100), []);
  assert.deepEqual(scrollThresholds(0, 500, 400, 0), []);
  assert.deepEqual(scrollThresholds(NaN, 500, 2000, 0), []);
});
test('every instrumented control is in the server allowlist', () => {
  const registry = JSON.parse(readFileSync(new URL('./analytics-controls.json', import.meta.url), 'utf8'));
  const sql = readFileSync(new URL('../supabase/migrations/0073_behavior_analytics.sql', import.meta.url), 'utf8');
  for (const [id, path] of Object.entries(registry)) {
    assert.ok(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').includes(`analyticsId="${id}"`), id);
    assert.ok(sql.includes(`('${id}')`) || sql.includes(`('${id}.on')`), id);
  }
});

test('success dispatches before account rotation even with an in-flight batch', async () => {
  const batches = [];
  let complete;
  configureBehavior(batch => { batches.push(structuredClone(batch)); return new Promise(resolve => { complete = resolve; }); });
  behaviorScreen('feed');
  const pending = flushBehavior();
  const finishFirst = complete;
  behavior('success', 'signup_complete');
  assert.equal(batches[1].events[0].target, 'signup_complete');
  assert.equal(batches[0].session, batches[1].session);
  complete(true);
  configureBehavior(null);
  finishFirst(true);
  await pending;
});

test('native wrappers preserve callbacks and refs, record fixed IDs, and reset scroll per view', async () => {
  const { default: ts } = await import('typescript');
  const { default: vm } = await import('node:vm');
  const calls = [];
  const events = [];
  const exports = {};
  let view = 1;
  const code = ts.transpileModule(readFileSync(new URL('../src/components/analytics-controls.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require(name) {
    if (name === 'react') return { useRef: value => ({ current: value }) };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { Pressable: 'Pressable', ScrollView: 'ScrollView', FlatList: 'FlatList', SectionList: 'SectionList', Switch: 'Switch' };
    if (name === '@/lib/behavior-analytics') return { behavior: (...args) => events.push(args), behaviorView: () => view, scrollThresholds };
    throw new Error(name);
  } });
  const ref = { current: null };
  const press = exports.Pressable({ analyticsId: 'fixed', ref, accessibilityLabel: 'private text', onPress: e => calls.push(e) });
  press.props.onPress('gesture');
  assert.equal(press.props.ref, ref);
  assert.deepEqual(calls, ['gesture']);
  assert.deepEqual(events, [['press', 'fixed']]);
  const list = exports.FlatList({ analyticsId: 'list', ref, onScroll: () => calls.push('scroll') });
  const event = { nativeEvent: { contentOffset: { y: 100 }, layoutMeasurement: { height: 100 }, contentSize: { height: 400 } } };
  list.props.onScroll(event); list.props.onScroll(event);
  assert.equal(events.filter(e => e[0] === 'scroll').length, 2);
  view++;
  list.props.onScroll(event);
  assert.equal(events.filter(e => e[0] === 'scroll').length, 4);
  assert.equal(list.props.ref, ref);
  const horizontal = exports.ScrollView({ analyticsId: 'tabs', horizontal: true });
  horizontal.props.onScroll(event);
  assert.equal(events.length, 5);
});
