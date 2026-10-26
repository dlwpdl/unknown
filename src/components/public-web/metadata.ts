import type { Metadata } from 'expo-router/server';
import { PUBLIC_SITE, publicSiteName } from '@/lib/public-seo';

export const publicReaderDescription = '캐나다 모임 커뮤니티 글링에서 동네 이야기, 맛집, 비즈니스와 모임을 둘러보세요. 공유 미리보기를 둘러보고, 소셜 로그인 후 전체 내용과 모임을 확인해요.';

export function publicMetadata(title: string, description: string, canonical: string): Metadata {
  return {
    title, description, robots: 'index, follow, max-image-preview:large',
    alternates: { canonical },
    openGraph: { type: 'website', siteName: publicSiteName(), title, description, url: canonical, images: [{ url: `${PUBLIC_SITE}/share-covers/post.png`, alt: publicSiteName() }] },
    twitter: { card: 'summary_large_image', title, description, images: [`${PUBLIC_SITE}/share-covers/post.png`] },
  };
}

export const publicHomeSchema = {
  '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebSite', '@id': `${PUBLIC_SITE}/#website`, name: publicSiteName(), alternateName: [publicSiteName('en'), '글링', 'Gling'],
      url: `${PUBLIC_SITE}/`, description: publicReaderDescription, inLanguage: 'ko', publisher: { '@id': `${PUBLIC_SITE}/#organization` } },
    { '@type': 'Organization', '@id': `${PUBLIC_SITE}/#organization`, name: 'Gling', alternateName: '글링', url: `${PUBLIC_SITE}/`,
      logo: `${PUBLIC_SITE}/share-covers/post.png`, email: 'gling@ej-entertainment.com', areaServed: 'CA', sameAs: ['https://apps.apple.com/ca/app/id6809273242', 'https://www.instagram.com/gling.app/', 'https://www.threads.net/@gling.app'] },
    { '@type': 'MobileApplication', name: 'Gling', alternateName: '글링', operatingSystem: 'iOS', applicationCategory: 'SocialNetworkingApplication',
      url: 'https://apps.apple.com/ca/app/id6809273242', offers: { '@type': 'Offer', price: '0', priceCurrency: 'CAD' }, publisher: { '@id': `${PUBLIC_SITE}/#organization` } },
  ],
};

export function generatePrivateMetadata(): Metadata {
  return { title: '글링 | 앱에서 이어가기', robots: 'noindex, nofollow' };
}
