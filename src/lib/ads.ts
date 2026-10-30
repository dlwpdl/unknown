import Constants, { ExecutionEnvironment } from 'expo-constants';
import { AppState, DeviceEventEmitter, Platform } from 'react-native';

import { launchSettled } from '@/lib/launch-state';

type AdSDK = typeof import('react-native-google-mobile-ads');
export const testAds = __DEV__ || process.env.EXPO_PUBLIC_ADS_MODE !== 'live';
export const adsSupported = Platform.OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
// Keep the current owner-approved native cadence independent of web short-list checks.
export const feedAdPosition = (index: number, _total?: number) => index >= 3 && (index - 3) % 4 === 0;
export const AD_PRIVACY_CHANGED = 'gling:ad-privacy-changed';
let initialization: Promise<AdSDK | null> | null = null;
let trackingPermission: Promise<boolean> | null = null;

async function trackingAllowed(): Promise<boolean> {
  if (Platform.OS !== 'ios') return true;
  await launchSettled;
  if (AppState.currentState !== 'active') return false;
  if (!trackingPermission) trackingPermission = (async () => {
    const tracking = await import('expo-tracking-transparency');
    if (!tracking.isAvailable()) return false;
    let permission = await tracking.getTrackingPermissionsAsync();
    if (permission.status === 'undetermined') permission = await tracking.requestTrackingPermissionsAsync();
    return permission.granted;
  })().catch(() => false).finally(() => { trackingPermission = null; });
  return trackingPermission;
}

export async function prepareAds(): Promise<AdSDK | null> {
  if (!adsSupported || !(await trackingAllowed())) return null;
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
  if (!adsSupported || testAds || !(await trackingAllowed())) return false;
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
