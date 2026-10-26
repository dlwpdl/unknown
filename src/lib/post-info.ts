import { instagramPostLink, safePostLink } from '../../supabase/functions/_shared/post-links.ts';

const CREDIT = /^(?:사진|사진 출처|출처|참고 릴스|참고|공간·사진 출처|Photos?|Sources?|Credits?)\s*[:：]/i;

// Authors type the place, bare links and credits at the end of the body; lift them out of the reading flow.
export function postInfoParts(body: string) {
  let place: string | null = null;
  const links: string[] = [], credits: string[] = [], paragraphs: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const pin = line.match(/^📍\s*(.{1,120})$/u)?.[1];
    if (pin && !place) { place = pin; continue; }
    const link = instagramPostLink(line)?.url ?? safePostLink(line);
    if (link) { if (!links.includes(link)) links.push(link); continue; }
    if (CREDIT.test(line)) { credits.push(line); continue; }
    paragraphs.push(line);
  }
  return { paragraphs, place, links, credits };
}

// Short row label: "@handle" for Instagram profiles, otherwise the host and first path segment.
export function postLinkLabel(url: string) {
  const instagram = instagramPostLink(url);
  if (instagram) return '@' + instagram.handle;
  const { hostname, pathname } = new URL(url);
  const segment = pathname.split('/').find(Boolean);
  const label = hostname.replace(/^www\./, '') + (segment ? '/' + segment : '');
  return label.length > 36 ? label.slice(0, 35) + '…' : label;
}
