import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Loads the helper with stubbed native modules; the real ones only exist in the app runtime.
function load() {
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/store-review.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const stubs = { '@react-native-async-storage/async-storage': { default: {} }, 'expo-store-review': {}, 'react-native': { Platform: { OS: 'ios' } } };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => stubs[name], setTimeout });
  return module.exports;
}

test('store review asks once per 120 days, only when available, never on web, and never throws', async () => {
  const { askForStoreReview } = load();
  const saved = new Map(), asked = [];
  const storage = { getItem: async key => saved.get(key) ?? null, setItem: async (key, value) => { saved.set(key, value); } };
  const review = { isAvailableAsync: async () => true, requestReview: async () => { asked.push('sheet'); } };
  const day = 24 * 60 * 60 * 1000, start = Date.UTC(2026, 9, 30);
  assert.equal(await askForStoreReview(start, storage, review, 'ios'), true);
  assert.equal(await askForStoreReview(start + 119 * day, storage, review, 'ios'), false);
  assert.equal(await askForStoreReview(start + 121 * day, storage, review, 'android'), true);
  assert.equal(asked.length, 2);
  assert.equal(await askForStoreReview(start + 400 * day, storage, review, 'web'), false);
  assert.equal(await askForStoreReview(start + 400 * day, storage, { ...review, isAvailableAsync: async () => false }, 'ios'), false);
  assert.equal(await askForStoreReview(start + 400 * day, { getItem: async () => { throw Error('disk'); } }, review, 'ios'), false);
  assert.equal(asked.length, 2);
});
