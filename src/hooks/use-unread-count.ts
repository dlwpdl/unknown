import { usePathname } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { refreshUnreadCount, subscribeUnreadCount } from '@/lib/notification-refresh';
import { supabase } from '@/lib/supabase';

type Token = readonly unknown[];
type Lifetime = { token: Token; active: boolean; pathname: string; stop: () => void };
export function useUnreadCount(scope: 'chat' | 'other' | 'all' = 'all') {
  const { isAuthed, isAuthLoading, me } = useAuth(), pathname = usePathname();
  const cityId = scope === 'chat' ? null : me.cityId ?? null;
  const latestPath = useRef(pathname);
  useLayoutEffect(() => { latestPath.current = pathname; }, [pathname]);
  const token = useMemo(() => [isAuthed, isAuthLoading, me.id, cityId, scope] as const, [isAuthed, isAuthLoading, me.id, cityId, scope]);
  const live = useRef<Lifetime | null>(null);
  const [result, setResult] = useState<{ token: Token; count: number } | null>(null);
  useLayoutEffect(() => {
    const lifetime = { token, active: isAuthed && !isAuthLoading, pathname: latestPath.current, stop: () => {} };
    live.current = lifetime;
    return () => { lifetime.active = false; lifetime.stop(); };
  }, [token, isAuthed, isAuthLoading]);
  useEffect(() => {
    const lifetime = live.current;
    if (!lifetime?.active || lifetime.token !== token) return;
    const stop = subscribeUnreadCount(supabase, { userId: me.id, cityId, scope }, count => {
      if (lifetime.active && live.current === lifetime) setResult({ token, count });
    });
    lifetime.stop = stop;
    return stop;
  }, [token, me.id, cityId, scope]);
  useEffect(() => {
    const lifetime = live.current;
    if (!lifetime?.active || lifetime.token !== token || lifetime.pathname === pathname) return;
    lifetime.pathname = pathname;
    refreshUnreadCount(supabase, { userId: me.id, cityId, scope });
  }, [pathname, token, me.id, cityId, scope]);
  return isAuthed && !isAuthLoading && result?.token === token ? result.count : 0;
}
