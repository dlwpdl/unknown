const appOrigin = 'https://gling.ej-entertainment.com';
const previewOrigin = 'https://gling-share-preview.vercel.app';

export function buildSharedPostUrl(
  postId: string,
  appUrl = process.env.EXPO_PUBLIC_APP_URL,
  shareUrl = process.env.EXPO_PUBLIC_SHARE_URL,
) {
  const encodedId = encodeURIComponent(postId);
  // The preview gateway serves per-post metadata; authentication stays on the app site.
  if (shareUrl && !/^https:\/\/[^/]+\.supabase\.co\/functions\/v1\/public-post(?:[/?#]|$)/i.test(shareUrl)) {
    const base = shareUrl.replace(/\/+$/, '');
    return `${base}${base === `${previewOrigin}/share` ? '/' : '?id='}${encodedId}`;
  }
  const site = (appUrl || appOrigin).replace(/\/+$/, '');
  return site === appOrigin ? `${previewOrigin}/share/${encodedId}` : `${site}/post?id=${encodedId}`;
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function sharedLinkTarget(input: string) {
  try {
    const url = new URL(input);
    const origin = new URL(process.env.EXPO_PUBLIC_APP_URL || appOrigin).origin;
    const gateway = url.origin === previewOrigin;
    if (url.protocol !== 'https:' || (url.origin !== origin && !gateway) || url.username || url.password) return null;
    if (gateway && !/^\/share\/[^/]+\/?$/.test(url.pathname)) return null;
    const id = url.pathname === '/post' && url.searchParams.getAll('id').length === 1 ? url.searchParams.get('id')
      : url.pathname.match(/^\/(?:share|post)\/([^/]+)\/?$/)?.[1];
    return id && uuid.test(id) ? { id: id.toLowerCase(), invite: url.searchParams.get('invite') === '1' } : null;
  } catch { return null; }
}
export function sharedLinkInMessage(body: string) {
  return body.match(/https:\/\/[^\s<>]+/g)?.find(url => sharedLinkTarget(url)) ?? null;
}
export function sharedPostMessage(post: { id: string; title: string; room?: unknown }) {
  return `${post.room ? '같이 가요! ' : ''}${post.title}\n${buildSharedPostUrl(post.id)}`;
}

export const SHARED_POST_RETURN_KEY = 'gling.sharedPostReturn';
export function sharedPostReturnPath(value: string | null) {
  if (!value) return '/';
  try {
    const parsed = new URL(value, 'https://gling.ej-entertainment.com');
    const id = parsed.searchParams.get('id');
    if (parsed.origin !== 'https://gling.ej-entertainment.com' || parsed.pathname !== '/post' || parsed.searchParams.getAll('id').length !== 1 || !id || !uuid.test(id)) return '/';
    return `/post?id=${id.toLowerCase()}${parsed.searchParams.get('invite') === '1' ? '&invite=1' : ''}`;
  } catch { return '/'; }
}
