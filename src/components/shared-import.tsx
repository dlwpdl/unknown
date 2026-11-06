import { usePathname, useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect } from 'react';

// A link or text shared to gling from another app (Instagram, Google Maps, Notes) opens the import screen (owner 2026-11-04 G3).
// The screen reads the text from the share context itself: a route param drops the line breaks of a shared note.
export function SharedImport() {
  const { hasShareIntent } = useShareIntentContext();
  const router = useRouter(), pathname = usePathname();
  useEffect(() => {
    // iOS already landed on the import screen through +native-intent; Android arrives wherever the app was.
    if (hasShareIntent && pathname !== '/profile/import') router.push('/profile/import');
  }, [hasShareIntent, pathname, router]);
  return null;
}
