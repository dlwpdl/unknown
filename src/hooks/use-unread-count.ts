import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';

import { useAuth } from '@/lib/auth';
import { loadUnreadNotificationCount } from '@/lib/community-data';
import { NOTIFICATION_PREFERENCES_CHANGED } from '@/lib/notification-preferences';
import { supabase } from '@/lib/supabase';

export function useUnreadCount() {
  const { isAuthed, me } = useAuth();
  const pathname = usePathname();
  const [result, setResult] = useState<{ userId: string; count: number } | null>(null);
  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    let version = 0;
    const refresh = () => {
      const request = ++version;
      void loadUnreadNotificationCount(supabase, me.id)
        .then((count) => { if (active && version === request) setResult({ userId: me.id, count }); }).catch(() => {});
    };
    refresh();
    const channel = supabase.channel(`navigation-notifications:${me.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${me.id}` }, refresh)
      .subscribe();
    const settings = DeviceEventEmitter.addListener(NOTIFICATION_PREFERENCES_CHANGED, refresh);
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { active = false; settings.remove(); foreground.remove(); void supabase.removeChannel(channel); };
  }, [isAuthed, me.id, pathname]);
  return isAuthed && result?.userId === me.id ? result.count : 0;
}
