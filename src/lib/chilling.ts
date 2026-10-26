import type { SupabaseClient } from '@supabase/supabase-js';
import { getLocale } from '../i18n/index.ts';

export type ChillingKind = 'once' | 'group';
export type ChillingSchedule = {
  eventKind?: ChillingKind;
  startsAt?: string | null;
  endsAt?: string | null;
  timezone?: string | null;
  cadence?: string | null;
  recommendedAgeMin?: number | null;
  recommendedAgeMax?: number | null;
};
export type ChillingEventDraft = {
  kind: ChillingKind;
  startsAt: string;
  endsAt: string;
  timezone: string;
  cadence: string;
  capacity: number;
  category?: 'casual' | 'hobby' | 'travel' | 'party' | 'festival' | 'sports';
  recommendedAgeMin?: number | null;
  recommendedAgeMax?: number | null;
};

export function chillingKind(room: ChillingSchedule): ChillingKind {
  return room.eventKind === 'once' ? 'once' : 'group';
}

export function chillingAvailability(room: ChillingSchedule & { closed?: boolean; memberCount?: number; capacity?: number }, now = Date.now()): 'open' | 'full' | 'closed' | 'ended' {
  if (chillingKind(room) === 'once' && room.endsAt && Date.parse(room.endsAt) <= now) return 'ended';
  if (room.closed) return 'closed';
  if (room.capacity != null && (room.memberCount ?? 0) >= room.capacity) return 'full';
  return 'open';
}

// The one primary action on a meetup detail. Labels are Korean tr() keys; the host can review requests even after it closes.
export function meetupBarAction({ own, participating, loading, availability }: { own: boolean; participating: boolean; loading: boolean; availability: ReturnType<typeof chillingAvailability> }) {
  if (own) return { action: 'review', label: '신청자 검토', disabled: false, busy: false } as const;
  if (loading) return { action: null, label: '확인 중…', disabled: true, busy: true } as const;
  if (participating) return { action: 'status', label: '내 신청 보기', disabled: false, busy: false } as const;
  if (availability === 'open') return { action: 'apply', label: '참여 신청', disabled: false, busy: false } as const;
  return { action: null, label: ({ full: '정원 마감', closed: '모집 마감', ended: '종료된 모임' } as const)[availability], disabled: true, busy: false } as const;
}

export function chillingSchedule(room: ChillingSchedule, locale = getLocale()): string {
  const missing = locale === 'en-CA' ? 'Schedule needs confirmation' : '일정 확인 필요';
  // Cards already label the kind, so an empty cadence says where the schedule comes from instead of repeating it.
  if (chillingKind(room) === 'group') return room.cadence?.trim() || (locale === 'en-CA' ? 'Schedule set in the group' : '일정은 모임에서 정해요');
  if (!room.startsAt || !room.timezone) return missing;
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: room.timezone, month: 'long', day: 'numeric', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const start = formatter.format(new Date(room.startsAt));
    if (!room.endsAt) return start;
    const timeZone = room.timezone;
    const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone });
    const end = day(room.startsAt) === day(room.endsAt)
      ? new Intl.DateTimeFormat(locale, { timeZone: room.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(room.endsAt))
      : formatter.format(new Date(room.endsAt));
    return `${start} – ${end}`;
  } catch { return missing; }
}

// Readable zone name ("태평양 하계 표준시") instead of the raw IANA id shown to members.
export function chillingTimezoneLabel(room: ChillingSchedule, locale = getLocale()): string | null {
  if (!room.timezone) return null;
  try {
    const at = room.startsAt ? new Date(room.startsAt) : new Date();
    // Hermes on iOS tags only the first word of a multi-word zone name ("미 태평양 하계 표준시" → "미"); the zone comes last, so keep the tail.
    const parts = new Intl.DateTimeFormat(locale, { timeZone: room.timezone, timeZoneName: 'long' }).formatToParts(at);
    const index = parts.findIndex(part => part.type === 'timeZoneName');
    return index < 0 ? room.timezone : parts.slice(index).map(part => part.value).join('').trim();
  } catch { return room.timezone; }
}

export function recommendedAgeLabel(room: ChillingSchedule, locale = getLocale()): string {
  if (locale === 'en-CA') return room.recommendedAgeMin != null && room.recommendedAgeMax != null
    ? `Recommended ages ${room.recommendedAgeMin}–${room.recommendedAgeMax}` : 'All ages';
  return room.recommendedAgeMin != null && room.recommendedAgeMax != null
    ? `권장 만 ${room.recommendedAgeMin}~${room.recommendedAgeMax}세` : '연령대 무관';
}

// 다가오는 일회성 모임에만 붙는 임박 표시. 기기 기준 하루 경계로 센다.
export function chillingCountdown(room: ChillingSchedule, now = Date.now(), locale = getLocale()): string | null {
  if (chillingKind(room) !== 'once' || !room.startsAt) return null;
  const start = Date.parse(room.startsAt);
  if (!Number.isFinite(start) || start <= now) return null;
  const midnight = (value: number) => { const date = new Date(value); date.setHours(0, 0, 0, 0); return date.getTime(); };
  const days = Math.round((midnight(start) - midnight(now)) / 86400000);
  return days === 0 ? (locale === 'en-CA' ? 'Today' : '오늘') : days === 1 ? (locale === 'en-CA' ? 'Tomorrow' : '내일') : `D-${days}`;
}

