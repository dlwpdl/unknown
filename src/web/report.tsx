import type { Metadata } from 'expo-router/server';

export { default } from '@/components/public-web/event-report';

// A business's campaign report (/report#…): the token is in the fragment, and the page stays out of search and the sitemap.
export function generateMetadata(): Metadata {
  return { title: '크리에이터 캠페인 결과 · 글링', robots: 'noindex, nofollow', referrer: 'no-referrer' };
}
