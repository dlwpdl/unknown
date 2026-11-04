import { getShareExtensionKey } from 'expo-share-intent';

import { appPathForLink } from '@/lib/app-links';

// Universal Links / App Links arrive as https://gling.ej-entertainment.com/... and are mapped to app routes here.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    // The iOS share extension opens gling://dataUrl=glingShareKey…; that screen reads the shared text from the share context.
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return '/profile/import';
    const route = appPathForLink(path);
    // The compose tab became the map tab (owner 2026-11-01); old /compose links still open the writer on 오늘.
    return /^(?:gling:\/\/|\/)compose\/?(?:[?#]|$)/.test(route) ? '/?compose=1' : route;
  } catch { return '/'; }
}
