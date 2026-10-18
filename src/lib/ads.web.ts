// The web bundle must not import the native advertising SDK.
import { parseWebAdConfig } from './adsense';
import { contentAdPosition } from './content-ad-placement';

export const webAdConfig = parseWebAdConfig({
  enabled: process.env.EXPO_PUBLIC_ADSENSE_ENABLED,
  client: process.env.EXPO_PUBLIC_ADSENSE_CLIENT,
  slot: process.env.EXPO_PUBLIC_ADSENSE_SLOT,
  origin: process.env.EXPO_PUBLIC_ADSENSE_ORIGIN,
  cmpId: process.env.EXPO_PUBLIC_ADSENSE_CMP_ID,
});
export const testAds = true;
export const adsSupported = webAdConfig !== null;
export const AD_PRIVACY_CHANGED = 'gling:ad-privacy-changed';
export const feedAdPosition = contentAdPosition;
export const prepareAds = async () => null;
export const showAdPrivacyOptions = async () => false;
export const feedAdUnit = () => '';
