import type { Metadata } from 'expo-router/server';

export { default } from '@/components/public-web/event-partner';

// A business's private event page (/partner#…): the token is in the fragment, and the page stays out of search.
export function generateMetadata(): Metadata {
  return { title: 'Gling event', robots: 'noindex, nofollow', referrer: 'no-referrer' };
}
