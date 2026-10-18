export type BusinessChatIdentity = { id: string; name: string };
let selected: { userId: string; business: BusinessChatIdentity | null } | null = null;
const listeners = new Set<() => void>();

export const chatBusinessIdentity = (userId: string | null) => userId && selected?.userId === userId ? selected.business : null;

export function selectChatBusiness(userId: string, business: BusinessChatIdentity | null) {
  if (!userId || business && (!business.id || !business.name)) throw new Error('INVALID_CHAT_IDENTITY');
  if (selected?.userId === userId && (selected.business?.id ?? null) === (business?.id ?? null) && (selected.business?.name ?? null) === (business?.name ?? null)) return;
  selected = { userId, business: business ? { id: business.id, name: business.name } : null };
  for (const listener of listeners) listener();
}

export function resetChatIdentity() {
  selected = null;
  for (const listener of listeners) listener();
}

export function subscribeChatIdentity(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
