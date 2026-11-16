// One check for the /business form and the webshop-apply function; the table (20261112120000) repeats the same limits.
export type WebshopApplication = {
  placeKey: string | null; cityId: string | null; placeName: string;
  name: string; contact: string; email: string | null;
  webshop: 'yes' | 'no' | 'unknown'; webshopUrl: string | null;
  discount: '5' | '10' | '15_plus' | 'unknown'; source: 'place' | 'web';
};
export type ApplicationField = 'place' | 'name' | 'contact' | 'email' | 'webshop' | 'webshopUrl' | 'discount' | 'source';
export const APPLICATION_KEYS = ['placeKey', 'cityId', 'placeName', 'name', 'contact', 'email', 'webshop', 'webshopUrl', 'discount', 'source'] as const;
export const APPLICATION_LIMITS = { placeName: 200, name: 100, contact: 100, email: 254, webshopUrl: 2048 } as const;
const PLACE_KEY = /^osm:(?:node|way|relation):[1-9][0-9]{0,19}$/;
const CITY = /^[a-z]{2,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Trimmed, 1..max characters, no control characters (a mail subject or log line can never be split by input).
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

export function webshopUrlOk(value: string) {
  if (value.length > APPLICATION_LIMITS.webshopUrl || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && value.toLowerCase().startsWith('https://');
  } catch { return false; }
}

/** The fields that would be refused, in form order. Empty means the application can be sent. */
export function applicationProblems(value: Record<string, unknown>): ApplicationField[] {
  const problems: ApplicationField[] = [];
  // A picked map place carries its key and city; a typed name ('목록에 없어요') carries neither.
  const place = (value.placeKey === null && value.cityId === null)
    || (typeof value.placeKey === 'string' && PLACE_KEY.test(value.placeKey) && typeof value.cityId === 'string' && CITY.test(value.cityId));
  if (!place || !text(value.placeName, APPLICATION_LIMITS.placeName)) problems.push('place');
  if (!text(value.name, APPLICATION_LIMITS.name)) problems.push('name');
  if (!text(value.contact, APPLICATION_LIMITS.contact)) problems.push('contact');
  if (value.email !== null && !(typeof value.email === 'string' && value.email.length <= APPLICATION_LIMITS.email && EMAIL.test(value.email))) problems.push('email');
  if (!['yes', 'no', 'unknown'].includes(value.webshop as string)) problems.push('webshop');
  // A link only goes with "있어요"; the form drops it when the owner picks another answer.
  if (value.webshopUrl !== null && !(value.webshop === 'yes' && typeof value.webshopUrl === 'string' && webshopUrlOk(value.webshopUrl))) problems.push('webshopUrl');
  if (!['5', '10', '15_plus', 'unknown'].includes(value.discount as string)) problems.push('discount');
  if (value.source !== 'place' && value.source !== 'web') problems.push('source');
  return problems;
}
