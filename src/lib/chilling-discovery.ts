import type { Post } from './types.ts';
import { chillingKind, type ChillingKind } from './chilling.ts';
export function matchesChilling(post: Pick<Post, 'room'>, kind: ChillingKind, category: string, now = Date.now()) {
  return !!post.room && !post.room.closed && chillingKind(post.room) === kind
    && (category === 'all' || post.room.category === category)
    && !(kind === 'once' && post.room.endsAt && Date.parse(post.room.endsAt) <= now);
}

export type ChillingWindow = 'all' | 'today' | 'week';

// ponytail: 기기 기준 하루·7일 경계. 도시 시간대로 맞춰야 할 만큼 모임이 늘면 room.timezone으로 계산한다.
export function matchesChillingWindow(post: Pick<Post, 'room'>, window: ChillingWindow, now = Date.now()) {
  if (window === 'all' || !post.room) return true;
  if (chillingKind(post.room) === 'group') return true; // 정기모임은 날짜가 없어 기간 필터에서 뺀다
  const startsAt = post.room.startsAt ? Date.parse(post.room.startsAt) : NaN;
  if (!Number.isFinite(startsAt)) return false;
  if (window === 'today') { const end = new Date(now); end.setHours(23, 59, 59, 999); return startsAt <= end.getTime(); }
  return startsAt <= now + 7 * 86400000;
}

export function hasOpenSeat(room?: Pick<Post, 'room'>['room']) {
  return room?.capacity ? room.memberCount < room.capacity : true;
}

// D-day: 다가오는 일회성 모임을 먼저 보여준다. 정기모임은 서버 순서(최신 개설순)를 그대로 둔다.
// ponytail: 페이지 안에서만 정렬한다. 한 페이지로 다음 모임을 다 못 담게 되면 서버 ORDER BY로 옮긴다.
export function sortChillings(posts: Post[], kind: ChillingKind) {
  if (kind === 'group') return posts;
  const start = (post: Post) => { const value = post.room?.startsAt ? Date.parse(post.room.startsAt) : NaN; return Number.isFinite(value) ? value : Infinity; };
  return [...posts].sort((a, b) => start(a) - start(b) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) || a.id.localeCompare(b.id));
}

export function discoveryCursor(page: Pick<Post, 'id' | 'createdAt' | 'sortAt'>[]) {
  const last = page.at(-1);
  return page.length === 30 && last?.createdAt ? { id: last.id, createdAt: last.createdAt, sortAt: last.sortAt } : null;
}
