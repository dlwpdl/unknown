import { translateUi } from '../i18n/index.ts';
import type { AppLanguage } from '../i18n/language.ts';
import { areaName, formatMoney, LISTING_LABELS, type Room } from './listing-details.ts';

// CMHC Rental Market Survey, October 2025: average rent by bedroom type by survey zone, Vancouver CMA.
// Purpose-built rental apartments with sitting tenants included, so it runs below what a new tenant is asked.
// Only neighbourhoods that sit clearly inside one zone, and only cells CMHC rates a–c. Studio, 1, 2, 3+ bedrooms.
// shortcut: a fixed table in the app, replace it with the next October survey once a year.
const VANCOUVER: Record<string, readonly [number, number, number, number | null]> = {
  downtown: [1839, 2112, 3258, 5081],
  'west-end': [1684, 1830, 2818, null],
  kitsilano: [1679, 1915, 2651, 3733],
  'mount-pleasant': [1798, 1704, 2512, 3360],
  'west-vancouver': [1914, 2153, 3252, null],
  metrotown: [1561, 1813, 2325, null],
  burquitlam: [1640, 1708, 2175, 2627], coquitlam: [1640, 1708, 2175, 2627], 'coquitlam-centre': [1640, 1708, 2175, 2627],
  'port-moody': [1640, 1708, 2175, 2627], 'port-coquitlam': [1640, 1708, 2175, 2627],
  'new-westminster': [1531, 1645, 2134, 2733],
  richmond: [1547, 1676, 2046, 2500],
  surrey: [1606, 1602, 1872, 1956],
  langley: [1354, 1765, 2203, 2216],
  delta: [1235, 1550, 1787, 2950], ladner: [1235, 1550, 1787, 2950], tsawwassen: [1235, 1550, 1787, 2950],
  'maple-ridge': [980, 1426, 1653, 2026],
  'white-rock': [1227, 1435, 1813, 2646],
};
// 방 한 칸 and basement suites are not in the survey. 1+덴 counts as 1 bed and 2베드 2배스 as 2 bed, the way CMHC groups them.
const COLUMNS: Partial<Record<Room, readonly [number, Room]>> = { studio: [0, 'studio'], '1b': [1, '1b'], '1b_den': [1, '1b'], '2b': [2, '2b'], '2b2b': [2, '2b'], '3b': [3, '3b'] };

export type RentAverage = { amount: number; line: string; cheap: string | null };

// The line under a 렌트 내놓음 price, and the warning when the asking rent is more than 30% below it.
// Takes the saved details or the composer draft, which keeps unset fields as null.
export function rentAverage(cityId: string, details: { deal: string; rooms?: Room | null; area?: string | null }, price: number | null | undefined, language: AppLanguage): RentAverage | null {
  const column = details.rooms ? COLUMNS[details.rooms] : undefined;
  const amount = column && cityId === 'vancouver' && details.deal === 'rent_offer' ? VANCOUVER[details.area ?? '']?.[column[0]] : null;
  const area = areaName(cityId, details.area ?? undefined, language);
  if (amount == null || !column || !area) return null;
  const t = (text: string, ...values: unknown[]) => translateUi(language, text, ...values);
  const rooms = t(LISTING_LABELS.rooms[column[1]]);
  return {
    amount,
    line: t('{0} {1} 평균 {2} · CMHC 2025년 10월', area, rooms, formatMoney(amount)),
    cheap: price != null && price > 0 && price < amount * 0.7
      ? t('{0} {1} 평균은 {2}인데 이 집은 {3}이에요. 비슷한 집보다 많이 싼 건 BC 경찰이 사기 신호로 꼽는 거예요.', area, rooms, formatMoney(amount), formatMoney(price))
      : null,
  };
}
