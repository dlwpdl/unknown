import type { SupabaseClient } from '@supabase/supabase-js';

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
  category?: 'casual' | 'hobby' | 'travel';
  recommendedAgeMin?: number | null;
  recommendedAgeMax?: number | null;
};

export function chillingKind(room: ChillingSchedule): ChillingKind {
  return room.eventKind === 'once' ? 'once' : 'group';
}

export function chillingSchedule(room: ChillingSchedule): string {
  if (chillingKind(room) === 'group') return room.cadence?.trim() || '지속 모임';
  if (!room.startsAt || !room.timezone) return '일정 확인 필요';
  try {
    const formatter = new Intl.DateTimeFormat('ko-KR', {
      timeZone: room.timezone, month: 'long', day: 'numeric', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const start = formatter.format(new Date(room.startsAt));
    return room.endsAt ? `${start} – ${formatter.format(new Date(room.endsAt))}` : start;
  } catch { return '일정 확인 필요'; }
}

export function recommendedAgeLabel(room: ChillingSchedule): string {
  return room.recommendedAgeMin != null && room.recommendedAgeMax != null
    ? `권장 만 ${room.recommendedAgeMin}~${room.recommendedAgeMax}세` : '연령대 무관';
}

export function recommendedAgeMessage(room: ChillingSchedule, age: number | null): string {
  if (age == null) return '생년월일 정보가 없어도 신청할 수 있어요. 권장 연령대를 참고해주세요.';
  const matches = room.recommendedAgeMin == null || room.recommendedAgeMax == null
    || (age >= room.recommendedAgeMin && age <= room.recommendedAgeMax);
  return `본인 입력 기준 만 ${age}세 · 생년월일 미인증. ${matches ? '권장 연령대에 해당해요.' : '권장 연령대와 달라도 신청할 수 있어요.'}`;
}

export function normalizeChillingEvent(draft: ChillingEventDraft) {
  if (!['once', 'group'].includes(draft.kind)) throw new Error('INVALID_EVENT');
  if (draft.category && !['casual', 'hobby', 'travel'].includes(draft.category)) throw new Error('INVALID_EVENT_CATEGORY');
  if (!Number.isInteger(draft.capacity) || draft.capacity < 2 || draft.capacity > 50) throw new Error('INVALID_CAPACITY');
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
