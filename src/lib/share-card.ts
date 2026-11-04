import type { CityPlace } from './city-places.ts';
import type { AppLanguage } from '../i18n/language.ts';
import { translateUi } from '../i18n/index.ts';
import { merchantMapsUrl } from './merchant-source.ts';

/** 9:16 card in points. Drawn at this width it captures as the 1080×1920 Instagram story image at 3x. */
export const SHARE_CARD_SIZE = { width: 360, height: 640 } as const;
/** The shared image file: an Instagram story frame in pixels. */
export const SHARE_CARD_PIXELS = { width: 1080, height: 1920 } as const;
export type ShareCardTone = 'dark' | 'light';
export type ShareCardCity = { name: string; englishName: string; province: string };
export type ShareCardItem = { name: string; photo: CityPlace | null };
/** Only what the app really has: no price, rating, opening state or save count. */
export type ShareCard = {
  kind: 'place' | 'list';
  eyebrow: string; title: string; badge: string | null;
  photo: CityPlace | null; items: ShareCardItem[]; more: string | null; empty: string | null;
  credit: string | null; sender: string | null; footer: string;
  label: string; message: string;
};

const LIST_ROWS = 3;

/** One line, cut by code point so a long name never pushes the card past 9:16. */
export function clampShareText(value: string, max: number) {
  const chars = Array.from(value.replace(/\s+/g, ' ').trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : chars.join('');
}

/** The member's own profile nickname only; operated personas (app_metadata.gling_persona) never sign a card. */
export function shareCardSenderName(nickname: string | null | undefined, appMetadata: Record<string, unknown> | null | undefined) {
  if (!nickname?.trim() || !appMetadata || Object.hasOwn(appMetadata, 'gling_persona')) return null;
  return clampShareText(nickname, 20);
}

// Only the licensed catalog photo leaves the app; a business's own map photo was not uploaded for outside sharing.
const licensedPhoto = (place: CityPlace) => place.photo ? { ...place, mapPhotoUri: undefined } : null;

// Same facts the place screen credits (artist, licence, Openverse note); an image file cannot carry the links.
function credit(places: (CityPlace | null)[], t: (text: string, ...values: unknown[]) => string) {
  const photos = [...new Map(places.flatMap(place => place?.photo ? [[place.photo.imageSha256, place.photo]] : [])).values()];
  if (!photos.length) return null;
  const line = t('사진: {0}', photos.map(photo => `${t(photo.artist)} · ${photo.license}`).join(' / '));
  return photos.some(photo => photo.discoveredVia === 'Openverse') ? `${line}\n${t('Openverse로 찾은 사진 · Openverse는 이 서비스를 인증하거나 보증하지 않아요.')}` : line;
}

const category = (place: CityPlace, t: (text: string) => string) => place.category === 'food' ? t('맛집') : place.category === 'cafe' ? t('카페') : t('가볼 만한 곳');

export function placeShareCard(place: CityPlace, city: ShareCardCity, language: AppLanguage, sender: string | null = null): ShareCard {
  const t = (text: string, ...values: unknown[]) => translateUi(language, text, ...values);
  const title = clampShareText(place.name, 60), eyebrow = category(place, t), cityName = t(city.name), photo = licensedPhoto(place);
  const signed = sender ? t('{0}님이 공유했어요', sender) : null;
  const maps = merchantMapsUrl([place.name, place.address, city.englishName, city.province, 'Canada'].filter(Boolean).join(', '));
  return {
    kind: 'place', eyebrow, title, badge: cityName, photo, items: [], more: null, empty: null,
    credit: credit([photo], t), sender: signed, footer: t('글링 지도에서 볼 수 있어요'),
    label: [t('공유 카드'), title, eyebrow, cityName, signed].filter(Boolean).join(', '),
    message: [place.name.trim(), `${eyebrow} · ${cityName}`, maps].filter(Boolean).join('\n'),
  };
}

/** `count` is how many places the list holds; null when the caller has not loaded them all, so no number is shown. */
export function listShareCard(name: string, places: CityPlace[], count: number | null, language: AppLanguage, sender: string | null = null): ShareCard {
  const t = (text: string, ...values: unknown[]) => translateUi(language, text, ...values);
  const title = clampShareText(name, 40), total = count === null ? null : Math.max(count, places.length);
  const items = places.slice(0, LIST_ROWS).map(place => ({ name: clampShareText(place.name, 40), photo: licensedPhoto(place) }));
  const rest = total === null ? 0 : total - items.length, restAll = total === null ? 0 : total - places.length;
  const badge = total === null ? null : t(total === 1 ? '장소 1곳' : '장소 {0}곳', total), signed = sender ? t('{0}님이 공유했어요', sender) : null;
  return {
    kind: 'list', eyebrow: t('장소 목록'), title, badge, photo: null, items,
    more: rest > 0 ? t('외 {0}곳', rest) : null, empty: places.length ? null : t('아직 담긴 장소가 없어요'),
    credit: credit(items.map(item => item.photo), t), sender: signed, footer: t('장소는 모두 글링 지도에서 볼 수 있어요'),
    label: [t('공유 카드'), title, badge, ...items.map(item => item.name), signed].filter(Boolean).join(', '),
    message: [name.trim(), ...places.map(place => `· ${place.name.trim()}`), restAll > 0 ? t('외 {0}곳', restAll) : null].filter(Boolean).join('\n'),
  };
}

/** A saved list's catalog places in list order, for `listShareCard`. Saved businesses, posts and unknown places are left out. */
export function savedListPlaces(items: { target: { kind: string; id: string; cityId?: string } }[], cityPlaces: (cityId: string) => CityPlace[]) {
  const cities = new Map<string, Map<string, CityPlace>>();
  return items.flatMap(({ target }) => {
    if (target.kind !== 'place' || !target.cityId) return [];
    if (!cities.has(target.cityId)) {
      try { cities.set(target.cityId, new Map(cityPlaces(target.cityId).map(place => [place.id, place]))); } catch { cities.set(target.cityId, new Map()); }
    }
    const place = cities.get(target.cityId)!.get(target.id);
    return place ? [place] : [];
  });
}

/** What the image share needs from react-native-view-shot and expo-sharing; null when this build or platform does not have them. */
export type ShareCardImageModules = {
  isAvailableAsync: () => Promise<boolean>;
  captureRef: (view: never, options: { format: 'png'; result: 'tmpfile'; width: number; height: number }) => Promise<string>;
  shareAsync: (url: string, options: { mimeType: string; UTI: string }) => Promise<void>;
};

/** Capture size that comes out as 1080×1920 pixels: iOS reads it in points and draws at the screen scale, Android reads pixels. */
export function shareCardCaptureSize(os: string, scale: number) {
  return os === 'ios' ? { width: SHARE_CARD_PIXELS.width / scale, height: SHARE_CARD_PIXELS.height / scale } : { ...SHARE_CARD_PIXELS };
}

/**
 * Shares the first view that captures (story-size copy, then the preview) as a PNG through the system share sheet.
 * False when there is nothing to share as an image, so the caller shares the text instead; a failing share sheet still throws.
 */
export async function shareCardImage(modules: ShareCardImageModules | null, views: unknown[], os: string, scale: number) {
  if (!modules || !(await modules.isAvailableAsync().catch(() => false))) return false;
  let uri: string | null = null;
  for (const view of views) {
    if (!view) continue;
    try { uri = await modules.captureRef(view as never, { format: 'png', result: 'tmpfile', ...shareCardCaptureSize(os, scale) }); break; } catch { /* try the next view */ }
  }
  if (!uri) return false;
  await modules.shareAsync(uri.startsWith('file://') ? uri : `file://${uri}`, { mimeType: 'image/png', UTI: 'public.png' });
  return true;
}
