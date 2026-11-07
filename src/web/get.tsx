import type { Metadata } from 'expo-router/server';
import { publicMetadata } from '@/components/public-web/metadata';
import { PUBLIC_SITE } from '@/lib/public-seo';

export { default } from '@/components/public-web/get-app';

// /get only forwards to the stores (profile and campaign links): keep it out of search and the sitemap.
export function generateMetadata(): Metadata {
  return { ...publicMetadata('글링 앱 받기', '밴쿠버·토론토·몬트리올 한인이 동네 이야기를 나누고 모임을 찾는 앱이에요.', `${PUBLIC_SITE}/get`), robots: 'noindex, follow' };
}
