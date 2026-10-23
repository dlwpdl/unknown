import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { configureBehavior, behaviorScreen, behavior, flushBehavior, scrollThresholds } from '../src/lib/behavior-analytics.ts';
import { analyticsScreen } from '../src/lib/analytics.ts';

test('the shared find-destination target keeps place and event screens distinguishable without source metadata', async () => {
  const batches = [];
  configureBehavior(async batch => { batches.push(structuredClone(batch)); return true; });
  for (const path of ['/places/[id]', '/events/[id]']) {
    behaviorScreen(analyticsScreen(path)); behavior('press', 'ticketmaster.meetup.find');
  }
  await flushBehavior();
  const events = batches.flatMap(batch => batch.events).filter(event => event.target === 'ticketmaster.meetup.find');
  assert.deepEqual(events.map(event => event.screen), ['place-detail', 'event-detail']);
  for (const event of events) assert.deepEqual(Object.keys(event), ['seq', 'screen', 'kind', 'target', 'value']);
  configureBehavior(null);
});

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
  // 허용목록은 이후 마이그레이션에서도 늘어난다. 모든 마이그레이션을 합쳐서 확인한다.
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  const sql = readdirSync(migrations).filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(new URL(name, migrations), 'utf8')).join('\n');
  for (const [id, path] of Object.entries(registry)) {
    assert.ok(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').includes(`analyticsId="${id}"`), id);
    assert.ok(sql.includes(`('${id}')`) || sql.includes(`('${id}.on')`), id);
  }
});

test('live native controls and public reader actions have fixed server targets', async () => {
  const { default: ts } = await import('typescript');
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  const registered = new Set(readdirSync(migrations).filter(name => name.endsWith('.sql')).flatMap(name => {
    const sql = readFileSync(new URL(name, migrations), 'utf8');
    return [...sql.matchAll(/insert\s+into\s+private\.behavior_targets\s*\(id\)\s*values\s*([\s\S]*?);/gi)]
      .flatMap(insert => [...insert[1].matchAll(/\('([^']+)'\)/g)].map(match => match[1]));
  }));
  const missing = [];
  const scan = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['admin', 'merchant-web'].includes(entry.name)) continue;
      const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) { scan(file); continue; }
      if (!entry.name.endsWith('.tsx')) continue;
      const ast = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const controls = new Map();
      for (const node of ast.statements) if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === '@/components/analytics-controls') {
        for (const item of node.importClause?.namedBindings?.elements ?? []) controls.set(item.name.text, item.propertyName?.text ?? item.name.text);
      }
      const visit = node => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const kind = controls.get(node.tagName.getText(ast));
          for (const attribute of node.attributes.properties) {
            if (!ts.isJsxAttribute(attribute) || !ts.isStringLiteral(attribute.initializer ?? {})) continue;
            if (attribute.name.text !== 'data-analytics' && !(kind && attribute.name.text === 'analyticsId')) continue;
            const id = attribute.initializer.text;
            for (const target of kind === 'Switch' ? [id + '.on', id + '.off'] : [id]) if (!registered.has(target)) missing.push(`${target} (${file.pathname})`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
  };
  scan(new URL('../src/', import.meta.url));
  assert.deepEqual(missing, [], 'instrumented controls must not reject their entire analytics batch');
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
    if (name === '@/components/flat-pressable') return { FlatPressable: 'FlatPressable' };
    throw new Error(name);
  } });
  const ref = { current: null };
  const press = exports.Pressable({ analyticsId: 'fixed', ref, accessibilityLabel: 'private text', onPress: e => calls.push(e) });
  press.props.onPress('gesture');
  assert.equal(press.props.ref, ref);
  assert.deepEqual(calls, ['gesture']);
  assert.deepEqual(events, [['press', 'fixed']]);
  const flat = exports.Pressable({ analyticsId: 'flat', ref, disabled: true, accessibilityState: { busy: true } });
  assert.equal(flat.type, 'FlatPressable');
  assert.equal(flat.props.ref, ref);
  assert.equal(flat.props.disabled, true);
  assert.equal(flat.props.accessibilityState.busy, true);
  assert.equal(flat.props.analyticsId, undefined);
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
