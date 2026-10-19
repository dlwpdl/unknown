export const MEETUP_DRAFT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['categorySlug', 'title', 'body', 'hashtags', 'purpose', 'activities', 'fit', 'preparation', 'applicationQuestion'],
  properties: {
    categorySlug: { type: 'string', enum: ['meetup'] },
    title: { type: 'string', minLength: 1, maxLength: 60 },
    body: { type: 'string', minLength: 1, maxLength: 1000 },
    hashtags: { type: 'array', maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 30 } },
    purpose: { type: 'string', minLength: 1, maxLength: 500 },
    activities: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 200 } },
    fit: { type: 'string', minLength: 1, maxLength: 500 },
    preparation: { type: 'array', maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 200 } },
    applicationQuestion: { type: 'string', minLength: 1, maxLength: 300 },
  },
};

export type MeetupAiDraft = {
  categorySlug: 'meetup'; title: string; body: string; hashtags: string[];
  purpose: string; activities: string[]; fit: string; preparation: string[]; applicationQuestion: string;
};

export function parseMeetupDraft(value: unknown): MeetupAiDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_AI_DRAFT');
  const draft = value as Record<string, unknown>;
  if (draft.categorySlug !== 'meetup' || Object.keys(draft).some(key => !MEETUP_DRAFT_SCHEMA.required.includes(key))) {
    throw new Error('INVALID_AI_DRAFT');
  }
  const text = (value: unknown, max: number) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('INVALID_AI_DRAFT');
    return value.trim();
  };
  const list = (value: unknown, min: number, max: number, length: number) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error('INVALID_AI_DRAFT');
    return value.map(item => text(item, length));
  };
  return {
    categorySlug: 'meetup', title: text(draft.title, 60), body: text(draft.body, 1000), hashtags: list(draft.hashtags, 0, 5, 30),
    purpose: text(draft.purpose, 500), activities: list(draft.activities, 1, 6, 200), fit: text(draft.fit, 500),
    preparation: list(draft.preparation, 0, 6, 200), applicationQuestion: text(draft.applicationQuestion, 300),
  };
}
