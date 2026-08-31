import type { Post, Tag, TagSlug } from '@/lib/types';

export const DEFAULT_HASHTAGS: Record<TagSlug, readonly string[]> = {
  life: ['일상', '질문', '정보'],
  food: ['맛집', '카페', '가성비'],
  travel: ['여행', '나들이', '동행'],
  shopping: ['핫딜', '중고', '쇼핑'],
  settlement: ['이민', '유학', '워홀'],
  transport: ['차량', '교통', '운전'],
  housing: ['부동산', '렌트', '룸메'],
  education: ['학교', '학원', '어학'],
  meetup: ['모임', '취미', '운동'],
};

const DEFAULT_TRENDING = ['일상', '맛집', '여행', '핫딜', '워홀', '교통', '렌트', '어학', '모임'];

export const MAX_HASHTAGS = 5;

const HASHTAG_ALIASES: Record<string, string> = {
  burnaby: '버나비',
  coquitlam: '코퀴틀람',
  kitsilano: '킷실라노',
  langley: '랭리',
  mississauga: '미시사가',
  metrotown: '메트로타운',
  northyork: '노스욕',
  richmond: '리치몬드',
  surrey: '써리',
  downtown: '다운타운',
  koreatown: '코리아타운',
  libertyvillage: '리버티빌리지',
  코퀴틀럼: '코퀴틀람',
  커퀴틀람: '코퀴틀람',
};

type HashtagPost = Pick<Post, 'tag' | 'hashtags'>;

export function canonicalizeHashtag(value: string) {
  const normalized = value.normalize('NFKC').replace(/^#+/, '').trim().replace(/\s+/g, '');
  return HASHTAG_ALIASES[normalized.toLocaleLowerCase()] ?? normalized;
}

export function parseHashtags(input: string, limit = MAX_HASHTAGS) {
  const hashtags: string[] = [];
  const seen = new Set<string>();

  for (const raw of input.split(/[\s,#]+/)) {
    const value = canonicalizeHashtag(raw);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    hashtags.push(value);
    seen.add(key);
    if (hashtags.length === limit) break;
  }

  return hashtags;
}

export function getSuggestedHashtags(
  posts: HashtagPost[],
  category?: Pick<Tag, 'id' | 'slug'> | null,
  limit = 10,
) {
  const counts = new Map<string, { value: string; count: number; order: number }>();
  let order = 0;

  for (const post of posts) {
    if (category && post.tag.id !== category.id) continue;
    for (const raw of post.hashtags ?? []) {
      const value = canonicalizeHashtag(raw);
      if (!value) continue;
      const key = value.toLocaleLowerCase();
      const current = counts.get(key);
      counts.set(key, current ? { ...current, count: current.count + 1 } : { value, count: 1, order: order++ });
    }
  }

  const popular = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .map(({ value }) => value);
  const defaults = category ? DEFAULT_HASHTAGS[category.slug] : DEFAULT_TRENDING;

  return [...new Map([...popular, ...defaults].map((value) => [value.toLocaleLowerCase(), value])).values()].slice(0, limit);
}

export function addHashtag(input: string, hashtag: string) {
  return parseHashtags(`${input} ${hashtag}`).join(' ');
}

export function uniqueHashtags(values: readonly (string | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
