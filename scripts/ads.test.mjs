import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('feed ads respect placement, consent, initialization, platform and test-unit boundaries', async () => {
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/ads.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  let allowed = false, initialized = 0, loadedSDK = 0, notifications = 0;
  const sdk = { __esModule: true, default: () => ({
    setRequestConfiguration: async config => assert.equal(config.maxAdContentRating, 'PG'),
    initialize: async () => { initialized++; },
  }), MaxAdContentRating: { PG: 'PG' }, TestIds: { NATIVE: 'google-test-native' },
  AdsConsentPrivacyOptionsRequirementStatus: { REQUIRED: 'REQUIRED' },
  AdsConsent: {
    gatherConsent: async () => {}, getConsentInfo: async () => ({ canRequestAds: allowed }),
    requestInfoUpdate: async () => ({ privacyOptionsRequirementStatus: 'REQUIRED' }),
    showPrivacyOptionsForm: async () => {},
  } };
  function load(platform = 'ios', mode = 'live', expoGo = false) {
    const exports = {};
    vm.runInNewContext(source, { exports, __DEV__: false, process: { env: { EXPO_PUBLIC_ADS_MODE: mode } }, require(name) {
      if (name === 'expo-constants') return { __esModule: true, default: { executionEnvironment: expoGo ? 'go' : 'native' }, ExecutionEnvironment: { StoreClient: 'go' } };
      if (name === 'react-native') return { Platform: { OS: platform }, DeviceEventEmitter: { emit: () => { notifications++; } } };
      if (name === 'react-native-google-mobile-ads') { loadedSDK++; return sdk; }
      throw new Error(name);
    } });
    return exports;
  }
  const live = load();
  assert.deepEqual(Array.from({ length: 25 }, (_, i) => i).filter(live.feedAdPosition), [4, 14, 24]);
  assert.equal(await live.prepareAds(), null);
  assert.equal(initialized, 0, 'live SDK must not initialize without consent clearance');
  allowed = true;
  await live.showAdPrivacyOptions();
  await Promise.all([live.prepareAds(), live.prepareAds()]);
  assert.equal(initialized, 1, 'parallel feed slots initialize once');
  assert.equal(live.feedAdUnit(sdk), 'ca-app-pub-2361293253164911/5616099773');
  assert.equal(load('android').feedAdUnit(sdk), 'ca-app-pub-2361293253164911/4669015468');
  allowed = false;
  await live.showAdPrivacyOptions();
  assert.equal(await live.prepareAds(), null);
  assert.equal(notifications, 2, 'privacy changes invalidate rendered ads');
  const before = loadedSDK;
  assert.equal(await load('web').prepareAds(), null);
  assert.equal(await load('ios', 'live', true).prepareAds(), null);
  assert.equal(loadedSDK, before, 'web and Expo Go never load a missing native module');
  assert.equal(load('ios', 'test').feedAdUnit(sdk), 'google-test-native');
  assert.equal(load('ios', '').feedAdUnit(sdk), 'google-test-native', 'unconfigured release builds cannot request live ads');
});
