// Fixed lines the server writes into business post bodies (both naming generations). Shown through tr(), never machine-translated.
// Kept apart from translation-source so public web pages can use it without the meetup place catalog.
export const BUSINESS_DISCLOSURES = new Set(['비즈니스에서 직접 게시한 안내입니다.', '비즈니스의 허락을 받아 글링에서 대신 게시한 안내입니다.', '업체에서 직접 게시한 안내입니다.', '업체의 허락을 받아 글링에서 대신 게시한 안내입니다.']);
export const businessDisclosureLines = (body: string) => body.split('\n').filter(line => BUSINESS_DISCLOSURES.has(line));
export const localizeBusinessDisclosure = (body: string, tr: (text: string) => string) =>
  body.split('\n').map(line => BUSINESS_DISCLOSURES.has(line) ? tr(line) : line).join('\n');
