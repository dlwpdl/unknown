import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/components/glass-surface.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

test('glass uses the native surface only when iOS offers both required APIs', () => {
  for (const [platform, api, liquid, expected] of [
    ['ios', true, true, 'GlassView'],
    ['ios', true, false, 'View'],
    ['android', true, true, 'View'],
    ['ios', true, 'throw', 'View'],
  ]) {
    const exports = {};
    vm.runInNewContext(source, { exports, require(name) {
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
      if (name === 'react-native') return { Platform: { OS: platform }, View: 'View', StyleSheet: { hairlineWidth: 1, create: styles => styles } };
      if (name === 'expo-glass-effect') return { GlassView: 'GlassView', isGlassEffectAPIAvailable: () => api, isLiquidGlassAvailable: () => {
        if (liquid === 'throw') throw new Error('native module unavailable');
        return liquid;
      } };
      throw new Error(`Unexpected import: ${name}`);
    } });
    assert.equal(exports.GlassSurface({ children: 'content' }).type, expected);
    const control = exports.GlassSurface({ children: 'content', tone: 'control', interactive: true });
    assert.equal(control.type, expected);
    if (expected === 'GlassView') {
      assert.equal(control.props.glassEffectStyle, 'clear');
      assert.equal(control.props.isInteractive, true);
    }
  }
});
