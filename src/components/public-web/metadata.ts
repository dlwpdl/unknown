import type { Metadata } from 'expo-router/server';
import { PUBLIC_SITE } from '@/lib/public-seo';

export const publicReaderDescription = '캐나다 한인 커뮤니티 글링에서 동네 이야기, 맛집, 비즈니스와 모임을 둘러보세요. 공유 미리보기를 둘러보고, 소셜 로그인 후 전체 내용과 모임을 확인해요.';

export function publicMetadata(title: string, description: string, canonical: string): Metadata {
  return {
    title, description, robots: 'index, follow, max-image-preview:large',
    alternates: { canonical },
    openGraph: { type: 'website', siteName: '글링', title, description, url: canonical },
    twitter: { card: 'summary', title, description },
  };
}

export const publicHomeSchema = {
  '@context': 'https://schema.org', '@type': 'WebSite', name: '글링',
  url: `${PUBLIC_SITE}/`, description: publicReaderDescription, inLanguage: 'ko',
};

export function generatePrivateMetadata(): Metadata {
  return { title: '글링 | 앱에서 이어가기', robots: 'noindex, nofollow' };
}
