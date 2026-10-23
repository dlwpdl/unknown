import { serveBusinessMedia } from './business-media.ts';

type PreviewClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
type MediaClient = Parameters<typeof serveBusinessMedia>[1];
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const BUSINESS = /^business-post\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/0\/([0-9a-f]{32})$/i;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' };

// The same selected-cover validation is used by byte egress and both OG pages.
export function previewImageCover(path: unknown, id: string): { path: string; businessVersion?: string } | null {
  if (!UUID.test(id) || typeof path !== 'string' || path.length > 1000) return null;
  const business = BUSINESS.exec(path);
  if (business) return business[1].toLowerCase() === id.toLowerCase() ? { path, businessVersion: business[2] } : null;
  if (path.startsWith('business-') || !/\.(jpe?g|png|webp)$/i.test(path) || !path.includes('/')
    || !path.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..')) return null;
  return { path };
}

export async function servePreviewImage(request: Request, anonymous: PreviewClient, service: MediaClient): Promise<Response> {
  const fail = (status: number) => new Response(null, { status, headers: { ...headers, ...(status === 405 ? { Allow: 'GET, HEAD, OPTIONS' } : {}) } });
  if (request.method === 'OPTIONS') return fail(204);
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405);
  const params = new URL(request.url).searchParams, id = (params.get('id') ?? '').toLowerCase();
  if (params.get('format') !== 'preview-image' || params.size !== 2 || params.getAll('format').length !== 1
    || params.getAll('id').length !== 1 || !UUID.test(id)) return fail(400);
  try {
    const resolved = await anonymous.rpc('get_shared_link_preview', { p_post_id: id });
    if (resolved.error) return fail(503);
    const preview = resolved.data;
    if (!preview || typeof preview !== 'object' || Array.isArray(preview) || !('id' in preview) || preview.id !== id || !('imagePath' in preview)) return fail(404);
    const cover = previewImageCover(preview.imagePath, id);
    if (!cover) return fail(404);
    if (cover.businessVersion) {
      // Discard caller credentials; the existing business gate must resolve viewer=null, index=0.
      const query = new URLSearchParams({ format: 'business-image', id, kind: 'post', index: '0', v: cover.businessVersion });
      const response = await serveBusinessMedia(new Request(`https://media.invalid/?${query}`), service);
      if (response.status !== 200) return fail(response.status);
      return new Response(request.method === 'HEAD' ? null : response.body, { headers: { ...headers, 'Content-Type': response.headers.get('Content-Type')! } });
    }
    const downloaded = await service.storage.from('post-images').download(cover.path);
    if (downloaded.error || !downloaded.data) return fail(404);
    const file = downloaded.data;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) return fail(404);
    return new Response(request.method === 'HEAD' ? null : file, { headers: { ...headers, 'Content-Type': file.type } });
  } catch { return fail(503); }
}
