import type { SupabaseClient } from '@supabase/supabase-js';

export type ChillingKind = 'once' | 'group';
export type ChillingSchedule = {
  eventKind?: ChillingKind;
  startsAt?: string | null;
  endsAt?: string | null;
  timezone?: string | null;
  cadence?: string | null;
};
export type ChillingEventDraft = {
  kind: ChillingKind;
  startsAt: string;
  endsAt: string;
  timezone: string;
  cadence: string;
  capacity: number;
};

export function chillingKind(room: ChillingSchedule): ChillingKind {
  return room.eventKind === 'once' ? 'once' : 'group';
}

export function chillingSchedule(room: ChillingSchedule): string {
  if (chillingKind(room) === 'group') return room.cadence?.trim() || '지속 모임';
  if (!room.startsAt || !room.timezone) return '일정 확인 필요';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: room.timezone, month: 'long', day: 'numeric', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(room.startsAt));
  } catch { return '일정 확인 필요'; }
}

export async function configureChillingEvent(client: SupabaseClient, postId: string, draft: ChillingEventDraft) {
  if (!postId || !['once', 'group'].includes(draft.kind)) throw new Error('INVALID_EVENT');
  if (!Number.isInteger(draft.capacity) || draft.capacity < 2 || draft.capacity > 50) throw new Error('INVALID_CAPACITY');
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
  // Server checks ownership, active account, capacity and expiry again. A client plan is not authority.
  const result = await client.rpc('configure_chilling_event', {
    p_post_id: postId, p_kind: draft.kind,
    p_starts_at: startsAt, p_ends_at: endsAt,
    p_timezone: draft.kind === 'once' ? timezone : null,
    p_cadence: draft.kind === 'group' ? cadence : null,
    p_capacity: draft.capacity,
  });
  if (result.error) throw result.error;
}
