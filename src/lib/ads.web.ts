// The web bundle must not import the native advertising SDK.
export const testAds = true;
export const adsSupported = false;
export const AD_PRIVACY_CHANGED = 'gling:ad-privacy-changed';
export const feedAdPosition = (_index: number) => false;
export const prepareAds = async () => null;
export const showAdPrivacyOptions = async () => false;
export const feedAdUnit = () => '';
