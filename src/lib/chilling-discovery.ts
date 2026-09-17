import type { Post } from './types.ts';
import { chillingKind, type ChillingKind } from './chilling.ts';
export function matchesChilling(post: Pick<Post, 'room'>, kind: ChillingKind, category: string, now = Date.now()) {
  return !!post.room && !post.room.closed && chillingKind(post.room) === kind
    && (category === 'all' || post.room.category === category)
    && !(kind === 'once' && post.room.endsAt && Date.parse(post.room.endsAt) <= now);
}
export function discoveryCursor(page: Pick<Post, 'id' | 'createdAt' | 'sortAt'>[]) {
  const last = page.at(-1);
  return page.length === 30 && last?.createdAt ? { id: last.id, createdAt: last.createdAt, sortAt: last.sortAt } : null;
}
