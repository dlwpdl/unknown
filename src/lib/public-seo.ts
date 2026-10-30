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

// Owner 2026-10-30: the same name belongs to an AI video editor; say plainly which Gling this is.
export const publicDisambiguation = 'Gling (글링) is a Korean community app for Vancouver, Toronto and Montreal — not the Gling AI video editor.';

// City × topic hubs live at /<city>/<slug>. Slugs reuse the tag slugs, except housing → rent (what people search for).
// meetup is left out (its posts are app-only and the city meetup page covers it).
export const TOPIC_HUBS: Record<string, { slug: string; name: (city: string) => string }> = {
  housing: { slug: 'rent', name: city => `${city} 한인 렌트·방 구하기` },
  jobs: { slug: 'jobs', name: city => `${city} 한인 구인구직` },
  used: { slug: 'used', name: city => `${city} 한인 중고거래` },
  food: { slug: 'food', name: city => `${city} 한인 맛집 이야기` },
  life: { slug: 'life', name: city => `${city} 한인 생활 이야기` },
  settlement: { slug: 'settlement', name: city => `${city} 한인 정착 이야기` },
  education: { slug: 'education', name: city => `${city} 한인 교육·학교 이야기` },
  travel: { slug: 'travel', name: city => `${city} 한인 여행 이야기` },
  shopping: { slug: 'shopping', name: city => `${city} 한인 쇼핑 이야기` },
  festival: { slug: 'festival', name: city => `${city} 한인 축제·공연 동행` },
  business: { slug: 'business', name: city => `${city} 한인 비즈니스 소식` },
};
export const MIN_TOPIC_HUB_POSTS = 5;
export const CITY_PAGE_SIZE = 30;

// Static subpages under a city: /vancouver/2 (older posts), /vancouver/rent (topic hub), /vancouver/meetups.
export function publicCitySubpage(path: string, cityIds: string[]) {
  const [, cityId, part] = path.replace(/\/$/, '').match(/^\/([a-z-]+)\/([a-z0-9-]+)$/) ?? [];
  if (!cityId || !cityIds.includes(cityId)) return null;
  if (part === 'meetups') return { cityId, kind: 'meetups' as const };
  if (/^[1-9][0-9]*$/.test(part) && part !== '1') return { cityId, kind: 'page' as const, page: Number(part) };
  const tagSlug = Object.keys(TOPIC_HUBS).find(key => TOPIC_HUBS[key].slug === part);
  return tagSlug ? { cityId, kind: 'topic' as const, tagSlug } : null;
}

// Title and description shared by the static page and the hydrated reader, so the head never changes after load.
export function publicCitySubpageMeta(sub: NonNullable<ReturnType<typeof publicCitySubpage>>, city: string) {
  if (sub.kind === 'meetups') return {
    title: `${city} 한인 모임 | 글링`,
    description: `${city}에 사는 한인들이 글링에서 여는 모임이에요. 일정과 참여 인원을 미리 보고, 참여 신청과 대화는 글링 앱에서 이어가요.`,
  };
  if (sub.kind === 'page') return {
    title: `${city} 한인 커뮤니티 · 지난 이야기 ${sub.page}쪽 | 글링`,
    description: `${city} 한인들이 글링에 올린 지난 이야기 ${sub.page}쪽이에요. 렌트, 구인구직, 중고거래, 맛집, 정착 이야기를 시간순으로 모았어요.`,
  };
  const name = TOPIC_HUBS[sub.tagSlug].name(city);
  return {
    title: `${name} | 글링`,
    description: `${name}. ${city}에 사는 한인들이 글링에 직접 올린 공개 글을 모았어요. 미리보기는 바로 보고, 로그인하면 전체 글을 읽을 수 있어요.`,
  };
}

export type PublicPostFacts = {
  id: string; title: string; city?: string | null; cityId?: string | null; label?: string | null; tagSlug?: string | null;
  text?: string | null; createdAt?: string | null; author?: string | null; authorIsBusiness?: boolean;
  commentCount?: number | null; imageUrl?: string | null;
};

// Search snippets under 70 characters say nothing; lead with city · topic and fill from the public preview.
export function publicPostDescription(post: PublicPostFacts) {
  const text = String(post.text ?? '').replace(/\s+/g, ' ').trim();
  const where = [post.city, post.label].filter(Boolean).join(' · ');
  let description = text.length >= 70 ? text : [where && `${where} |`, text && text !== post.title ? `${post.title} · ${text}` : post.title].filter(Boolean).join(' ');
  if (description.length < 70) description += ` ${post.city ? `${post.city} 한인들이` : '캐나다 한인들이'} 글링에 올린 이야기예요. 미리보기는 바로 보고, 로그인하면 전체 글을 읽을 수 있어요.`;
  return description.length > 160 ? `${description.slice(0, 159)}…` : description;
}

// One shape for the prerendered page and the hydrated landing: the post, then 글링 › city › topic.
export function publicPostSchema(post: PublicPostFacts, topicUrl?: string | null) {
  const url = publicPostUrl(post.id), cityUrl = post.cityId ? `${PUBLIC_SITE}/${post.cityId}` : null;
  const published = post.createdAt && Number.isFinite(Date.parse(post.createdAt)) ? new Date(post.createdAt).toISOString() : undefined;
  const crumbs = [
    { name: '글링', item: `${PUBLIC_SITE}/` },
    ...(cityUrl ? [{ name: `${post.city || post.cityId} 한인 커뮤니티`, item: cityUrl }] : []),
    ...(post.label ? [{ name: post.label, item: topicUrl || cityUrl || `${PUBLIC_SITE}/` }] : []),
  ];
  return {
    '@context': 'https://schema.org', '@graph': [
      {
        '@type': 'DiscussionForumPosting', '@id': `${url}#post`, url, mainEntityOfPage: url, headline: post.title, inLanguage: 'ko',
        ...(post.text ? { text: post.text } : {}), ...(published ? { datePublished: published } : {}),
        ...(post.author ? { author: { '@type': post.authorIsBusiness ? 'Organization' : 'Person', name: post.author } } : {}),
        ...(post.imageUrl ? { image: post.imageUrl } : {}), ...(post.label ? { articleSection: post.label } : {}),
        ...(Number.isSafeInteger(post.commentCount) && post.commentCount! >= 0 ? { interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: post.commentCount } } : {}),
        ...(cityUrl ? { isPartOf: { '@type': 'CollectionPage', '@id': cityUrl, url: cityUrl, name: `${post.city || post.cityId} 한인 커뮤니티` } } : {}),
      },
      { '@type': 'BreadcrumbList', itemListElement: crumbs.map((crumb, index) => ({ '@type': 'ListItem', position: index + 1, ...crumb })) },
    ],
  };
}
