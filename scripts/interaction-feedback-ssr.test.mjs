import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToString } from 'react-dom/server';
import ts from 'typescript';
import * as preferences from '../src/lib/interaction-feedback-preferences.ts';

function renderFeedback({ browser = false, platform = 'web' } = {}) {
  let players = 0;
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/interaction-feedback.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const imports = {
    react: React, 'react/jsx-runtime': jsx,
    'react-native': { Platform: { OS: platform }, View: 'div', Text: 'span', Pressable: 'button', Modal: () => null,
      Animated: { Value: class { interpolate() { return 0; } }, View: 'div' }, Easing: {}, StyleSheet: { create: value => value } },
    'react-native-reanimated': { useReducedMotion: () => false },
    'expo-audio': { useAudioPlayer() { players++; if (!browser && platform === 'web') throw new ReferenceError('Audio is not defined'); return {}; } },
    './interaction-feedback-preferences': preferences,
  };
  const exports = {};
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? {}, ...(browser ? { window: {} } : {}) });
  function Child() {
    const value = exports.useInteractionFeedback();
    assert.equal(value.soundEnabled, true);
    assert.equal(typeof value.play, 'function');
    const id = React.useId();
    return React.createElement('div', null,
      React.createElement('label', { htmlFor: id }, '비즈니스 로그인'),
      React.createElement('input', { id, 'aria-controls': id + '-panel' }),
      React.createElement('span', { id: id + '-panel' }, '필터'));
  }
  const html = renderToString(React.createElement(exports.InteractionFeedbackProvider, null, React.createElement(Child)));
  assert.ok(html.includes('비즈니스 로그인'));
  return { players, html };
}

test('web server rendering includes children without constructing unavailable Audio players', () => {
  assert.equal(renderFeedback().players, 0);
});
test('browser and native rendering retain all four existing feedback players', () => {
  assert.equal(renderFeedback({ browser: true }).players, 4);
  assert.equal(renderFeedback({ platform: 'ios' }).players, 4);
});
test('server and initial browser markup preserve useId labels and control links during hydration', () => {
  assert.equal(renderFeedback().html, renderFeedback({ browser: true }).html);
});
