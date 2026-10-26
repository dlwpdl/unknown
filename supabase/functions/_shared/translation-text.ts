// Shared by the app and the translate-content Edge Function: values that must survive translation untouched.
type TranslationSource = { title: string | null; body: string };

// Numbers and prices stay visible so the model can keep grammar ("1 person", "3 people") around them.
const protectedValues = () => /https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]+|@[\p{L}\p{N}_.-]+|#[\p{L}\p{N}_]+/gu;

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
