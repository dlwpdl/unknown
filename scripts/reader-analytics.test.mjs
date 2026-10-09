import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('공개 reader의 첫 조회는 hydration 후 한 번만 시작한다', () => {
  const slots = [], views = [], exports = {};
  let index = 0, intervals = 0;
  const noop = () => {};
  const source = ts.transpileModule(readFileSync(new URL('../src/components/public-web/analytics.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, process: { env: {} }, Date, document: { hidden: false, addEventListener: noop, removeEventListener: noop }, window: { addEventListener: noop, removeEventListener: noop },
    setInterval: () => ++intervals, clearInterval: noop, require(name) {
      if (name === 'react') return { useEffect(effect, deps) {
        const i = index++, previous = slots[i];
        if (previous && deps.every((value, j) => value === previous.deps[j])) return;
        previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() };
      } };
      return { configureBehavior: noop, flushBehavior: async () => {}, behavior: noop, behaviorScreen: screen => views.push(screen), scrollThresholds: () => [] };
    } });
  const render = (key, ready) => { index = 0; exports.useReaderAnalytics('post', key, ready); };
  render('post:null', false);
  assert.equal(views.length, 0);
  assert.equal(intervals, 0);
  render('post:actual-id', true);
  render('post:actual-id', true);
  assert.deepEqual(views, ['post']);
  assert.equal(intervals, 1);
  render('post:second-id', true);
  assert.equal(views.length, 2);
});
