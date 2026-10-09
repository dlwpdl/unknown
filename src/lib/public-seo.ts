import { postMapBody } from './post-maps.ts';
import { visibleMeetupBody } from './meetup-ai.ts';

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
  const mapped = postMapBody(post.body);
  const body = post.room ? visibleMeetupBody(mapped.body) : mapped.body;
  const description = Array.from([city, post.tag.label, body.replace(/\s+/g, ' ').trim()].filter(Boolean).join(' · ')).slice(0, 160).join('');
  const published = post.createdAt && Number.isFinite(Date.parse(post.createdAt)) ? new Date(post.createdAt).toISOString() : undefined;
  return {
    canonical, source: `${PUBLIC_SOURCE}?format=markdown&id=${encodeURIComponent(post.id)}`,
    title: `${post.title} | 글링`, description, body, published, mapUrl: mapped.url,
    schema: {
      '@context': 'https://schema.org', '@type': 'WebPage', url: canonical, inLanguage: 'ko',
      mainEntity: {
        '@type': 'SocialMediaPosting', url: canonical, mainEntityOfPage: canonical,
        headline: post.title, text: body, articleSection: post.tag.label, inLanguage: 'ko',
        author: { '@type': 'Person', name: post.author.nickname },
        ...(published ? { datePublished: published } : {}),
        ...(post.imageUris?.length ? { image: post.imageUris } : {}),
      },
      breadcrumb: { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: '글링', item: `${PUBLIC_SITE}/` },
        { '@type': 'ListItem', position: 2, name: post.title, item: canonical },
      ] },
    },
  };
}
