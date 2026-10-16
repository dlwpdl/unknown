import { en } from './en.ts';
import { t as ko, type Translations } from './ko.ts';
import type { AppLanguage } from './language.ts';

export { count } from './ko.ts';
let activeLanguage: AppLanguage = 'ko';
const englishText = new Map<string, string>();
function collect(source: unknown, translated: unknown) {
  if (typeof source === 'string' && typeof translated === 'string') englishText.set(source, translated);
  else if (source && translated && typeof source === 'object' && typeof translated === 'object') {
    for (const key of Object.keys(source)) collect((source as Record<string, unknown>)[key], (translated as Record<string, unknown>)[key]);
  }
}
collect(ko, en);

export function setActiveLanguage(language: AppLanguage) { activeLanguage = language; }
export function translationsFor(language: AppLanguage): Translations { return language === 'en' ? en : ko; }
export function translateUi(language: AppLanguage, text: string, ...values: unknown[]) {
  const translated = language === 'en' ? englishText.get(text) ?? text : text;
  return translated.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);
}
export function tr(text: string, ...values: unknown[]) { return translateUi(activeLanguage, text, ...values); }
export function getLocale() { return activeLanguage === 'ko' ? 'ko-KR' : 'en-CA'; }
// Non-React helpers read the same language; UI consumers subscribe through useLanguage().
export const t = new Proxy(ko as Translations, { get: (_, key: keyof Translations) => translationsFor(activeLanguage)[key] });
