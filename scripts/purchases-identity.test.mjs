import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('billing operation is blocked if login changes during asynchronous SDK identity setup', async () => {
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/purchases.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  for (const stage of ['configure', 'logIn']) {
    let account = 'owner-a', operations = 0;
    const exports = {};
    const sdk = {
      isConfigured: async () => stage !== 'configure',
      configure() { account = 'owner-b'; },
      getAppUserID: async () => 'old-sdk-account',
      logIn: async () => { await Promise.resolve(); account = 'owner-b'; },
    };
    vm.runInNewContext(source, { exports, __DEV__: false, process: { env: { EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'appl_test_fixture' } }, require(name) {
      if (name === 'expo-constants') return { __esModule: true, default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'storeClient' } };
      if (name === 'react-native') return { Platform: { OS: 'ios' } };
      if (name === '@/lib/supabase') return { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: account } } } }) } } };
      if (name === 'react-native-purchases') return { __esModule: true, default: sdk };
      throw new Error(`Unexpected import: ${name}`);
    } });
    await assert.rejects(exports.withPurchases('owner-a', async () => { operations++; }), /ACCOUNT_CHANGED/, stage);
    assert.equal(operations, 0, 'purchase/restore must not run under the previous account');
    account = 'owner-b'; sdk.configure = () => {}; sdk.logIn = async () => {};
    await exports.withPurchases('owner-b', async () => { operations++; });
    assert.equal(operations, 1, 'a rejected operation must not poison the next account’s queue');
  }
});
