import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/public-web/get-app.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

async function open(device) {
  const effects = [], events = [], replaced = [];
  const exports = {};
  vm.runInNewContext(code, {
    exports, setTimeout, Promise, window: { location: { replace: url => replaced.push(url) } },
    require(name) {
      if (name === 'react') return { useEffect: fn => effects.push(fn) };
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === 'react-native') return { StyleSheet: { create: value => value }, View: 'View' };
      if (name === '@/constants/design-system') return { Typography: { screenTitle: {} } };
      if (name === '@/constants/theme') return { MaxContentWidth: 800, Spacing: { three: 16, four: 24 } };
      if (name === '@/hooks/use-language') return { useLanguage: () => ({ language: 'ko' }) };
      if (name === '@/lib/behavior-analytics') return { behavior: (...args) => events.push(args), flushBehavior: async () => {} };
      if (name === './analytics') return { useReaderAnalytics() {} };
      if (name === './app-store-choices') return { AppStoreChoices: 'AppStoreChoices', AppStoreRating: 'AppStoreRating', appStoreUrl: () => 'https://apps.apple.com/campaign', useDevice: () => device };
      return {};
    },
  });
  const tree = exports.default();
  effects.forEach(effect => effect());
  await new Promise(resolve => setImmediate(resolve));
  const types = [], walk = node => { if (!node || typeof node !== 'object') return; types.push(node.type); [node.props?.children].flat().forEach(walk); };
  walk(tree);
  return { events, replaced, types };
}

test('/get sends an iPhone straight to the App Store campaign link', async () => {
  const page = await open('ios');
  assert.deepEqual(page.events, [['press', 'web.store.ios.open']]);
  assert.deepEqual(page.replaced, ['https://apps.apple.com/campaign']);
});

test('/get keeps Android on the store choices with the tester request instead of forwarding to Play', async () => {
  for (const device of ['android', 'desktop', null]) {
    const page = await open(device);
    assert.equal(page.events.length, 0, `${device}: no store-open event`);
    assert.equal(page.replaced.length, 0, `${device}: stays on the page`);
    assert.ok(page.types.includes('AppStoreChoices'), `${device}: the store choices render`);
  }
});
