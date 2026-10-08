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

// shortcut: 한 글에 지도 하나를 본문에 보관, 여러 장소를 검색·관리하게 되면 별도 필드로 확장.
export function postMapBody(body: string): { body: string; url: string | null } {
  let url: string | null = null;
  const lines = body.split(/\r?\n/).filter((line) => {
    const candidate = googleMapsUrl(line.trim().replace(/^Google 지도:\s*/, ''));
    if (!candidate) return true;
    url = candidate;
    return false;
  });
  return { body: url ? lines.join('\n').trim() : body, url };
}

export function withPostMap(body: string, input: string): string {
  const url = input.trim() ? googleMapsUrl(input) : null;
  if (input.trim() && !url) throw new Error('INVALID_MAP_LINK');
  const text = url ? `${postMapBody(body).body.trim()}\n\nGoogle 지도: ${url}` : body.trim();
  if ([...text].length > 4000) throw new Error('POST_BODY_TOO_LONG');
  return text;
}
