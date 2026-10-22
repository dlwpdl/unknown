import { needsContentTranslation, validateTranslationRequest, type TranslationRequest, type TranslationSource } from './content-translation.ts';

type Claim = { state: 'cached' | 'claimed' | 'pending' | 'limited'; token?: string; translation?: TranslationSource };
export type TranslationClaim = TranslationRequest & { sourceHash: string; viewerId: string; characters: number };
export type TranslationServices = {
  viewer: () => Promise<{ id: string; active: boolean; consented: boolean } | null>;
  source: (input: TranslationRequest) => Promise<TranslationSource | null>;
  claim: (input: TranslationClaim) => Promise<Claim>;
  finish: (input: TranslationClaim, token: string, translation: TranslationSource) => Promise<boolean>;
  fail: (input: TranslationClaim, token: string) => Promise<void>;
  generate: (source: TranslationSource, language: TranslationRequest['language']) => Promise<TranslationSource>;
};
export const TRANSLATION_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...TRANSLATION_CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const error = (code: string, status: number) => json({ error: { code } }, status);

async function readInput(request: Request) {
  const max = 48 * 1024;
  if (Number(request.headers.get('content-length')) > max) throw new Error('REQUEST_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_INPUT');
  let bytes = 0, text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > max) { await reader.cancel(); throw new Error('REQUEST_TOO_LARGE'); }
      text += decoder.decode(part.value, { stream: true });
    }
    return validateTranslationRequest(JSON.parse(text + decoder.decode()));
  } finally { reader.releaseLock(); }
}

export async function handleContentTranslation(request: Request, service: TranslationServices): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: TRANSLATION_CORS });
  if (request.method !== 'POST') return error('METHOD_NOT_ALLOWED', 405);
  let input: TranslationRequest;
  try { input = await readInput(request); }
  catch (caught) { return error(caught instanceof Error && caught.message === 'REQUEST_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'INVALID_INPUT', caught instanceof Error && caught.message === 'REQUEST_TOO_LARGE' ? 413 : 400); }
  let claim: TranslationClaim | undefined, token: string | undefined, complete = false;
  try {
    const viewer = await service.viewer();
    if (!viewer) return error('AUTH_REQUIRED', 401);
    if (!viewer.active) return error('ACCOUNT_UNAVAILABLE', 403);
    if (!viewer.consented) return error('AI_CONSENT_REQUIRED', 403);
    const source = await service.source(input);
    if (!source) return error('CONTENT_UNAVAILABLE', 404);
    if (JSON.stringify(source) !== JSON.stringify(input.source)) return error('SOURCE_CHANGED', 409);
    const respond = (translation: TranslationSource) => json({ kind: input.kind, id: input.id, language: input.language, source, translation });
    if (!needsContentTranslation(source, input.language)) return respond(source);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([1, source])));
    const sourceHash = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    claim = { ...input, sourceHash, viewerId: viewer.id, characters: (source.title?.length ?? 0) + source.body.length };
    const result = await service.claim(claim);
    if (result.state === 'pending') return error('TRANSLATION_PENDING', 202);
    if (result.state === 'limited') return error('TRANSLATION_LIMIT_REACHED', 429);
    if (result.state !== 'cached' && (result.state !== 'claimed' || !result.token)) throw new Error('INVALID_CLAIM');
    token = result.token;
    const translation = result.state === 'cached' ? result.translation : await service.generate(source, input.language);
    if (!translation || typeof translation.body !== 'string' || translation.body.length > 12000
      || (source.title === null ? translation.title !== null : typeof translation.title !== 'string' || !translation.title.trim() || translation.title.length > 400)) {
      throw new Error('INVALID_TRANSLATION');
    }
    const current = await service.source(input);
    if (!current) return error('CONTENT_UNAVAILABLE', 404);
    if (JSON.stringify(source) !== JSON.stringify(current)) return error('SOURCE_CHANGED', 409);
    if (token && !await service.finish(claim, token, translation)) return error('SOURCE_CHANGED', 409);
    complete = true;
    return respond(translation);
  } catch { return error('TRANSLATION_UNAVAILABLE', 502); }
  finally {
    if (claim && token && !complete) await service.fail(claim, token).catch(() => {});
  }
}
