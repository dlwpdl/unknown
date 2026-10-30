// The English UI dictionary is large; web pages fetch it only when a reader switches to English.
export const loadUiEnglish = (): Promise<Record<string, string>> => import('./ui-en.ts').then(module => module.uiEnglish);
