import { visibleMeetupBody } from './meetup-ai.ts';
import { postMapBody } from './post-maps.ts';
import { splitPostPhotoCredits } from './post-photo-credits.ts';
import { splitPostAttachments } from '../../supabase/functions/_shared/post-links.ts';

export type TranslationLanguage = 'ko' | 'en';
export type TranslationKind = 'post' | 'comment';
export type TranslationSource = { title: string | null; body: string };
export type TranslationRequest = {
  kind: TranslationKind; id: string; language: TranslationLanguage; source: TranslationSource;
};

export function validateTranslationRequest(value: unknown): TranslationRequest {
  if (!value || typeof value !== 'object') throw new Error('INVALID_INPUT');
  const input = value as Record<string, unknown>;
  const source = input.source as TranslationSource | undefined;
  if (!['post', 'comment'].includes(String(input.kind)) || !['ko', 'en'].includes(String(input.language))
    || typeof input.id !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.id)
    || !source || typeof source.body !== 'string' || source.body.length > 12000
    || (input.kind === 'post' ? typeof source.title !== 'string' || !source.title.trim() || source.title.length > 400 : source.title !== null)) {
    throw new Error('INVALID_INPUT');
  }
  return { kind: input.kind as TranslationKind, id: input.id, language: input.language as TranslationLanguage, source: { title: source.title, body: source.body } };
}

// Fixed lines the server writes into business post bodies (both naming generations). Shown through tr(), never machine-translated.
const BUSINESS_DISCLOSURES = new Set(['비즈니스에서 직접 게시한 안내입니다.', '비즈니스의 허락을 받아 글링에서 대신 게시한 안내입니다.', '업체에서 직접 게시한 안내입니다.', '업체의 허락을 받아 글링에서 대신 게시한 안내입니다.']);
export const businessDisclosureLines = (body: string) => body.split('\n').filter(line => BUSINESS_DISCLOSURES.has(line));
export const localizeBusinessDisclosure = (body: string, tr: (text: string) => string) =>
  body.split('\n').map(line => BUSINESS_DISCLOSURES.has(line) ? tr(line) : line).join('\n');

export function visibleTranslationSource(kind: TranslationKind, title: string | null, body: string, meetup = false): TranslationSource {
  if (kind === 'comment') return { title: null, body };
  const mapped = postMapBody(splitPostPhotoCredits(body).body).body;
  const visible = splitPostAttachments(meetup ? visibleMeetupBody(mapped) : mapped).body;
  return { title, body: businessDisclosureLines(visible).length ? visible.split('\n').filter(line => !BUSINESS_DISCLOSURES.has(line)).join('\n').trim() : visible };
}

export function needsContentTranslation(source: TranslationSource, language: TranslationLanguage) {
  const text = [source.title, source.body].filter(Boolean).join('\n')
    .replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]+|#[\p{L}\p{N}_]+/gu, '');
  const korean = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(text);
  return language === 'en' ? korean : /[A-Za-z]/.test(text);
}
