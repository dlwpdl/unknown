import type { Metadata } from 'expo-router/server';
import { PUBLIC_SITE, publicAboutGling, publicDisambiguation, publicSiteName } from '@/lib/public-seo';

export const publicReaderDescription = '밴쿠버·토론토·몬트리올 한인 커뮤니티 글링에서 동네 이야기, 맛집, 렌트·구인·중고, 모임을 둘러보세요. 미리보기는 바로 보고, 로그인하면 전체 글을 읽을 수 있어요.';


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
    { '@type': 'WebSite', '@id': `${PUBLIC_SITE}/#website`, name: '글링', alternateName: [publicSiteName(), publicSiteName('en'), 'Gling'],
      url: `${PUBLIC_SITE}/`, description: publicReaderDescription, inLanguage: 'ko', publisher: { '@id': `${PUBLIC_SITE}/#organization` } },
    { '@type': 'Organization', '@id': `${PUBLIC_SITE}/#organization`, name: 'Gling', alternateName: '글링', url: `${PUBLIC_SITE}/`,
      logo: { '@type': 'ImageObject', url: `${PUBLIC_SITE}/gling-logo-512.png`, width: 512, height: 512 }, email: 'gling@ej-entertainment.com', areaServed: [{ '@type': 'City', name: 'Vancouver' }, { '@type': 'City', name: 'Toronto' }, { '@type': 'City', name: 'Montreal' }], description: `${publicAboutGling} ${publicDisambiguation}`, sameAs: ['https://apps.apple.com/ca/app/id6809273242', 'https://www.instagram.com/gling.app/', 'https://www.threads.net/@gling.app'] },
    { '@type': 'MobileApplication', name: 'Gling', alternateName: '글링', operatingSystem: 'iOS', applicationCategory: 'SocialNetworkingApplication',
      url: 'https://apps.apple.com/ca/app/id6809273242', offers: { '@type': 'Offer', price: '0', priceCurrency: 'CAD' }, publisher: { '@id': `${PUBLIC_SITE}/#organization` } },
  ],
};

export const FAQ_ITEMS: { question: string; answer: string }[] = [
  { question: '글링이 뭐예요?', answer: '밴쿠버·토론토·몬트리올에 사는 한인을 위한 커뮤니티 앱이에요. 동네 이야기(생활, 맛집, 여행, 쇼핑, 정착, 이사, 주거, 교육)를 나누고, 축제나 콘서트에 함께 갈 사람을 찾고, 파티·운동·취미·여행 모임을 만들고 참여할 수 있어요.' },
  { question: '가입하지 않고도 볼 수 있나요?', answer: '공개 게시판은 웹에서 미리보기로 둘러볼 수 있어요. 글 전체를 읽거나 댓글을 달고 모임에 참여하려면 로그인 후 앱에서 이용하세요.' },
  { question: '어떤 도시에서 쓸 수 있나요?', answer: '지금은 밴쿠버, 토론토, 몬트리올에서 쓸 수 있어요. 다른 도시는 사람이 모이는 대로 차례로 열어요.' },
  { question: '모임은 어떻게 찾고 참여하나요?', answer: '앱에서 모임 목록을 보고 참여할 수 있어요. 직접 모임을 만들 수도 있고, 축제나 콘서트 동행도 찾을 수 있어요.' },
  { question: '글은 한국어로만 써야 하나요?', answer: '아니요. 한국어와 영어로 모두 쓸 수 있고, 번역 보기로 다른 언어로 읽을 수 있어요.' },
  { question: '글링은 무료인가요?', answer: '무료로 쓸 수 있어요. 일부 기능은 인앱 구매가 있어요.' },
  { question: '캐나다 워홀러도 쓸 수 있나요?', answer: '네. 정착 정보나 동네 모임을 찾는 워홀러도 쓸 수 있어요. 집, 일자리, 생활 정보는 동네 이야기에서 나눠요.' },
];

export const publicFaqSchema = {
  '@context': 'https://schema.org', '@type': 'FAQPage', '@id': `${PUBLIC_SITE}/faq#faq`, url: `${PUBLIC_SITE}/faq`,
  name: '글링 자주 묻는 질문', inLanguage: 'ko',
  mainEntity: FAQ_ITEMS.map(item => ({
    '@type': 'Question', name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  })),
};

export function generatePrivateMetadata(): Metadata {
  return { title: '글링 | 앱에서 이어가기', robots: 'noindex, nofollow' };
}
