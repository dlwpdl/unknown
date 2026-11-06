import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('tab transitions finish on interruption and respect system reduced motion and web motion', () => {
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/tab-content.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const [os, reducedMotion, shouldAnimate] of [['ios', false, true], ['android', false, true], ['ios', true, false], ['web', false, false]]) {
    const exports = {}, values = [], calls = [], timers = [], moving = [];
    let focus;
    vm.runInNewContext(source, { exports, setTimeout: fn => timers.push(fn), clearTimeout: id => { timers[id - 1] = null; }, require(name) {
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
      if (name === 'react') return { useCallback: fn => fn, useState: initial => [typeof initial === 'function' ? initial() : initial, next => moving.push(next)] };
      if (name === 'expo-router') return { useFocusEffect: fn => { focus = fn; } };
      if (name === '@/hooks/use-theme') return { useTheme: () => ({ background: '#fff' }) };
      if (name === 'react-native-reanimated') return { useReducedMotion: () => reducedMotion };
      if (name === 'react-native') return {
        Platform: { OS: os }, Easing: { out: value => value, quad: 'quad' },
        Animated: { View: 'View', Value: class {
          setValue(value) { values.push(value); }
          interpolate(value) { return value; }
        }, timing(value, config) {
          assert.equal(config.toValue, 1);
          assert.equal(config.useNativeDriver, true);
          assert.ok(config.duration <= 250);
          return { start() { calls.push('start'); }, stop() { calls.push('stop'); } };
        } },
      };
      throw new Error(`Unexpected import: ${name}`);
    } });
    const resting = exports.TabContent({ children: 'content' }).props.style.flat().filter(Boolean);
    assert.ok(resting.every(part => !('opacity' in part) && !('transform' in part)), 'at rest the screen carries no fade style a remount could repaint');
    const blur = focus();
    if (shouldAnimate) {
      assert.deepEqual(values, [0]);
      blur();
      assert.deepEqual(calls, ['start', 'stop']);
      assert.equal(values.at(-1), 1, 'a fast switch must not leave the screen dimmed or shifted');
      focus()();
      assert.equal(values.at(-1), 1);
      const unfocus = focus();
      timers.at(-1)();
      assert.equal(values.at(-1), 1, 'a dropped native fade still lands at full opacity (owner 5182a202 white veil)');
      assert.equal(moving.at(-1), false, 'the fade style is dropped once it lands, so closing a sheet cannot repaint 35% (owner white map after closing a request)');
      unfocus();
    } else {
      assert.equal(blur, undefined);
      assert.deepEqual(calls, []);
      assert.deepEqual(values, []);
      assert.deepEqual(timers, []);
      assert.deepEqual(moving, []);
    }
  }
});
