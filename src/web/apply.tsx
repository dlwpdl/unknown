import type { Metadata } from 'expo-router/server';

export { default } from '@/components/public-web/event-apply';

// Event apply links (/apply?event=…) are shared in Instagram DMs only: keep every one of them out of search.
export function generateMetadata(): Metadata {
  return { title: 'Gling event', description: 'Apply for a Gling event.', robots: 'noindex, nofollow' };
}
