import Constants, { ExecutionEnvironment } from 'expo-constants';
import { DeviceEventEmitter, Platform } from 'react-native';

type AdSDK = typeof import('react-native-google-mobile-ads');
export const testAds = __DEV__ || process.env.EXPO_PUBLIC_ADS_MODE !== 'live';
export const adsSupported = Platform.OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
export const feedAdPosition = (index: number) => index >= 4 && (index - 4) % 10 === 0;
export const AD_PRIVACY_CHANGED = 'gling:ad-privacy-changed';
let initialization: Promise<AdSDK | null> | null = null;

export function prepareAds(): Promise<AdSDK | null> {
  if (!adsSupported) return Promise.resolve(null);
  if (!initialization) initialization = (async () => {
    const sdk = await import('react-native-google-mobile-ads');
    // Test builds only request Google's demo units; live requests require UMP clearance.
    if (!testAds) {
      try { await sdk.AdsConsent.gatherConsent(); } catch { /* Check the SDK's cached decision below. */ }
      if (!(await sdk.AdsConsent.getConsentInfo()).canRequestAds) return null;
    }
    await sdk.default().setRequestConfiguration({ maxAdContentRating: sdk.MaxAdContentRating.PG });
    await sdk.default().initialize();
    return sdk;
  })().catch((error) => { initialization = null; throw error; });
  return initialization;
}

export async function showAdPrivacyOptions() {
  if (!adsSupported || testAds) return false;
  const sdk = await import('react-native-google-mobile-ads');
  const info = await sdk.AdsConsent.requestInfoUpdate();
  if (info.privacyOptionsRequirementStatus !== sdk.AdsConsentPrivacyOptionsRequirementStatus.REQUIRED) return false;
  await sdk.AdsConsent.showPrivacyOptionsForm();
  initialization = null;
  DeviceEventEmitter.emit(AD_PRIVACY_CHANGED);
  return true;
}

export function feedAdUnit(sdk: AdSDK) {
  return testAds ? sdk.TestIds.NATIVE : Platform.OS === 'ios'
    ? 'ca-app-pub-2361293253164911/5616099773' : 'ca-app-pub-2361293253164911/4669015468';
}
