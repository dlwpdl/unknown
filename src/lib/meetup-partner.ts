import type { RoomPreview } from './types.ts';

type Translate = (text: string, ...values: unknown[]) => string;

/** "제휴 혜택 · 지모코 · 음료 1잔 · 10% 할인", or null when no usable partner is set so the line hides. */
export function meetupPartnerLine(partner: RoomPreview['partner'], tr: Translate): string | null {
  const name = partner?.name?.trim(), benefit = partner?.benefit?.trim();
  const percent = typeof partner?.percent === 'number' && partner.percent > 0 ? tr('{0}% 할인', partner.percent) : '';
  if (!partner?.businessId || !name || (!benefit && !percent)) return null;
  return [tr('제휴 혜택'), name, benefit, percent].filter(Boolean).join(' · ');
}
