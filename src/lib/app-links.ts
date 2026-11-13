import { normalizeInviteCode } from './invites.ts';
import { publicMerchantId } from './public-web.ts';
import { MEETUP_INVITE_TOKEN, sharedLinkTarget } from './sharing.ts';

const SITE = 'https://gling.ej-entertainment.com';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Maps an incoming universal/app link on the public site to the app route; other system paths pass through. */
export function appPathForLink(input: string): string {
  let url: URL;
  try { url = new URL(input, SITE); } catch { return input; }
  // Only https links on the public site are claimed by associated domains; scheme links (gling://, OAuth) stay untouched.
  if (url.origin !== SITE || !/^(https:\/\/|\/)/i.test(input)) return input;
  const post = sharedLinkTarget(url.href);
  if (post) return `/post/${post.id}${post.invite ? '?invite=1' : ''}`;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const fullUrl = /^https:/i.test(input);
  if (path === '/company' || path.startsWith('/company/')) {
    const id = publicMerchantId(path, url.searchParams.getAll('id').length === 1 ? url.searchParams.get('id') : null);
    return id ? `/company/${id}` : '/businesses';
  }
  if (path === '/meetups') return '/meetups';
  // Place pages (/vancouver/places/node-123) keep the web slug; the place screen reads it back as osm:node:123.
  const place = path.match(/^\/([a-z-]+)\/places\/((?:node|way|relation)-[0-9]+)$/);
  if (place) return `/places/${place[2]}?cityId=${place[1]}`;
  if (path === '/invite') {
    const code = normalizeInviteCode(url.searchParams.get('code'));
    return code ? `/invite?code=${code}` : '/';
  }
  if (path === '/meetup-invite') {
    const token = url.searchParams.getAll('token');
    return token.length === 1 && MEETUP_INVITE_TOKEN.test(token[0]) ? `/meetup-invite?token=${token[0]}` : '/';
  }
  if (path === '/meetup-join') {
    const postId = url.searchParams.get('postId');
    return postId && UUID.test(postId) ? `/meetup-join?postId=${postId.toLowerCase()}` : '/';
  }
  // A full site URL we cannot open lands on home instead of an unmatched route; bare in-app paths keep their meaning.
  return fullUrl ? '/' : input;
}
