import type { Metadata } from 'expo-router/server';
import { shareCoverUrl } from '@/components/public-web/metadata';
import { publicSiteName } from '@/lib/public-seo';

export { default } from '@/components/public-web/shared-post-landing';

export function generateMetadata(): Metadata {
  const title = `글링 공유 | ${publicSiteName()}`;
  const description = 'Google·소셜 로그인 후 전체 내용을 읽고, 앱에서 대화와 모임을 이어가세요.';
  return {
    title, description, robots: 'noindex, follow',
    // Crawlers that skip JS (KakaoTalk, iMessage) only see this static fallback cover.
    openGraph: { siteName: publicSiteName(), locale: 'ko_KR', title: '글링 공유', description, images: [{ url: shareCoverUrl('post'), width: 1200, height: 630, alt: '글링' }] },
    twitter: { card: 'summary_large_image', title: '글링 공유', description, images: [shareCoverUrl('post')] },
  };
}
