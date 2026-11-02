// Fixed lines the server writes into business post bodies (both naming generations). Shown through tr(), never machine-translated.
// Kept apart from translation-source so public web pages can use it without the meetup place catalog.
// Posts Gling wrote for a business (owner 2026-11-01): this app shows a mark by the author instead; the body keeps the line for older apps.
const PROXY_DISCLOSURES = new Set(['비즈니스의 허락을 받아 글링에서 대신 게시한 안내입니다.', '업체의 허락을 받아 글링에서 대신 게시한 안내입니다.']);
export const BUSINESS_DISCLOSURES = new Set(['비즈니스에서 직접 게시한 안내입니다.', '업체에서 직접 게시한 안내입니다.', ...PROXY_DISCLOSURES]);
export const businessDisclosureLines = (body: string) => body.split('\n').filter(line => BUSINESS_DISCLOSURES.has(line));
export const localizeBusinessDisclosure = (body: string, tr: (text: string) => string) =>
  body.split('\n').map(line => BUSINESS_DISCLOSURES.has(line) ? tr(line) : line).join('\n');
// Newer posts end with the line and older ones carry it near the top, so trimming drops the blank line it leaves.
export function splitProxyDisclosure(body: string) {
  const lines = body.split('\n'), kept = lines.filter(line => !PROXY_DISCLOSURES.has(line));
  return kept.length === lines.length ? { body, proxy: false } : { body: kept.join('\n').trim(), proxy: true };
}
