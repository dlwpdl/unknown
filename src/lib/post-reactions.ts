type Kind = 'like' | 'save';
type Reaction = { isOn: boolean; count: number };
type Reactions = { like?: Reaction; save?: Reaction; pending?: Kind };
const snapshots = new Map<string, Reactions>();
const listeners = new Set<() => void>();
const keyFor = (viewerId: string, postId: string) => `${viewerId}:${postId}`;

export const postReactionsSnapshot = (viewerId: string, postId: string) => snapshots.get(keyFor(viewerId, postId));
export function subscribePostReactions(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(key: string, snapshot: Reactions) {
  snapshots.set(key, snapshot);
  for (const listener of listeners) listener();
}

// Fresh server counts can reconcile a reaction once its selected state has caught up.
export function syncPostReactions(viewerId: string, postId: string, like: Reaction, save: Reaction) {
  const key = keyFor(viewerId, postId), current = snapshots.get(key);
  if (!current || current.pending) return;
  let next = current;
  for (const [kind, incoming] of [['like', like], ['save', save]] as const) {
    if (current[kind]?.isOn === incoming.isOn && current[kind]?.count !== incoming.count) next = { ...next, [kind]: incoming };
  }
  if (next !== current) publish(key, next);
}

export async function changePostReaction(viewerId: string, postId: string, kind: Kind, fallback: Reaction, persist: (isOn: boolean) => Promise<unknown>) {
  const key = keyFor(viewerId, postId), previous = snapshots.get(key) ?? {};
  if (previous.pending) return;
  const reaction = previous[kind] ?? fallback;
  const next = { ...previous, [kind]: { isOn: !reaction.isOn, count: Math.max(0, reaction.count + (reaction.isOn ? -1 : 1)) } };
  publish(key, { ...next, pending: kind });
  try {
    await persist(reaction.isOn);
    publish(key, next);
  } catch (error) {
    publish(key, { ...previous, [kind]: reaction });
    throw error;
  }
}
