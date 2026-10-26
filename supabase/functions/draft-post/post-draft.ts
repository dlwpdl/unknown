// Shared by the draft-post function and the app, so both agree on the mode and the extra fields.
export const MAX_AI_IMAGES = 3;
export const SHORT_NOTE_MAX = 60;

// One short line ("이케아 책상 팔아요 40불") becomes a full post; anything longer is the writer's own draft to polish.
export function isShortNote(titleHint?: string | null, bodyHint?: string | null) {
  const text = [titleHint, bodyHint].map((value) => value?.trim() ?? '').filter(Boolean).join(' ');
  return !!text && text.length <= SHORT_NOTE_MAX && !/\n/.test(text);
}

export type DraftFieldSource = 'memo' | 'photo' | 'missing';
export type DraftField = { label: string; value: string; source: DraftFieldSource };

export const DRAFT_FIELDS_SCHEMA = {
  type: 'array',
  maxItems: 6,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['label', 'value', 'source'],
    properties: {
      label: { type: 'string', minLength: 1, maxLength: 20 },
      value: { type: 'string', maxLength: 80 },
      source: { type: 'string', enum: ['memo', 'photo', 'missing'] },
    },
  },
};

export function parseDraftFields(value: unknown): DraftField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { label, value: text, source } = item as Record<string, unknown>;
    if (typeof label !== 'string' || !label.trim() || typeof text !== 'string') return [];
    const known: DraftFieldSource = source === 'memo' || source === 'photo' ? source : 'missing';
    const trimmed = text.trim().slice(0, 80);
    return [{ label: label.trim().slice(0, 20), value: trimmed, source: trimmed ? known : 'missing' }];
  }).slice(0, 6);
}

// Fields are saved as plain lines on top of the body, so no new post columns and old apps still read them.
export function withDraftFields(body: string, fields: DraftField[]) {
  const lines = fields.filter(({ value }) => value.trim()).map(({ label, value }) => `${label}: ${value.trim()}`);
  return lines.length ? `${lines.join('\n')}\n\n${body}` : body;
}
