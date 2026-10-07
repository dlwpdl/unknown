import { useCallback, useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { isContentHidden, subscribeVisibility, visibilityRevision, type HiddenTarget } from '@/lib/content-visibility';

export function useContentVisibility() {
  const { isAuthed, me } = useAuth();
  const revision = useSyncExternalStore(subscribeVisibility, visibilityRevision, visibilityRevision);
  return useCallback((type: HiddenTarget, id: string, authorId?: string) => {
    // A visibility change must also invalidate callers' memoized message lists.
    void revision;
    return isAuthed && isContentHidden(me.id, type, id, authorId);
  }, [isAuthed, me.id, revision]);
}
