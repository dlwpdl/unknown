import { normalizeInviteCode } from './invites.ts';
import { decodeSharedUuid, encodeSharedUuid } from './shared-uuid.ts';
import { tr } from '../i18n/index.ts';

const appOrigin = 'https://gling.ej-entertainment.com';
const previewOrigin = 'https://gling-share-preview.vercel.app';

export function buildSharedPostUrl(
  postId: string,
  appUrl = process.env.EXPO_PUBLIC_APP_URL,
  shareUrl = process.env.EXPO_PUBLIC_SHARE_URL,
) {
  const encodedId = encodeURIComponent(postId);
  const short = encodeSharedUuid(postId);
  const gatewayUrl = `${previewOrigin}/${short ? `s/${short}` : `share/${encodedId}`}`;
  // The preview gateway serves per-post metadata; authentication stays on the app site.
  if (shareUrl && !/^https:\/\/[^/]+\.supabase\.co\/functions\/v1\/public-post(?:[/?#]|$)/i.test(shareUrl)) {
    const base = shareUrl.replace(/\/+$/, '');
    if (base === `${previewOrigin}/share` || base === `${previewOrigin}/s`) return gatewayUrl;
    return `${base}?id=${encodedId}`;
  }
  const site = (appUrl || appOrigin).replace(/\/+$/, '');
  return site === appOrigin ? gatewayUrl : `${site}/post?id=${encodedId}`;
}

// The sharer's personal invite code rides on a meetup link so the existing invite reward follows it (owner 2026-11-13):
// `c` on the short preview link, `code` on the app site.
export function withInviteCode(url: string, code: string | null | undefined) {
  const valid = normalizeInviteCode(code);
  if (!valid) return url;
  const parsed = new URL(url);
  parsed.searchParams.set(parsed.origin === previewOrigin ? 'c' : 'code', valid);
  return parsed.href;
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const linkCode = (url: URL, key: string): { code?: string } => {
  const codes = url.searchParams.getAll(key);
  const code = codes.length === 1 ? normalizeInviteCode(codes[0]) : null;
  return code ? { code } : {};
};
export function sharedLinkTarget(input: string) {
  try {
    const url = new URL(input);
    const origin = new URL(process.env.EXPO_PUBLIC_APP_URL || appOrigin).origin;
    const gateway = url.origin === previewOrigin;
    if (url.protocol !== 'https:' || (url.origin !== origin && !gateway) || url.username || url.password) return null;
    if (gateway && !/^\/(?:share|s)\/[^/]+\/?$/.test(url.pathname)) return null;
    const short = gateway && url.pathname.match(/^\/s\/([^/]+)\/?$/);
    if (short) {
      const id = decodeSharedUuid(short[1]);
      return id ? { id, invite: url.searchParams.get('invite') === '1', ...linkCode(url, 'c') } : null;
    }
    const id = url.pathname === '/post' && url.searchParams.getAll('id').length === 1 ? url.searchParams.get('id')
      : url.pathname.match(/^\/(?:share|posts?)\/([^/]+)\/?$/)?.[1];
    return id && uuid.test(id) ? { id: id.toLowerCase(), invite: url.searchParams.get('invite') === '1', ...linkCode(url, 'code') } : null;
  } catch { return null; }
}
export function sharedLinkInMessage(body: string) {
  return body.match(/https:\/\/[^\s<>]+/g)?.find(url => sharedLinkTarget(url)) ?? null;
}
// place: the Gling map place the post is pinned to (mapPinPlace), on its own line under the title (owner 2026-11-11).
export function sharedPostMessage(post: { id: string; title: string; room?: unknown; place?: string | null }, inviteCode?: string | null) {
  return `${post.room ? `${tr('같이 가요!')} ` : ''}${post.title}\n${post.place ? `${post.place}\n` : ''}${withInviteCode(buildSharedPostUrl(post.id), post.room ? inviteCode : null)}`;
}

// Invite meetup links (20261108120000): the token is the whole secret, so it never goes through the share preview.
export const MEETUP_INVITE_TOKEN = /^[0-9a-f]{32}$/;
export function meetupInviteUrl(token: string, appUrl = process.env.EXPO_PUBLIC_APP_URL) {
  return `${(appUrl || appOrigin).replace(/\/+$/, '')}/meetup-invite?token=${encodeURIComponent(token)}`;
}
export function meetupInviteMessage(title: string, token: string) {
  return `${tr('같이 가요!')} ${title}\n${meetupInviteUrl(token)}`;
}

export const SHARED_POST_RETURN_KEY = 'gling.sharedPostReturn';
export function sharedPostReturnPath(value: string | null) {
  if (!value) return '/';
  try {
    const parsed = new URL(value, 'https://gling.ej-entertainment.com');
    if (parsed.origin === 'https://gling.ej-entertainment.com' && parsed.pathname === '/meetup-invite') {
      const token = parsed.searchParams.getAll('token');
      return token.length === 1 && MEETUP_INVITE_TOKEN.test(token[0]) ? `/meetup-invite?token=${token[0]}` : '/';
    }
    // The logged-out meetup join screen (meetup-join.tsx) returns to itself after web sign-in.
    const join = parsed.pathname === '/meetup-join', key = join ? 'postId' : 'id';
    const id = parsed.searchParams.get(key);
    if (parsed.origin !== 'https://gling.ej-entertainment.com' || (!join && parsed.pathname !== '/post') || parsed.searchParams.getAll(key).length !== 1 || !id || !uuid.test(id)) return '/';
    const code = linkCode(parsed, 'code').code, tail = code ? `&code=${code}` : '';
    if (join) return `/meetup-join?postId=${id.toLowerCase()}${tail}`;
    return `/post?id=${id.toLowerCase()}${parsed.searchParams.get('invite') === '1' ? '&invite=1' : ''}${tail}`;
  } catch { return '/'; }
}
