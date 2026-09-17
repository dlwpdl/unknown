export type MeetupPolicy = {
  leaves24h: number; closures7d: number; creates24h: number; creates7d: number;
  joinBlockedUntil: string | null; hostBlockedUntil: string | null; createBlockedUntil: string | null;
};
export type MeetupPolicyMode = 'join' | 'leave' | 'close' | 'host' | 'once';

function releaseTime(value: string) {
  return new Date(value).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
}

export function meetupPolicyNotice(policy: MeetupPolicy, mode: MeetupPolicyMode, now = Date.now()): string | null {
  const joining = mode === 'join' || mode === 'leave';
  const dates = (joining ? [policy.joinBlockedUntil] : mode === 'once' ? [policy.hostBlockedUntil, policy.createBlockedUntil] : [policy.hostBlockedUntil])
    .filter((value): value is string => !!value && Date.parse(value) > now).sort((a, b) => Date.parse(b) - Date.parse(a));
  if (dates[0]) return `${joining ? '새 모임 참여' : '새 행사 개최'}는 ${releaseTime(dates[0])}부터 다시 가능해요. 기존 모임과 신고·차단·나가기는 계속 이용할 수 있어요.`;
  if (mode === 'leave' && policy.leaves24h >= 2) return '최근 24시간에 서로 다른 모임에서 2회 이상 나갔어요. 이번에도 승인된 모임에서 종료 전에 처음 나가면 새 모임 참여가 12시간 제한돼요. 자연 종료·승인 전 취소는 제외돼요.';
  if (mode === 'close' && policy.closures7d >= 1) return '최근 7일에 조기 해산 기록이 있어요. 승인된 참가자가 있는 다른 행사를 조기 해산하면 새 행사 개최가 24시간 제한돼요. 자연 종료·빈 행사 취소는 제외돼요.';
  if (mode === 'once' && (policy.creates24h >= 2 || policy.creates7d >= 9)) return `칠링 개최는 최근 24시간 기준 ${Math.max(0, 3 - policy.creates24h)}회, 최근 7일 기준 ${Math.max(0, 10 - policy.creates7d)}회 남았어요. 취소해도 개최 횟수는 돌아오지 않아요.`;
  return null;
}

export function meetupRestrictionError(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('message' in error)) return null;
  const message = String(error.message);
  const action = message.includes('MEETUP_JOIN_RESTRICTED') ? '새 모임 참여'
    : message.includes('MEETUP_HOST_RESTRICTED') || message.includes('CHILLING_CREATE_LIMIT') ? '새 행사 개최' : null;
  if (!action) return null;
  // PostgreSQL exception DETAIL uses a space/+00; normalize for iOS's ISO parser.
  const details = ('details' in error ? String(error.details) : '').replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  return `${action}가 잠시 제한됐어요.${Number.isFinite(Date.parse(details)) ? ` ${releaseTime(details)}부터 다시 가능해요.` : ' 잠시 후 이용 상태를 다시 확인해 주세요.'} 신고·차단·나가기는 계속 가능해요.`;
}
