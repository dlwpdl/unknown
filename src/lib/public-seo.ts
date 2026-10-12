export const PUBLIC_SITE = 'https://gling.ej-entertainment.com';
export const PUBLIC_SOURCE = 'https://wjvahbdwmctzpkndqaxa.supabase.co/functions/v1/public-post';

export function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function postSeo(post: {
  id: string; title: string; body: string; author: { nickname: string }; tag: { label: string };
  createdAt?: string; imageUris?: string[]; room?: unknown;
}, city = '') {
  const canonical = `${PUBLIC_SITE}/post?id=${encodeURIComponent(post.id)}`;
  const description = [city, post.tag.label, '로그인 후 전체 내용을 확인해요.'].filter(Boolean).join(' · ');
  const published = post.createdAt && Number.isFinite(Date.parse(post.createdAt)) ? new Date(post.createdAt).toISOString() : undefined;
  const images = post.imageUris?.filter(Boolean) ?? [];
  return {
    canonical, source: `${PUBLIC_SOURCE}?format=markdown&id=${encodeURIComponent(post.id)}`,
    title: `${post.title} | 글링`, description, published,
    schema: {
      '@context': 'https://schema.org', '@type': 'WebPage', url: canonical, inLanguage: 'ko',
      mainEntity: {
        '@type': 'WebPage', url: canonical, mainEntityOfPage: canonical,
        headline: post.title, articleSection: post.tag.label, inLanguage: 'ko',
        ...(published ? { datePublished: published } : {}),
        ...(images.length ? { image: images } : {}),
      },
      breadcrumb: { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: '글링', item: `${PUBLIC_SITE}/` },
        { '@type': 'ListItem', position: 2, name: post.title, item: canonical },
      ] },
    },
  };
}
