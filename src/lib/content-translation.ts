import { supabase } from '@/lib/supabase';
import { validateTranslationRequest, type TranslationRequest, type TranslationSource } from './translation-source.ts';

export const CONTENT_TRANSLATION_VIEWABILITY = { viewAreaCoveragePercentThreshold: 2, minimumViewTime: 250 };
type Job = { promise: Promise<TranslationSource>; controller: AbortController; readers: number; settled: boolean };
const pending = new Map<string, Job>(), cache = new Map<string, TranslationSource>();
let generation = 0;

export function resetContentTranslations() {
  generation++;
  pending.forEach(job => job.controller.abort());
  cache.clear();
}

export async function requestContentTranslation(viewerScope: string, input: TranslationRequest, signal?: AbortSignal): Promise<TranslationSource> {
  if (!viewerScope) throw new Error('AUTH_REQUIRED');
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
    const promise = translate(request, controller.signal);
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

// The server checks the text against the stored post, translates it once and shares the result with every viewer.
async function translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationSource> {
  const response = await supabase.functions.invoke('translate-content', { body: request, signal }).catch(() => null);
  if (signal.aborted) throw new Error('TRANSLATION_CANCELLED');
  const { data, error } = response ?? { data: null, error: true };
  const translation = data?.translation;
  if (error || !translation || typeof translation.body !== 'string' || !translation.body.trim()
    || (request.source.title === null ? translation.title !== null : typeof translation.title !== 'string')) {
    throw new Error('TRANSLATION_UNAVAILABLE');
  }
  return { title: translation.title, body: translation.body };
}
