import { handleSharePreview } from './share-preview-worker.ts';
import { decodeSharedUuid } from '../src/lib/shared-uuid.ts';

declare const process: { env: Record<string, string | undefined> };

export default function sharePreview(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/_gling-share-preview') {
    const ids = url.searchParams.getAll('__gling_share_id');
    url.pathname = ids.length !== 1 ? '/share/invalid' : decodeSharedUuid(ids[0]) ? `/s/${ids[0]}`
      : /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ids[0]) ? `/share/${ids[0]}` : '/share/invalid';
    // Only the sharer's invite code survives the internal rewrite; the handler validates it again.
    const codes = url.searchParams.getAll('c');
    url.search = codes.length === 1 && /^[A-HJ-NP-Z2-9]{8}$/.test(codes[0]) ? `?c=${codes[0]}` : '';
    request = new Request(url, request);
  }
  return handleSharePreview(request, {
    APP_URL: process.env.APP_URL ?? '',
    SHARE_ORIGIN: process.env.SHARE_ORIGIN,
    SUPABASE_URL: process.env.SUPABASE_URL ?? '',
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
  });
}
