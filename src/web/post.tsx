import type { Metadata } from 'expo-router/server';
import { publicSiteName } from '@/lib/public-seo';

export { default } from '@/components/public-web/shared-post-landing';

export function generateMetadata(): Metadata {
  const title = `글링 공유 | ${publicSiteName()}`;
  const description = 'Google·소셜 로그인 후 전체 내용을 읽고, 앱에서 대화와 모임을 이어가세요.';
  return {
    title, description, robots: 'noindex, follow',
    openGraph: { siteName: publicSiteName(), title: '글링 공유', description },
  };
}
