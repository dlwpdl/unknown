import { parseHashtags } from './hashtags.ts';
import type { TagSlug } from './types';
import { parseMeetupDraft, type MeetupAiDraft } from '../../supabase/functions/draft-post/meetup-draft.ts';

export type { MeetupAiDraft };
export const MEETUP_DRAFT_FIELDS = ['title', 'body', 'question'] as const;
export type MeetupDraftField = typeof MEETUP_DRAFT_FIELDS[number];
export type MeetupDraftFields = Record<MeetupDraftField, string>;
export type MeetupDraftRevision = Record<MeetupDraftField, number>;

export function parseMeetupAiDraftResponse(value: unknown): MeetupAiDraft {
  const draft = parseMeetupDraft(isRecord(value) ? value.draft : null);
  return { ...draft, hashtags: parseHashtags(draft.hashtags.join(' ')) };
}

export function meetupAiDraftFields(draft: MeetupAiDraft, language: 'ko' | 'en'): MeetupDraftFields {
  const labels = language === 'en' ? ['Purpose', 'Activities', 'Who it suits', 'Preparation'] : ['모임 목적', '함께할 활동', '이런 분과 맞아요', '준비할 것'];
  const sections = [draft.body, `${labels[0]}\n${draft.purpose}`, `${labels[1]}\n${draft.activities.map((activity, i) => `${i + 1}. ${activity}`).join('\n')}`, `${labels[2]}\n${draft.fit}`];
  if (draft.preparation.length) sections.push(`${labels[3]}\n${draft.preparation.map(item => `• ${item}`).join('\n')}`);
  return { title: draft.title, body: sections.join('\n\n'), question: draft.applicationQuestion };
}

export function meetupAiDraftChanges(fields: MeetupDraftFields, selected: Partial<Record<MeetupDraftField, boolean>>, baseline: MeetupDraftRevision, current: MeetupDraftRevision): Partial<MeetupDraftFields> {
  const changes: Partial<MeetupDraftFields> = {};
  for (const field of MEETUP_DRAFT_FIELDS) if (selected[field] && baseline[field] === current[field]) changes[field] = fields[field];
  return changes;
}

const CATEGORY_SLUGS = new Set<TagSlug>([
  'life',
  'festival',
  'food',
  'travel',
  'shopping',
  'settlement',
  'transport',
  'housing',
  'education',
  'business',
  'meetup',
  'jobs',
  'used',
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
