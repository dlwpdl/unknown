import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { needsContentTranslation, protectTranslationSource, restoreTranslationSource, validateTranslationRequest, type TranslationRequest, type TranslationSource } from './translation-source.ts';

type DeviceTranslator = { translate(texts: string[], language: 'ko' | 'en'): Promise<string[]> };
const native = Platform.OS === 'web' ? null : requireOptionalNativeModule<DeviceTranslator>('GlingTranslation');
export const isDeviceTranslationSupported = () => !!native;
export const CONTENT_TRANSLATION_VIEWABILITY = { viewAreaCoveragePercentThreshold: 2, minimumViewTime: 250 };
type Job = { promise: Promise<TranslationSource>; controller: AbortController; readers: number; settled: boolean };
const pending = new Map<string, Job>(), cache = new Map<string, TranslationSource>();
let queue = Promise.resolve(), generation = 0;

export function resetContentTranslations() {
  generation++;
  pending.forEach(job => job.controller.abort());
  cache.clear();
}

export async function requestContentTranslation(viewerScope: string, input: TranslationRequest, signal?: AbortSignal): Promise<TranslationSource> {
  if (!viewerScope) throw new Error('AUTH_REQUIRED');
  if (!native) throw new Error('TRANSLATION_NOT_SUPPORTED');
  const request = validateTranslationRequest(input);
  if (signal?.aborted) throw new Error('TRANSLATION_CANCELLED');
  const key = JSON.stringify([viewerScope, request]);
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return { ...cached }; }
  let job = pending.get(key);
  if (!job || job.controller.signal.aborted) {
    if (pending.size >= 32) {
      const currentGeneration = generation;
      const available = Promise.race([...pending.values()].map(current => current.promise.then(() => {}, () => {})));
      let onAbort: (() => void) | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          onAbort = () => reject(new Error('TRANSLATION_CANCELLED'));
          signal?.addEventListener('abort', onAbort, { once: true });
          if (signal?.aborted) onAbort();
          void available.then(resolve);
        });
      } finally {
        if (onAbort) signal?.removeEventListener('abort', onAbort);
      }
      if (generation !== currentGeneration) throw new Error('TRANSLATION_CANCELLED');
      return requestContentTranslation(viewerScope, request, signal);
    }
    const controller = new AbortController();
    const promise = queue.then(() => translate(request, controller.signal));
    queue = promise.then(() => {}, () => {});
    job = { promise, controller, readers: 0, settled: false };
    pending.set(key, job);
    const current = job;
    const finish = () => { current.settled = true; if (pending.get(key) === current) pending.delete(key); };
    void promise.then(result => {
      if (!controller.signal.aborted) {
        cache.set(key, result);
        if (cache.size > 32) cache.delete(cache.keys().next().value!);
      }
      finish();
    }, finish);
  }
  const current = job;
  current.readers++;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<TranslationSource>((resolve, reject) => {
      onAbort = () => reject(new Error('TRANSLATION_CANCELLED'));
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      void current.promise.then(result => resolve({ ...result }), reject);
    });
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    current.readers--;
    void Promise.resolve().then(() => { if (!current.readers && !current.settled) current.controller.abort(); });
  }
}

async function translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationSource> {
  const check = () => { if (signal.aborted) throw new Error('TRANSLATION_CANCELLED'); };
  check();
  const protectedSource = protectTranslationSource(request.source);
  const token = new RegExp(`(⟦${protectedSource.prefix}\\d+⟧|\\r\\n|\\r|\\n)`, 'u');
  const fields = [protectedSource.source.title, protectedSource.source.body].map(text => text?.split(token) ?? null);
  const parts = fields.flatMap(field => field?.filter(part => part && !token.test(part) && needsContentTranslation({ title: null, body: part }, request.language)) ?? []);
  const output: string[] = [];
  try {
    for (let start = 0; start < parts.length; start += 256) {
      check();
      const batch = parts.slice(start, start + 256);
      const translated = await native!.translate(batch, request.language);
      check();
      if (!Array.isArray(translated) || translated.length !== batch.length || translated.some(text => typeof text !== 'string' || !text.trim() || text.length > 24000)) throw new Error();
      output.push(...translated.map((text, index) => {
        // ML Kit trims segment edges; keep the original spacing around protected values.
        const original = batch[index];
        return original.match(/^\s*/u)![0] + text.trim() + original.match(/\s*$/u)![0];
      }));
    }
    let cursor = 0;
    const restored = fields.map(field => field?.map(part => part && !token.test(part) && needsContentTranslation({ title: null, body: part }, request.language) ? output[cursor++] : part).join('') ?? null);
    return restoreTranslationSource({ title: restored[0], body: restored[1] }, protectedSource);
  } catch {
    check();
    throw new Error('TRANSLATION_UNAVAILABLE');
  }
}
