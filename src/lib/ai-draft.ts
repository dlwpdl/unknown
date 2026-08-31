import { parseHashtags } from './hashtags.ts';
import type { TagSlug } from './types';

const CATEGORY_SLUGS = new Set<TagSlug>([
  'life',
  'food',
  'travel',
  'shopping',
  'settlement',
  'transport',
  'housing',
  'education',
  'meetup',
]);

export type AiDraft = {
  categorySlug: TagSlug;
  title: string;
  body: string;
  hashtags: string[];
};

export function parseAiDraftResponse(value: unknown): AiDraft {
  const draft = isRecord(value) && isRecord(value.draft) ? value.draft : null;
  if (
    !draft ||
    typeof draft.categorySlug !== 'string' ||
    !CATEGORY_SLUGS.has(draft.categorySlug as TagSlug) ||
    typeof draft.title !== 'string' ||
    typeof draft.body !== 'string' ||
    !Array.isArray(draft.hashtags)
  ) {
    throw new Error('INVALID_AI_DRAFT');
  }

  const title = draft.title.trim().slice(0, 80);
  const body = draft.body.trim().slice(0, 4000);
  if (!title || !body || !draft.hashtags.every((item) => typeof item === 'string')) {
    throw new Error('INVALID_AI_DRAFT');
  }

  return {
    categorySlug: draft.categorySlug as TagSlug,
    title,
    body,
    hashtags: parseHashtags(draft.hashtags.join(' ')),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
