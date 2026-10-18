import { useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { chatBusinessIdentity, subscribeChatIdentity } from '@/lib/chat-identity';

export function useChatIdentity() {
  const { isAuthed, me } = useAuth();
  return useSyncExternalStore(subscribeChatIdentity,
    () => chatBusinessIdentity(isAuthed ? me.id : null), () => null);
}
