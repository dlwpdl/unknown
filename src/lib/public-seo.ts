export const PUBLIC_SITE = 'https://gling.ej-entertainment.com';
export const PUBLIC_SOURCE = 'https://wjvahbdwmctzpkndqaxa.supabase.co/functions/v1/public-post';

export function publicSiteName(language: 'ko' | 'en' = 'ko') {
  return language === 'en' ? 'Gling | Canada Meetup Community' : '글링 | 캐나다 모임 커뮤니티';
}

export function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function postSeo(post: {
  id: string; title: string; body: string; author: { nickname: string }; tag: { label: string };
  createdAt?: string; imageUris?: string[]; room?: unknown;
}, city = '', language: 'ko' | 'en' = 'ko') {
  const canonical = `${PUBLIC_SITE}/post?id=${encodeURIComponent(post.id)}`;
  const description = [city, post.tag.label, language === 'en' ? 'Sign in to read the full public post on the web.' : '로그인하면 공개 글의 전체 본문을 웹에서 읽을 수 있어요.'].filter(Boolean).join(' · ');
  const published = post.createdAt && Number.isFinite(Date.parse(post.createdAt)) ? new Date(post.createdAt).toISOString() : undefined;
  const images = post.imageUris?.filter(Boolean) ?? [];
  return {
    canonical, source: `${PUBLIC_SOURCE}?format=markdown&id=${encodeURIComponent(post.id)}`,
    title: `${post.title} | ${publicSiteName(language)}`, description, published,
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
