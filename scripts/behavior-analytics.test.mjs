import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { configureBehavior, behaviorScreen, behavior, flushBehavior, isIdle, noteTouch, scrollThresholds } from '../src/lib/behavior-analytics.ts';
import { analyticsScreen } from '../src/lib/analytics.ts';

test('a phone left untouched for five minutes stops counting dwell, and the next touch starts it again', () => {
  noteTouch();
  const now = Date.now();
  assert.equal(isIdle(now + 4 * 60 * 1000), false);
  assert.equal(isIdle(now + 6 * 60 * 1000), true);
  const source = readFileSync(new URL('../src/components/app-activity.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes("if (!isIdle(now)) behavior('dwell'"));
  assert.ok(readFileSync(new URL('../src/components/app-update-gate.tsx', import.meta.url), 'utf8').includes('onTouchStart={() => noteTouch()}'));
});

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
test('a batch refused as INVALID_BEHAVIOR is dropped instead of blocking every later event', async () => {
  for (const file of ['../src/components/app-activity.tsx', '../src/components/public-web/analytics.ts']) {
    assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /\.message === 'INVALID_BEHAVIOR';/);
  }
  const sent = [];
  // A server that refuses the whole batch for one unknown target, and the transports' delivered rule.
  configureBehavior(async batch => {
    sent.push(batch.events.map(event => event.target));
    const error = batch.events.some(event => event.target === 'post.poll.option.0') ? { message: 'INVALID_BEHAVIOR' } : null;
    return !error || error.message === 'INVALID_BEHAVIOR';
  });
  behaviorScreen('post');
  behavior('press', 'post.poll.option.0');
  await flushBehavior();
  behavior('press', 'web_control_1');
  await flushBehavior();
  assert.deepEqual(sent, [['screen', 'post.poll.option.0'], ['web_control_1']]);
  configureBehavior(null);
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
    // A control is either written in JSX or handed to a shared chip helper as `analyticsId: '<id>'`.
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.ok(source.includes(`analyticsId="${id}"`) || source.includes(`analyticsId: '${id}'`), id);
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
  // Fixed ids in 'a', c ? 'a' : 'b' and ({ k: 'a' })[key]. Template and variable ids are not checked here.
  const literals = node => !node ? [] : ts.isStringLiteralLike(node) ? [node.text]
    : ts.isParenthesizedExpression(node) || ts.isJsxExpression(node) ? literals(node.expression)
    : ts.isConditionalExpression(node) ? [...literals(node.whenTrue), ...literals(node.whenFalse)]
    : ts.isElementAccessExpression(node) && ts.isObjectLiteralExpression(node.expression)
      ? node.expression.properties.flatMap(property => ts.isPropertyAssignment(property) ? literals(property.initializer) : []) : [];
  // Wrappers that add a suffix to the id they are given: every suffixed target must be registered. Others send the id as is.
  const suffixes = { Switch: ['on', 'off'], LanguageChips: ['en', 'ko'] };
  const src = new URL('../src/', import.meta.url);
  const scan = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      // src/admin and src/merchant-web are separate web roots; their layouts mount no sender (AppActivity is in src/app/_layout.tsx).
      if (directory.href === src.href && ['admin', 'merchant-web'].includes(entry.name)) continue;
      const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) { scan(file); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const ast = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, entry.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const controls = new Map();
      for (const node of ast.statements) if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === '@/components/analytics-controls') {
        for (const item of node.importClause?.namedBindings?.elements ?? []) controls.set(item.name.text, item.propertyName?.text ?? item.name.text);
      }
      const check = (value, tag, node) => {
        for (const id of literals(value)) for (const target of suffixes[tag]?.map(suffix => `${id}.${suffix}`) ?? [id]) {
          if (!registered.has(target)) missing.push(`${target} (${file.pathname}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1})`);
        }
      };
      const visit = node => {
        if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'data-analytics') check(node.initializer, '', node);
        else if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'analyticsId') {
          const tag = node.parent.parent.tagName.getText(ast);
          check(node.initializer, controls.get(tag) ?? tag, node);
        } else if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'analyticsId') check(node.initializer, '', node);
        else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'behavior') check(node.arguments[1], '', node);
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
    if (name === 'react-native') return { Pressable: 'Pressable', ScrollView: 'ScrollView', FlatList: 'FlatList', SectionList: 'SectionList', Switch: 'Switch', Platform: { OS: 'android' } };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({ accent: 'accent', line: 'line' }) };
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
  const toggle = exports.Switch({ analyticsId: 'alerts', value: true, trackColor: { true: 'teal' }, onValueChange: value => calls.push(value) });
  assert.deepEqual({ ...toggle.props.trackColor }, { false: 'line', true: 'accent' }, 'one look on every screen');
  assert.equal(toggle.props.thumbColor, '#FFFFFF');
  toggle.props.onValueChange(false);
  assert.deepEqual(events.at(-1), ['press', 'alerts.off']);
});
