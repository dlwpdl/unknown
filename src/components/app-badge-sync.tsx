import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth';
import { loadReadNotificationIds } from '@/lib/community-data';
import { subscribeUnreadCount } from '@/lib/notification-refresh';
import { pushSupported } from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// App icon badge = this account's unread count; delivered notifications already read in the app leave the lock screen.
export function AppBadgeSync() {
  const { isAuthed, isAuthLoading, me } = useAuth();
  const userId = isAuthed && !isAuthLoading ? me.id : null;
  useEffect(() => {
    if (!pushSupported) return;
    if (!userId) { void Notifications.setBadgeCountAsync(0).catch(() => {}); return; }
    let active = true;
    const stop = subscribeUnreadCount(supabase, { userId, cityId: null, scope: 'all' }, count => {
      if (!active) return;
      void Notifications.setBadgeCountAsync(count).catch(() => {});
      void Notifications.getPresentedNotificationsAsync().then(async presented => {
        const mine = presented.flatMap(item => {
          const data = item.request.content.data ?? {};
          return data.userId === userId && typeof data.notificationId === 'string' && UUID.test(data.notificationId) ? [{ id: data.notificationId, identifier: item.request.identifier }] : [];
        });
        const read = await loadReadNotificationIds(supabase, mine.map(item => item.id));
        if (!active) return;
        await Promise.all(mine.filter(item => read.has(item.id)).map(item => Notifications.dismissNotificationAsync(item.identifier)));
      }).catch(() => {});
    });
    return () => { active = false; stop(); };
  }, [userId]);
  return null;
}
