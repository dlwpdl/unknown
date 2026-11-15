import { normalizeInviteCode } from './invites.ts';
import { publicMerchantId } from './public-web.ts';
import { MEETUP_INVITE_TOKEN, sharedLinkTarget } from './sharing.ts';

const SITE = 'https://gling.ej-entertainment.com';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** The host's rotating check-in QR link: a session id and a one-time code the server checks. Lives here so the public page stays free of app RPCs. */
export function parseCheckInLink(params: { s?: unknown; c?: unknown }) {
  const s = typeof params.s === 'string' ? params.s.toLowerCase() : '', c = typeof params.c === 'string' ? params.c.toLowerCase() : '';
  return UUID.test(s) && /^[0-9a-f]{24}$/.test(c) ? { sessionId: s, code: c } : null;
}

/** Maps an incoming universal/app link on the public site to the app route; other system paths pass through. */
export function appPathForLink(input: string): string {
  let url: URL;
  try { url = new URL(input, SITE); } catch { return input; }
  // Only https links on the public site are claimed by associated domains; scheme links (gling://, OAuth) stay untouched.
  if (url.origin !== SITE || !/^(https:\/\/|\/)/i.test(input)) return input;
  const post = sharedLinkTarget(url.href);
  if (post) {
    const query = [post.invite ? 'invite=1' : '', post.code ? `code=${post.code}` : ''].filter(Boolean).join('&');
    return `/post/${post.id}${query ? `?${query}` : ''}`;
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const fullUrl = /^https:/i.test(input);
  if (path === '/company' || path.startsWith('/company/')) {
    const id = publicMerchantId(path, url.searchParams.getAll('id').length === 1 ? url.searchParams.get('id') : null);
    return id ? `/company/${id}` : '/businesses';
  }
  if (path === '/meetups') return '/meetups';
  if (path === '/invite') {
    const code = normalizeInviteCode(url.searchParams.get('code'));
    return code ? `/invite?code=${code}` : '/';
  }
  if (path === '/meetup-invite') {
    const token = url.searchParams.getAll('token');
    return token.length === 1 && MEETUP_INVITE_TOKEN.test(token[0]) ? `/meetup-invite?token=${token[0]}` : '/';
  }
  if (path === '/checkin') {
    const link = parseCheckInLink({ s: url.searchParams.get('s'), c: url.searchParams.get('c') });
    return link ? `/checkin?s=${link.sessionId}&c=${link.code}` : '/';
  }
  if (path === '/meetup-join') {
    const postId = url.searchParams.get('postId');
    const code = url.searchParams.getAll('code').length === 1 ? normalizeInviteCode(url.searchParams.get('code')) : null;
    return postId && UUID.test(postId) ? `/meetup-join?postId=${postId.toLowerCase()}${code ? `&code=${code}` : ''}` : '/';
  }
  // A full site URL we cannot open lands on home instead of an unmatched route; bare in-app paths keep their meaning.
  return fullUrl ? '/' : input;
}
