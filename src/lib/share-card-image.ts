import { requireOptionalNativeModule } from 'expo';

import type { ShareCardImageModules } from './share-card.ts';

/**
 * Loads the image modules only when this binary has them. A static import would crash an older binary running newer JS:
 * expo-sharing looks up its native module when it loads. Without RNViewShot, captureRef rejects and the caller shares text.
 */
export function shareCardImageModules(): ShareCardImageModules | null {
  if (!requireOptionalNativeModule('ExpoSharing')) return null;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports -- loaded lazily on purpose, see above */
    const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
    const { isAvailableAsync, shareAsync } = require('expo-sharing') as typeof import('expo-sharing');
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const rename = async (uri: string) => {
      const file = new File(uri);
      await file.move(new File(Paths.cache, 'gling-share-card.png'), { overwrite: true });
      return file.uri;
    };
    return { captureRef: captureRef as ShareCardImageModules['captureRef'], isAvailableAsync, shareAsync, rename };
  } catch {
    return null;
  }
}
