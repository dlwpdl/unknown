import { instagramPostLink, safePostLink } from '../../supabase/functions/_shared/post-links.ts';
import { EVENT_TIMEZONES, festivalLocalDay, type EventCity } from '../../supabase/functions/_shared/ticketmaster.ts';

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

// Festival titles end with the event day or range: "… · 2026.11.07", "… · 2026.11.06–15", "… · 2026.11.28–12.03" (QA I-home-06).
const EVENT_DAYS = /·\s*(\d{4})\.(\d{1,2})\.(\d{1,2})(?:\s*[–~-]\s*(?:(?:(\d{4})\.)?(\d{1,2})\.)?(\d{1,2}))?\s*$/;
const pad = (value: string | number) => String(value).padStart(2, '0');

// Some titles name the days in Korean, often without a year: "… — 10월 30일–11월 7일", "… 2026년 11월 7일" (QA I-home-06).
const KOREAN_DAYS = /(?:^|\D)(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일(?:\s*[–~-]\s*(?:(\d{1,2})월\s*)?(\d{1,2})일)?\s*$/;
const HALF_YEAR = 183 * 86_400_000;

/** The last day ('YYYY-MM-DD') a festival title names, or null when the title has no date.
 * A Korean date without a year takes the year that puts it within half a year of `posted` (the post's time, else now). */
export function eventLastDay(title: string, posted: string | number = Date.now()): string | null {
  const korean = title.trim().match(KOREAN_DAYS);
  if (korean) {
    const [, year, month, start, endMonth, end] = korean, lastMonth = Number(endMonth ?? month), lastDay = Number(end ?? start);
    const at = new Date(posted), reference = Number.isNaN(at.getTime()) ? new Date() : at;
    let lastYear = year ? Number(year) + (lastMonth < Number(month) ? 1 : 0) : reference.getUTCFullYear();
    if (!year) {
      const gap = Date.UTC(lastYear, lastMonth - 1, lastDay) - reference.getTime();
      lastYear += gap < -HALF_YEAR ? 1 : gap > HALF_YEAR ? -1 : 0;
    }
    return `${lastYear}-${pad(lastMonth)}-${pad(lastDay)}`;
  }
  const day = title.trim().match(EVENT_DAYS);
  if (!day) return null;
  const [, year, month, start, endYear, endMonth, end] = day;
  // A range that wraps into January ("2026.12.30–1.02") ends in the next year.
  const wraps = !endYear && Number(endMonth ?? month) < Number(month);
  return `${endYear ?? Number(year) + (wraps ? 1 : 0)}-${pad(endMonth ?? month)}-${pad(end ?? start)}`;
}

/** True for a festival post once its city's local day is after the last day its title names. */
export function isPastEvent(post: { title: string; cityId: string; tag: { slug: string }; createdAt?: string }, now = Date.now()) {
  const last = post.tag.slug === 'festival' && post.cityId in EVENT_TIMEZONES ? eventLastDay(post.title, post.createdAt ?? now) : null;
  return !!last && last < festivalLocalDay(post.cityId as EventCity, now);
}

const HANGUL = /\p{Script=Hangul}/u, LATIN = /\p{Script=Latin}/u;
/** A Korean post that repeats itself in English at the end splits into the Korean part and that English tail (QA I-post-06).
 * The tail must be at least half the Korean part's length, so a short English line (an opening-hours note) stays in place. */
export function englishTail(paragraphs: string[]) {
  let at = paragraphs.length;
  while (at > 0 && !HANGUL.test(paragraphs[at - 1]) && LATIN.test(paragraphs[at - 1])) at--;
  const main = paragraphs.slice(0, at), tail = paragraphs.slice(at);
  const length = (items: string[]) => items.reduce((sum, item) => sum + item.length, 0);
  return main.some(item => HANGUL.test(item)) && tail.length && length(tail) * 2 >= length(main) ? { main, tail } : null;
}
