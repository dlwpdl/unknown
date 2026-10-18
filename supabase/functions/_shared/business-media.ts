// Keep this pure handler type-checkable in both Deno and the app toolchain.
type MediaClient = {
  auth: { getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: Record<string, unknown> | null; error: unknown }>;
  storage: { from(bucket: string): { download(path: string): Promise<{ data: Blob | null; error: unknown }> } };
};

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Referrer-Policy': 'no-referrer' };

export async function serveBusinessMedia(request: Request, client: MediaClient): Promise<Response> {
  const fail = (status: number) => new Response(null, { status, headers });
  if (request.method === 'OPTIONS') return fail(204);
  if (request.method !== 'GET') return fail(405);
  const params = new URL(request.url).searchParams;
  const id = params.get('id') ?? '', kind = params.get('kind'), position = params.get('index') ?? '0', version = params.get('v') ?? '';
  if (!UUID.test(id) || !['post', 'avatar', 'banner'].includes(kind ?? '') || !/^([0-9]|1[0-9])$/.test(position)
    || (kind !== 'post' && position !== '0') || !/^[0-9a-f]{32}$/i.test(version)) return fail(400);
  try {
    let viewer: string | null = null;
    const authorization = request.headers.get('Authorization');
    if (authorization) {
      if (!/^Bearer \S+$/i.test(authorization)) return fail(401);
      const auth = await client.auth.getUser(authorization.slice(7));
      if (auth.error || !auth.data.user) return fail(401);
      viewer = auth.data.user.id;
    }
    const resolved = await client.rpc('get_business_public_media', { p_id: id, p_kind: kind, p_index: Number(position), p_viewer: viewer });
    if (resolved.error) return fail(503);
    const media = resolved.data;
    const bucket = kind === 'post' ? 'post-images' : 'merchant-profile-images';
    if (!media || media.version !== version || media.bucket !== bucket
      || typeof media.path !== 'string' || media.path.length > 1000 || media.path.split('/').some((part: string) => !part || part === '.' || part === '..')) return fail(404);
    const downloaded = await client.storage.from(bucket).download(media.path);
    if (downloaded.error || !downloaded.data) return fail(404);
    const file = downloaded.data;
    if (!['image/webp', 'image/jpeg', 'image/png'].includes(file.type) || file.size > 20 * 1024 * 1024) return fail(404);
    return new Response(file, { headers: { ...headers, 'Content-Type': file.type } });
  } catch { return fail(503); }
}
