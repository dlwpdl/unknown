export type PostLinkPart = { text: string; url?: string };

export const INSTAGRAM_LINK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/></svg>';

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

export function instagramPostLink(value: string): { url: string; handle: string } | null {
  const safe = safePostLink(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (!['instagram.com', 'www.instagram.com'].includes(url.hostname)) return null;
  const handle = url.pathname.match(/^\/([a-zA-Z0-9_](?:[a-zA-Z0-9_.]{0,28}[a-zA-Z0-9_])?)\/?$/)?.[1]?.toLowerCase();
  if (!handle || handle.includes('..') || ['accounts', 'oauth', 'redirect', 'linkshim', 'p', 'reel', 'reels', 'stories', 'explore', 'direct', 'tv', 'about', 'developer', 'developers', 'legal', 'privacy', 'terms', 'login', 'challenge', 'web', 'api'].includes(handle)) return null;
  return { url: `https://www.instagram.com/${handle}/`, handle };
}

// shortcut: readable URLs use existing body storage; move to a field if attachments need their own permissions.
export function splitPostAttachments(body: string): { body: string; urls: string[] } {
  const marker = '\n\n첨부 링크\n';
  let start = body.lastIndexOf(marker);
  let content = start + marker.length;
  if (start < 0 && body.startsWith(marker.slice(2))) { start = 0; content = marker.length - 2; }
  if (start < 0) return { body, urls: [] };
  const next = body.indexOf('\n\n', content);
  const end = next < 0 ? body.length : next;
  const urls = body.slice(content, end).split('\n').map(line => safePostLink(line));
  if (!urls.length || urls.some(url => !url)) return { body, urls: [] };
  return { body: body.slice(0, start) + body.slice(end), urls: urls as string[] };
}

export function withPostAttachments(body: string, urls: string[]): string {
  const clean = splitPostAttachments(body).body;
  const unique = [...new Set(urls.map(input => {
    const url = instagramPostLink(input)?.url ?? safePostLink(input);
    if (!url) throw new Error('INVALID_POST_LINK');
    return url;
  }))];
  if (!unique.length) return clean;
  // Insert before footers so existing map and photo-credit readers keep their boundaries.
  const footer = clean.search(/\n\n(?:Google 지도:|사진 출처·이용 조건\n)/);
  const position = footer < 0 ? clean.length : footer;
  return `${clean.slice(0, position)}\n\n첨부 링크\n${unique.join('\n')}${clean.slice(position)}`;
}

export function postLinkChecks(body: string): { text: string; url: string | null; verdict: 'blocked' | 'unverified' }[] {
  const destinations = new Map<number, string>();
  let offset = 0;
  for (const part of splitPostLinks(body)) {
    if (part.url) destinations.set(offset, part.url);
    offset += part.text.length;
  }
  return [...body.matchAll(/https?:\/\/[^\s<>"']+/gi)].map(match => {
    const url = destinations.get(match.index!) ?? null;
    return { text: match[0], url, verdict: url ? 'unverified' : 'blocked' };
  });
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
  const confirm = (label: string, url: string) => `<details class="post-link-confirm"><summary>${escape(label)}</summary><span class="post-link-disclosure"><span>${escape(url)}</span><small>악성 여부 미확인 · 외부 페이지로 이동해요.</small><a class="post-body-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="${escape(url)} 외부 페이지 열기">이동하기 ↗</a></span></details>`;
  const attached = splitPostAttachments(body);
  const text = splitPostLinks(attached.body).map(part => part.url
    ? instagramPostLink(part.url)
      ? `<a class="post-body-link" href="${escape(part.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escape(part.text)}</a>`
      : confirm(part.text, part.url)
    : escape(part.text)).join('');
  const attachments = attached.urls.map(url => {
    const profile = instagramPostLink(url);
    const target = profile?.url ?? url;
    const label = profile ? `@${profile.handle}` : url;
    return profile
      ? `<span class="post-link-row"><a class="post-body-link post-instagram-link" href="${escape(target)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="${escape(label)} · ${escape(new URL(target).hostname)} 외부 페이지 열기">${INSTAGRAM_LINK_SVG}<span class="post-instagram-label">${escape(label)}</span></a></span>`
      : `<span class="post-link-row">${confirm(label, target)}</span>`;
  }).join('');
  return text + (attachments ? `<span class="post-link-attachments">${attachments}</span>` : '');
}
