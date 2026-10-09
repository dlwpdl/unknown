export type PostLinkPart = { text: string; url?: string };

export function safePostLink(value: string): string | null {
  try {
    const text = value.trim();
    if (text.length > 2048 || /[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\\]/.test(text)) return null;
    const authority = text.match(/^https:\/\/([^/?#]+)/i)?.[1];
    if (!authority || /[^\x21-\x7e]|%/.test(authority)) return null;
    const url = new URL(text), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host)
      || /(^|\.)xn--|\.(local|internal|localhost|onion|lan|home|arpa)$/.test(host)
      || /^(www\.)?(bit\.ly|t\.co|tinyurl\.com|shorturl\.at|rb\.gy)$/.test(host)) return null;
    if (host.includes('instagram') && host !== 'instagram.com' && host !== 'www.instagram.com') return null;
    if ((host === 'instagram.com' || host === 'www.instagram.com')
      && /^\/(accounts|oauth|redirect|linkshim|l\.php)(\/|$)/i.test(decodeURIComponent(url.pathname))) return null;
    return url.href;
  } catch { return null; }
}

// Only visible, full addresses become links; an arbitrary label never hides the destination.
export function splitPostLinks(body: string): PostLinkPart[] {
  const parts: PostLinkPart[] = [];
  let offset = 0;
  for (const match of body.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const start = match.index!;
    let text = match[0].replace(/[.,!?;:，。！？]+$/, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (text.endsWith(close) && text.split(close).length > text.split(open).length) text = text.slice(0, -1);
    }
    const before = body.slice(0, start);
    const url = before.endsWith('](') ? null : safePostLink(text);
    if (!url) continue;
    if (/(?:인스타(?:그램)?|instagram|insta)\s*[:：]\s*$/i.test(before.split('\n').at(-1)!)
      && !['instagram.com', 'www.instagram.com'].includes(new URL(url).hostname)) continue;
    if (start > offset) parts.push({ text: body.slice(offset, start) });
    parts.push({ text, url });
    offset = start + text.length;
  }
  if (offset < body.length || !parts.length) parts.push({ text: body.slice(offset) });
  return parts;
}

export function postLinksHtml(body: string): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return splitPostLinks(body).map(part => part.url
    ? `<a class="post-body-link" href="${escape(part.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escape(part.text)}</a>`
    : escape(part.text)).join('');
}
