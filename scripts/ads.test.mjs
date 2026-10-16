import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/ads.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function load({ platform = 'ios', mode = 'live', expoGo = false, status = 'granted', answer = 'granted', allowed = true, available = true, trackingError = false, activity = 'active' } = {}) {
  const events = [], state = { status, allowed, activity };
  const permission = () => ({ status: state.status, granted: state.status === 'granted' });
  const sdk = { __esModule: true, default: () => ({
    setRequestConfiguration: async config => assert.equal(config.maxAdContentRating, 'PG'),
    initialize: async () => { events.push('initialize'); },
  }), MaxAdContentRating: { PG: 'PG' }, TestIds: { NATIVE: 'google-test-native' },
  AdsConsentPrivacyOptionsRequirementStatus: { REQUIRED: 'REQUIRED' },
  AdsConsent: {
    gatherConsent: async () => { events.push('ump'); }, getConsentInfo: async () => ({ canRequestAds: state.allowed }),
    requestInfoUpdate: async () => { events.push('privacy-info'); return { privacyOptionsRequirementStatus: 'REQUIRED' }; },
    showPrivacyOptionsForm: async () => { events.push('privacy-form'); },
  } };
  const exports = {};
  vm.runInNewContext(source, { exports, __DEV__: false, process: { env: { EXPO_PUBLIC_ADS_MODE: mode } }, require(name) {
    if (name === 'expo-constants') return { __esModule: true, default: { executionEnvironment: expoGo ? 'go' : 'native' }, ExecutionEnvironment: { StoreClient: 'go' } };
    if (name === 'react-native') return { Platform: { OS: platform }, AppState: { get currentState() { return state.activity; } }, DeviceEventEmitter: { emit: () => { events.push('changed'); } } };
    if (name === 'expo-tracking-transparency') {
      events.push('tracking-module');
      if (trackingError) throw new Error('Tracking module unavailable');
      return { isAvailable: () => available, getTrackingPermissionsAsync: async () => permission(), requestTrackingPermissionsAsync: async () => {
        events.push('att'); state.status = answer; return permission();
      } };
    }
    if (name === 'react-native-google-mobile-ads') { events.push('ad-sdk'); return sdk; }
    throw new Error(name);
  } });
  return { ads: exports, sdk, events, state };
}

test('iOS awaits ATT before importing the ad SDK, UMP or initialization; parallel slots prompt once', async () => {
  const { ads, sdk, events } = load({ status: 'undetermined' });
  const results = await Promise.all([ads.prepareAds(), ads.prepareAds(), ads.showAdPrivacyOptions()]);
  assert.deepEqual(results, [sdk, sdk, true]);
  assert.equal(events.filter(e => e === 'att').length, 1);
  assert.equal(events.filter(e => e === 'initialize').length, 1);
  for (const event of ['ad-sdk', 'ump', 'initialize', 'privacy-info', 'privacy-form']) assert.ok(events.indexOf('att') < events.indexOf(event), event);
});

test('denied, restricted, unavailable and failed tracking permission never load the iOS ad SDK', async () => {
  for (const options of [{ status: 'denied' }, { status: 'undetermined', answer: 'denied' }, { available: false }, { trackingError: true }, { status: 'undetermined', activity: 'inactive' }]) {
    for (const mode of ['live', 'test']) {
      const { ads, events } = load({ ...options, mode });
      assert.equal(await ads.prepareAds(), null, JSON.stringify({ ...options, mode }));
      assert.equal(await ads.showAdPrivacyOptions(), false);
      assert.ok(!events.includes('ad-sdk'), 'no ad SDK access without ATT permission');
    }
  }
});

test('tracking permission is checked again after a system settings change', async () => {
  const { ads, sdk, state, events } = load({ status: 'denied' });
  assert.equal(await ads.prepareAds(), null);
  state.status = 'granted';
  assert.equal(await ads.prepareAds(), sdk);
  const imported = events.filter(e => e === 'ad-sdk').length;
  state.status = 'denied';
  assert.equal(await ads.prepareAds(), null, 'a cached initialized SDK cannot bypass revoked permission');
  assert.equal(await ads.showAdPrivacyOptions(), false);
  assert.equal(events.filter(e => e === 'ad-sdk').length, imported);
});

test('feed ads retain placement, UMP clearance, one initialization and privacy change notifications', async () => {
  const { ads, sdk, events, state } = load({ allowed: false });
  assert.deepEqual(Array.from({ length: 25 }, (_, i) => i).filter(ads.feedAdPosition), [5, 12, 19]);
  assert.equal(await ads.prepareAds(), null);
  assert.ok(!events.includes('initialize'));
  state.allowed = true;
  await ads.showAdPrivacyOptions();
  await Promise.all([ads.prepareAds(), ads.prepareAds()]);
  assert.equal(events.filter(e => e === 'initialize').length, 1);
  assert.equal(ads.feedAdUnit(sdk), 'ca-app-pub-2361293253164911/5616099773');
  state.allowed = false;
  await ads.showAdPrivacyOptions();
  assert.equal(await ads.prepareAds(), null);
  assert.equal(events.filter(e => e === 'changed').length, 2);
});

test('Android retains UMP without ATT; web and Expo Go never import native ad or tracking modules', async () => {
  const android = load({ platform: 'android' });
  assert.equal(await android.ads.prepareAds(), android.sdk);
  assert.ok(android.events.includes('ump'));
  assert.ok(!android.events.includes('tracking-module'));
  assert.equal(android.ads.feedAdUnit(android.sdk), 'ca-app-pub-2361293253164911/4669015468');
  for (const options of [{ platform: 'web' }, { expoGo: true }]) {
    const { ads, events } = load(options);
    assert.equal(await ads.prepareAds(), null);
    assert.equal(await ads.showAdPrivacyOptions(), false);
    assert.deepEqual(events, []);
  }
  for (const mode of ['test', '']) {
    const { ads, sdk, events } = load({ mode });
    assert.equal(ads.feedAdUnit(sdk), 'google-test-native');
    assert.equal(await ads.prepareAds(), sdk);
    assert.ok(!events.includes('ump'), 'demo units retain the existing test-mode boundary');
  }
});

test('native configuration includes localized ATT purpose, tracking disclosure and delayed ad measurement', () => {
  const { expo } = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const plugins = new Map(expo.plugins.filter(Array.isArray));
  const purpose = plugins.get('expo-tracking-transparency').userTrackingPermission;
  assert.match(purpose, /Google AdMob/);
  assert.match(purpose, /without allowing tracking/);
  for (const language of ['en', 'ko']) {
    const locale = JSON.parse(fs.readFileSync(new URL(`../${expo.locales[language]}`, import.meta.url), 'utf8'));
    assert.ok(locale.ios.NSUserTrackingUsageDescription.length > 30);
    if (language === 'en') assert.equal(locale.ios.NSUserTrackingUsageDescription, purpose);
  }
  assert.equal(plugins.get('react-native-google-mobile-ads').delayAppMeasurementInit, true);
  assert.equal(expo.ios.privacyManifests.NSPrivacyTracking, true);
  const identifier = expo.ios.privacyManifests.NSPrivacyCollectedDataTypes.find(type => type.NSPrivacyCollectedDataType === 'NSPrivacyCollectedDataTypeDeviceID');
  assert.equal(identifier.NSPrivacyCollectedDataTypeTracking, true);
  assert.ok(identifier.NSPrivacyCollectedDataTypePurposes.includes('NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising'));
});
