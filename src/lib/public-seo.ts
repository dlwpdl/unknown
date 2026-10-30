export const PUBLIC_SITE = 'https://gling.ej-entertainment.com';
export const PUBLIC_SOURCE = 'https://wjvahbdwmctzpkndqaxa.supabase.co/functions/v1/public-post';

export function publicSiteName(language: 'ko' | 'en' = 'ko') {
  return language === 'en' ? 'Gling | Korean Community in Canada' : '글링 | 캐나다 한인 커뮤니티';
}

// Plain facts at the top of the prerendered home and city pages and llms.txt, for crawlers and AI answers.
export const publicAboutGling = '글링(Gling)은 밴쿠버·토론토·몬트리올에 사는 한인을 위한 무료 커뮤니티 앱이에요. 동네 이야기와 맛집, 렌트·구인·중고 거래, 축제·공연 동행과 소모임을 한곳에서 나누고, 한국어와 영어 글을 번역해서 볼 수 있어요. iPhone 앱은 App Store에서 받을 수 있고, Android는 비공개 테스트 중이에요.';
export const publicAboutGlingEn = 'Gling is a free community app for Koreans in Vancouver, Toronto and Montreal: neighbourhood stories, food spots, rentals, jobs and used goods, festival buddies and small-group meetups, with Korean–English translation. The iPhone app is on the App Store; Android is in closed testing.';

// Prerendered at build time (scripts/prerender-public-posts.mjs); `/post?id=` stays the noindex app shell.
export function publicPostUrl(id: string) {
  return `${PUBLIC_SITE}/posts/${encodeURIComponent(id.toLowerCase())}`;
}

export function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function postSeo(post: {
  id: string; title: string; body: string; author: { nickname: string }; tag: { label: string };
  createdAt?: string; imageUris?: string[]; room?: unknown;
}, city = '', language: 'ko' | 'en' = 'ko') {
  const canonical = publicPostUrl(post.id);
  const description = [city, post.tag.label, language === 'en' ? 'Sign in to read the full public post on the web.' : '로그인하면 공개 글의 전체 본문을 웹에서 읽을 수 있어요.'].filter(Boolean).join(' · ');
  const published = post.createdAt && Number.isFinite(Date.parse(post.createdAt)) ? new Date(post.createdAt).toISOString() : undefined;
  const images = post.imageUris?.filter(Boolean) ?? [];
  return {
    canonical, source: `${PUBLIC_SOURCE}?format=markdown&id=${encodeURIComponent(post.id)}`,
    title: `${post.title} | ${language === 'en' ? 'Gling' : '글링'}`, description, published,
    schema: {
      '@context': 'https://schema.org', '@type': 'WebPage', url: canonical, inLanguage: language,
      mainEntity: {
        '@type': 'WebPage', url: canonical, mainEntityOfPage: canonical,
        headline: post.title, articleSection: post.tag.label, inLanguage: language,
        ...(published ? { datePublished: published } : {}),
        ...(images.length ? { image: images } : {}),
      },
      breadcrumb: { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: publicSiteName(language), item: `${PUBLIC_SITE}/` },
        { '@type': 'ListItem', position: 2, name: post.title, item: canonical },
      ] },
    },
  };
}