export function recommendedAgeMessage(room: ChillingSchedule, age: number | null, locale = getLocale()): string {
  if (locale === 'en-CA') {
    if (age == null) return 'You can apply without a birth date. Refer to the recommended ages.';
    const matches = room.recommendedAgeMin == null || room.recommendedAgeMax == null || (age >= room.recommendedAgeMin && age <= room.recommendedAgeMax);
    return `Self-reported age ${age} · Birth date unverified. ${matches ? 'Within the recommended range.' : 'You can apply outside the recommended range.'}`;
  }
  if (age == null) return '생년월일 정보가 없어도 신청할 수 있어요. 권장 연령대를 참고해주세요.';
  const matches = room.recommendedAgeMin == null || room.recommendedAgeMax == null
    || (age >= room.recommendedAgeMin && age <= room.recommendedAgeMax);
  return `본인 입력 기준 만 ${age}세 · 생년월일 미인증. ${matches ? '권장 연령대에 해당해요.' : '권장 연령대와 달라도 신청할 수 있어요.'}`;
}

// Use the personal get_membership snapshot; business promotion subscriptions are separate.
export function chillingCapacityLimit(membership: { tier: string; expiresAt: string | null } | null | undefined, now = Date.now()): 50 | 5000 {
  return membership && ['plus', 'pro', 'premium'].includes(membership.tier)
    && membership.expiresAt != null && Date.parse(membership.expiresAt) > now ? 5000 : 50;
}

// Moving the start keeps the chosen duration; an unreadable start or end leaves the end alone for validation to catch.
export function shiftChillingSchedule(draft: { startsAt: string; endsAt: string }, startsAt: string) {
  const start = Date.parse(startsAt), duration = Date.parse(draft.endsAt) - Date.parse(draft.startsAt);
  return { startsAt, endsAt: Number.isFinite(start) && Number.isFinite(duration) ? new Date(start + duration).toISOString() : draft.endsAt };
}

export function normalizeChillingEvent(draft: ChillingEventDraft, maxCapacity = 5000) {
  if (!['once', 'group'].includes(draft.kind)) throw new Error('INVALID_EVENT');
  if (draft.category && !['casual', 'hobby', 'travel', 'party', 'festival', 'sports'].includes(draft.category)) throw new Error('INVALID_EVENT_CATEGORY');
  if (!Number.isInteger(maxCapacity) || maxCapacity < 2 || maxCapacity > 5000
    || !Number.isInteger(draft.capacity) || draft.capacity < 2 || draft.capacity > maxCapacity) throw new Error('INVALID_CAPACITY');
  const { recommendedAgeMin: min, recommendedAgeMax: max } = draft;
  if ((min != null || max != null) && (!Number.isInteger(min) || !Number.isInteger(max) || min! < 0 || max! > 120 || min! > max!)) throw new Error('INVALID_RECOMMENDED_AGE');
  let startsAt: string | null = null;
  let endsAt: string | null = null;
  const cadence = draft.cadence.trim();
  const timezone = draft.timezone.trim();
  if (draft.kind === 'once') {
    // Offset-required timestamps prevent the device timezone silently changing a meetup.
    const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i;
    const start = Date.parse(draft.startsAt), end = Date.parse(draft.endsAt);
    if (!zoned.test(draft.startsAt) || !zoned.test(draft.endsAt)
      || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= Date.now()) throw new Error('INVALID_SCHEDULE');
    if (!timezone) throw new Error('INVALID_TIMEZONE');
    try { new Intl.DateTimeFormat('ko-KR', { timeZone: timezone }).format(start); }
    catch { throw new Error('INVALID_TIMEZONE'); }
    startsAt = new Date(start).toISOString(); endsAt = new Date(end).toISOString();
  } else if (!cadence || cadence.length > 80) throw new Error('INVALID_CADENCE');
  return { eventKind: draft.kind, startsAt, endsAt, timezone: draft.kind === 'once' ? timezone : null,
    cadence: draft.kind === 'group' ? cadence : null, capacity: draft.capacity, category: draft.category ?? 'casual',
    ...(min != null ? { recommendedAgeMin: min, recommendedAgeMax: max } : {}) };
}

export async function configureChillingEvent(client: SupabaseClient, postId: string, draft: ChillingEventDraft) {
  if (!postId) throw new Error('INVALID_EVENT');
  const event = normalizeChillingEvent(draft);
  // Server checks ownership, active account, capacity and expiry again. A client plan is not authority.
  const result = await client.rpc('configure_chilling_event', {
    p_post_id: postId, p_kind: draft.kind,
    p_starts_at: event.startsAt, p_ends_at: event.endsAt,
    p_timezone: event.timezone, p_cadence: event.cadence,
    p_capacity: draft.capacity,
    ...((draft.recommendedAgeMin !== undefined || draft.recommendedAgeMax !== undefined) ? {
      p_recommended_age_min: draft.recommendedAgeMin ?? null, p_recommended_age_max: draft.recommendedAgeMax ?? null,
    } : {}),
  });
  if (result.error) throw result.error;
}
