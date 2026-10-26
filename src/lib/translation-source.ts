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

export function visibleTranslationSource(kind: TranslationKind, title: string | null, body: string, meetup = false): TranslationSource {
  if (kind === 'comment') return { title: null, body };
  const mapped = postMapBody(splitPostPhotoCredits(body).body).body;
  return { title, body: splitPostAttachments(meetup ? visibleMeetupBody(mapped) : mapped).body };
}

export function needsContentTranslation(source: TranslationSource, language: TranslationLanguage) {
  const text = [source.title, source.body].filter(Boolean).join('\n')
    .replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]+|#[\p{L}\p{N}_]+/gu, '');
  const korean = text.match(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+/g)?.length ?? 0;
  // A Korean reader reads brand and place names in English fine; offer translation only when English carries the post.
  return language === 'en' ? korean > 0 : (text.match(/[A-Za-z]{2,}/g)?.length ?? 0) >= Math.max(korean, 1);
}

const protectedValues = () => /https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]+|@[\p{L}\p{N}_.-]+|#[\p{L}\p{N}_]+|(?:CA\$|C\$|US\$|\$|€|£|₩)\s*\d+(?:[.,]\d+)*|\d+(?:[.,:/-]\d+)*/gu;

export function protectTranslationSource(original: TranslationSource) {
  let prefix = 'GLING_VALUE_';
  while (JSON.stringify(original).includes(prefix)) prefix += '_';
  const values: string[] = [];
  const protect = (text: string) => text.replace(protectedValues(), (value) => {
    const token = '⟦' + prefix + values.length + '⟧';
    values.push(value);
    return token;
  });
  return { source: { title: original.title === null ? null : protect(original.title), body: protect(original.body) }, values, prefix };
}

export function restoreTranslationSource(value: unknown, protectedSource: ReturnType<typeof protectTranslationSource>): TranslationSource {
  if (!value || typeof value !== 'object') throw new Error('INVALID_TRANSLATION');
  const output = value as TranslationSource;
  const restore = (text: unknown, original: string, max: number) => {
    if (typeof text !== 'string' || text.length > max || (original.trim() && !text.trim())) throw new Error('INVALID_TRANSLATION');
    const tokens = (s: string) => (s.match(/⟦[^⟧]*⟧/g) ?? []).sort();
    if (JSON.stringify(tokens(text)) !== JSON.stringify(tokens(original))
      || protectedValues().test(text.replace(/⟦[^⟧]*⟧/g, ''))) throw new Error('INVALID_TRANSLATION');
    return text.replace(/⟦[^⟧]*⟧/g, (token) => {
      const index = Number(token.slice(('⟦' + protectedSource.prefix).length, -1));
      if (!token.startsWith('⟦' + protectedSource.prefix) || !Number.isInteger(index) || index < 0 || index >= protectedSource.values.length) {
        throw new Error('INVALID_TRANSLATION');
      }
      return protectedSource.values[index];
    });
  };
  const title = protectedSource.source.title === null
    ? output.title === null ? null : (() => { throw new Error('INVALID_TRANSLATION'); })()
    : restore(output.title, protectedSource.source.title, 400);
  return { title, body: restore(output.body, protectedSource.source.body, 12000) };
}
