export type CafeBoard = { clubId: string; menuId: string; url: string };
export type CafeDraft = { title: string; body: string; original_url: string | null; image_paths: string[] };
export type CafeOutcome = { status: 'succeeded' | 'failed' | 'uncertain'; articleUrl: string | null; errorCode: string | null };
const IMAGE_LIMIT = 2 * 1024 * 1024;

export function parseCafeBoardUrl(raw: string): CafeBoard {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\s\\\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/.test(raw)
    || !raw.startsWith('https://cafe.naver.com/')) throw new Error('INVALID_NAVER_BOARD_URL');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('INVALID_NAVER_BOARD_URL'); }
  if (url.hostname !== 'cafe.naver.com' || url.username || url.password || url.port || url.hash) throw new Error('INVALID_NAVER_BOARD_URL');
  const path = /^\/f-e\/cafes\/([1-9]\d{0,9})\/menus\/([1-9]\d{0,8})\/?$/.exec(url.pathname);
  const legacy = url.pathname === '/ArticleList.nhn' && url.searchParams.getAll('search.clubid').length === 1 && url.searchParams.getAll('search.menuid').length === 1;
  const clubId = path?.[1] ?? (legacy ? url.searchParams.get('search.clubid') : null);
  const menuId = path?.[2] ?? (legacy ? url.searchParams.get('search.menuid') : null);
  if (!clubId || !menuId || !/^[1-9]\d{0,9}$/.test(clubId) || !/^[1-9]\d{0,8}$/.test(menuId)) throw new Error('INVALID_NAVER_BOARD_URL');
  return { clubId, menuId, url: `https://cafe.naver.com/f-e/cafes/${clubId}/menus/${menuId}` };
}

export function cafeArticleReceipt(value: unknown): string | null {
  const message = (value as { message?: { status?: unknown; result?: { articleId?: unknown; cafeUrl?: unknown; articleUrl?: unknown } } })?.message;
  const result = message?.result;
  if (String(message?.status) !== '200' || !result || !Number.isSafeInteger(result.articleId) || Number(result.articleId) <= 0
    || typeof result.cafeUrl !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(result.cafeUrl)
    || result.articleUrl !== `https://cafe.naver.com/${result.cafeUrl}/${result.articleId}`) return null;
  return result.articleUrl as string;
}

const html = (text: string) => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);

export async function validCafePhoto(photo: Blob): Promise<boolean> {
  if (!photo.size || photo.size > IMAGE_LIMIT || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) return false;
  const bytes = new Uint8Array(await photo.slice(0, 12).arrayBuffer());
  if (photo.type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (photo.type === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
}

export async function cafeMultipart(draft: CafeDraft, photos: Blob[]): Promise<FormData> {
  if (photos.length > 6 || photos.length !== draft.image_paths.length) throw new Error('NAVER_PHOTOS_CHANGED');
  const form = new FormData();
  // Official multipart examples encode each text field once; FormData supplies the boundary.
  form.append('subject', encodeURIComponent(draft.title));
  form.append('content', encodeURIComponent(html(draft.body).replace(/\r?\n/g, '<br>') + (draft.original_url ? '<br><br>' + html(draft.original_url) : '')));
  form.append('openyn', 'false');
  form.append('searchopen', 'false');
  form.append('ccl', 'false');
  for (let index = 0; index < photos.length; index++) {
    const photo = photos[index];
    if (!await validCafePhoto(photo)) throw new Error('NAVER_INVALID_PHOTO');
    const extension = photo.type === 'image/jpeg' ? 'jpg' : photo.type === 'image/png' ? 'png' : 'webp';
    form.append('image', photo, `photo-${index + 1}.${extension}`);
  }
  return form;
}

export async function submitCafeArticle(board: Pick<CafeBoard, 'clubId' | 'menuId'>, draft: CafeDraft, photos: Blob[], accessToken: string, fetcher: typeof fetch = fetch): Promise<CafeOutcome> {
  const form = await cafeMultipart(draft, photos);
  try {
    const response = await fetcher(`https://openapi.naver.com/v1/cafe/${board.clubId}/menu/${board.menuId}/articles`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form,
      redirect: 'error', signal: AbortSignal.timeout(20_000),
    });
    const value = await response.json().catch(() => null);
    const articleUrl = response.ok ? cafeArticleReceipt(value) : null;
    if (articleUrl) return { status: 'succeeded', articleUrl, errorCode: null };
    const code = value?.message?.error?.code;
    if ([400, 401, 403, 429].includes(response.status) && typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)) {
      return { status: 'failed', articleUrl: null, errorCode: code };
    }
  } catch { /* A missing response cannot prove whether the provider saved the article. */ }
  return { status: 'uncertain', articleUrl: null, errorCode: 'NAVER_PUBLISH_UNCERTAIN' };
}

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
async function tokenKey(key: string) {
  const bytes = decode(key);
  if (bytes.length !== 32) throw new Error('NAVER_NOT_CONFIGURED');
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export async function encryptCafeTokens(value: { access_token: string; refresh_token: string }, key: string, binding: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(binding) }, await tokenKey(key), new TextEncoder().encode(JSON.stringify(value)));
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function decryptCafeTokens(encrypted: string, key: string, binding: string): Promise<{ access_token: string; refresh_token: string }> {
  const parts = encrypted.split('.');
  if (parts.length !== 2 || encrypted.length > 20000) throw new Error('NAVER_RECONNECT_REQUIRED');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(parts[0]), additionalData: new TextEncoder().encode(binding) }, await tokenKey(key), decode(parts[1]));
  const tokens = JSON.parse(new TextDecoder().decode(plain));
  if (typeof tokens.access_token !== 'string' || !tokens.access_token || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) throw new Error('NAVER_RECONNECT_REQUIRED');
  return tokens;
}
export async function cafeStateHash(state: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
