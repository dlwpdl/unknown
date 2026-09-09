import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { loadUnreadNotificationCount } from '@/lib/community-data';
import { supabase } from '@/lib/supabase';

export function useUnreadCount() {
  const { isAuthed, me } = useAuth();
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    const refresh = () => void loadUnreadNotificationCount(supabase, me.id)
      .then((next) => active && setCount(next)).catch(() => {});
    refresh();
    const channel = supabase.channel(`navigation-notifications:${me.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${me.id}` }, refresh)
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [isAuthed, me.id, pathname]);
  return isAuthed ? count : 0;
}
