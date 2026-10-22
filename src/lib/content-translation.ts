import type { SupabaseClient } from '@supabase/supabase-js';
import { protectTranslationSource, type TranslationRequest, type TranslationSource } from '../../supabase/functions/_shared/content-translation.ts';

let activeRequests = 0;
const waiting: (() => void)[] = [];
type PendingTranslation = { promise: Promise<TranslationSource>; controller: AbortController; readers: number; settled: boolean };
const pendingByClient = new WeakMap<object, Map<string, PendingTranslation>>();
const safeCodes = new Set(['AUTH_REQUIRED', 'ACCOUNT_UNAVAILABLE', 'AI_CONSENT_REQUIRED', 'CONTENT_UNAVAILABLE', 'SOURCE_CHANGED', 'TRANSLATION_PENDING', 'TRANSLATION_LIMIT_REACHED']);
export const CONTENT_TRANSLATION_VIEWABILITY = { viewAreaCoveragePercentThreshold: 2, minimumViewTime: 250 };

export async function requestContentTranslation(
  client: Pick<SupabaseClient, 'functions'>, viewerScope: string, request: TranslationRequest, signal?: AbortSignal,
): Promise<TranslationSource> {
  if (!viewerScope) throw new Error('AUTH_REQUIRED');
  if (signal?.aborted) throw new Error('TRANSLATION_CANCELLED');
  let pending = pendingByClient.get(client);
  if (!pending) { pending = new Map(); pendingByClient.set(client, pending); }
  const key = JSON.stringify([viewerScope, request]);
  let job = pending.get(key);
  if (!job || job.controller.signal.aborted) {
    const controller = new AbortController();
    job = { promise: invokeTranslation(client, request, controller.signal), controller, readers: 0, settled: false };
    pending.set(key, job);
    const current = job;
    const finish = () => { current.settled = true; if (pending!.get(key) === current) pending!.delete(key); };
    void job.promise.then(finish, finish);
  }
  job.readers++;
  const current = job;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<TranslationSource>((resolve, reject) => {
      onAbort = () => reject(new Error('TRANSLATION_CANCELLED'));
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      void current.promise.then(resolve, reject);
    });
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    current.readers--;
    // Let a detail view take over the same request when its feed card leaves view.
    void Promise.resolve().then(() => { if (!current.readers && !current.settled) current.controller.abort(); });
  }
}

async function invokeTranslation(
  client: Pick<SupabaseClient, 'functions'>, request: TranslationRequest, signal: AbortSignal,
): Promise<TranslationSource> {
  if (activeRequests >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  else activeRequests++;
  try {
    if (signal?.aborted) throw new Error('TRANSLATION_CANCELLED');
    const { data, error } = await client.functions.invoke('translate-content', { body: request, signal, timeout: 25000 });
    let result = data;
    if (error) {
      try { result = await error.context?.json(); } catch { /* Deployment/network errors have no public error body. */ }
    }
    if (result?.error?.code) throw new Error(safeCodes.has(result.error.code) ? result.error.code : 'TRANSLATION_UNAVAILABLE');
    const output = result?.translation;
    if (error || result?.kind !== request.kind || result?.id !== request.id || result?.language !== request.language
      || JSON.stringify(result?.source) !== JSON.stringify(request.source)
      || !output || typeof output.body !== 'string' || output.body.length > 12000
      || (request.source.title === null ? output.title !== null : typeof output.title !== 'string' || !output.title.trim() || output.title.length > 400)
      || JSON.stringify(protectTranslationSource(output).values.sort()) !== JSON.stringify(protectTranslationSource(request.source).values.sort())) {
      throw new Error('TRANSLATION_UNAVAILABLE');
    }
    return { title: output.title, body: output.body };
  } finally {
    const next = waiting.shift();
    if (next) next();
    else activeRequests--;
  }
}
