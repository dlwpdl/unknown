import { splitPostAttachments, withPostAttachments } from '../../supabase/functions/_shared/post-links.ts';

export function googleMapsUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2048) return null;
    const host = url.hostname;
    const google = ['google.com', 'www.google.com', 'google.ca', 'www.google.ca', 'google.co.kr', 'www.google.co.kr'].includes(host);
    const maps = google && /^\/maps(?:\/|$)/.test(url.pathname);
    const shared = host === 'maps.app.goo.gl' && url.pathname.length > 1;
    const legacy = host === 'goo.gl' && /^\/maps\/.+/.test(url.pathname);
    return maps || shared || legacy || host === 'maps.google.com' ? url.href : null;
  } catch {
    return null;
  }
}

export function postLocationUrl(input: string, city = ''): string | null {
  const value = input.trim();
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const shared = googleMapsUrl(value);
  if (shared) return shared;
  if (/^[a-z][a-z\d+.-]*:|^(?:www\.|[^\s/]+\.[^\s/]+\/)/i.test(value)) return null;
  const query = [value, city.trim()].filter(Boolean).join(', ');
  return googleMapsUrl(`https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query })}`);
}

export type PostPin = { latitude: number; longitude: number; placeId?: string };

export function googlePinUrl(pin: PostPin): string {
  if (!Number.isFinite(pin.latitude) || Math.abs(pin.latitude) > 90 || !Number.isFinite(pin.longitude) || Math.abs(pin.longitude) > 180
    || (pin.placeId != null && !/^[A-Za-z0-9_-]{1,255}$/.test(pin.placeId))) throw new Error('INVALID_MAP_PIN');
  const query = new URLSearchParams({ api: '1', query: `${pin.latitude},${pin.longitude}` });
  if (pin.placeId) query.set('query_place_id', pin.placeId);
  return `https://www.google.com/maps/search/?${query}`;
}

export function googleMapsPin(input: string): PostPin | null {
  const safe = googleMapsUrl(input);
  if (!safe) return null;
  const url = new URL(safe), query = url.searchParams.get('query') ?? url.searchParams.get('q') ?? '';
  if (!/^-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?$/.test(query)) return null;
  const [latitude, longitude] = query.split(',').map(Number);
  const placeId = url.searchParams.get('query_place_id');
  const pin = { latitude, longitude, ...(placeId ? { placeId } : {}) };
  try { googlePinUrl(pin); return pin; } catch { return null; }
}

// shortcut: 한 글에 지도 하나를 본문에 보관, 여러 장소를 검색·관리하게 되면 별도 필드로 확장.
type PostMapOptions = { preserveWhitespace?: boolean };

export function postMapBody(body: string, { preserveWhitespace = false }: PostMapOptions = {}): { body: string; url: string | null; label?: string } {
  const attached = splitPostAttachments(body);
  let url: string | null = null;
  let label = '', previousMap = false;
  const lines: string[] = [];
  for (const line of attached.body.split(/\r?\n/)) {
    if (previousMap && /^위치: .{1,100}$/.test(line)) { label = line.slice(4); previousMap = false; continue; }
    previousMap = false;
    const candidate = googleMapsUrl(line.trim().replace(/^Google 지도:\s*/, ''));
    if (!candidate) { lines.push(line); continue; }
    url = candidate;
    label = '';
    previousMap = true;
    if (lines.at(-1) === '') lines.pop();
  }
  const text = lines.join('\n');
  return { body: url ? withPostAttachments(preserveWhitespace ? text : text.trim(), attached.urls) : body, url, ...(label ? { label } : {}) };
}

export function postPublicAddress(body: string): string | null {
  const mapped = postMapBody(body);
  if (!mapped.url) return null;
  const url = new URL(mapped.url);
  for (const candidate of [mapped.label, url.searchParams.get('query') ?? url.searchParams.get('q')]) {
    const text = candidate?.trim();
    if (!text || !/\p{L}/u.test(text) || /^(?:내 위치|선택한 위치|공개 위치|my location|selected location|public location)$/i.test(text)
      || /^\(?\s*[+-]?\d[\d.\s°º'′"″]*[NS]?\s*(?:,|\s)\s*[+-]?\d[\d.\s°º'′"″]*[EW]?\s*\)?$/i.test(text)
      || googleMapsUrl(text) || !postLocationUrl(text)) continue;
    return text;
  }
  return null;
}

export function withPostMap(body: string, input: string, label?: string, { preserveWhitespace = false }: PostMapOptions = {}): string {
  const url = input.trim() ? googleMapsUrl(input) : null;
  if (input.trim() && !url) throw new Error('INVALID_MAP_LINK');
  const mapped = postMapBody(body, { preserveWhitespace });
  const name = label ?? (url === mapped.url ? mapped.label : '') ?? '';
  if (name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('INVALID_MAP_LABEL');
  const clean = preserveWhitespace ? mapped.body : mapped.body.trim();
  const footer = clean.lastIndexOf('\n\n사진 출처·이용 조건\n');
  const position = footer < 0 ? clean.length : footer;
  const text = url ? `${clean.slice(0, position)}\n\nGoogle 지도: ${url}${name ? `\n위치: ${name}` : ''}${clean.slice(position)}` : preserveWhitespace ? body : body.trim();
  if ([...text].length > 4000) throw new Error('POST_BODY_TOO_LONG');
  return text;
}
