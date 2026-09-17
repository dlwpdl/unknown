import { useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { isContentHidden, subscribeVisibility, visibilityRevision, type HiddenTarget } from '@/lib/content-visibility';

export function useContentVisibility() {
  const { isAuthed, me } = useAuth();
  useSyncExternalStore(subscribeVisibility, visibilityRevision, visibilityRevision);
  return (type: HiddenTarget, id: string, authorId?: string) =>
    isAuthed && isContentHidden(me.id, type, id, authorId);
}
