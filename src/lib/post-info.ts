import { instagramPostLink, safePostLink } from '../../supabase/functions/_shared/post-links.ts';

const CREDIT = /^(?:사진|사진 출처|출처|참고 릴스|참고|공간·사진 출처|Photos?|Sources?|Credits?)\s*[:：]/i;

// Hire posts open with "시급: …" / "근무: …"; place reviews with "글링 평점: 8.0/10" and end with their OSM reference.
const FACT = /^(시급|근무|Pay|Hours)\s*[:：]\s*(.{1,80})$/i;
const RATING = /^글링 평점:\s*(\d+(?:\.\d+)?)\/10$/;
const PLACE_REFERENCE = /^장소 후기:\s*https:\/\/www\.openstreetmap\.org\/(?:node|way|relation)\/[1-9]\d*$/;

// Authors type the place, bare links and credits at the end of the body; lift them out of the reading flow.
export function postInfoParts(body: string) {
  let place: string | null = null, rating: number | null = null;
  const links: string[] = [], credits: string[] = [], paragraphs: string[] = [], facts: { label: string; value: string }[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const pin = line.match(/^📍\s*(.{1,120})$/u)?.[1];
    if (pin && !place) { place = pin; continue; }
    const fact = line.match(FACT);
    if (fact && !facts.some(item => item.label === fact[1])) { facts.push({ label: fact[1], value: fact[2].trim() }); continue; }
    const score = line.match(RATING)?.[1];
    if (score && rating == null) { rating = Number(score); continue; }
    if (PLACE_REFERENCE.test(line)) continue;
    const link = instagramPostLink(line)?.url ?? safePostLink(line);
    if (link) { if (!links.includes(link)) links.push(link); continue; }
    if (CREDIT.test(line)) { credits.push(line); continue; }
    paragraphs.push(line);
  }
  return { paragraphs, place, links, credits, facts, rating };
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
