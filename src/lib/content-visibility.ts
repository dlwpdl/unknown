// Server queries persist these choices. This account-scoped overlay also filters
// already-rendered content and responses that were in flight when the user acted.
export type HiddenTarget = 'post' | 'comment' | 'message' | 'user';
const hidden = new Map<string, Set<string>>();
const listeners = new Set<() => void>();
let revision = 0;

export function hideContent(viewerId: string, type: HiddenTarget, id: string) {
  const keys = hidden.get(viewerId) ?? new Set<string>();
  hidden.set(viewerId, keys);
  keys.add(`${type}:${id}`);
  revision++;
  for (const listener of listeners) listener();
}

export function isContentHidden(viewerId: string, type: HiddenTarget, id: string, authorId?: string) {
  const keys = hidden.get(viewerId);
  return !!(keys?.has(`${type}:${id}`) || (authorId && keys?.has(`user:${authorId}`)));
}

export const visibilityRevision = () => revision;
export function subscribeVisibility(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
