import { appPathForLink } from '@/lib/app-links';

// Universal Links / App Links arrive as https://gling.ej-entertainment.com/... and are mapped to app routes here.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try { return appPathForLink(path); } catch { return '/'; }
}
