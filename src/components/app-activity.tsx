import Constants from 'expo-constants';
import { usePathname } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { behavior, behaviorScreen, configureBehavior, flushBehavior } from '@/lib/behavior-analytics';
import { analyticsScreen } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export function AppActivity() {
  const { isAuthed, me, isAdmin } = useAuth();
  const pathname = usePathname();
  useEffect(() => {
    if (isAdmin) { configureBehavior(null); return; }
    configureBehavior(async ({ session, events }) => {
      const { error } = await supabase.rpc('record_behavior_events', {
        p_session: session, p_events: events, p_platform: Platform.OS,
      });
      return !error;
    });
    return () => configureBehavior(null);
  }, [isAdmin, isAuthed, me.id]);
  useEffect(() => {
    const screen = analyticsScreen(pathname);
    if (isAdmin || !screen) return;
    behaviorScreen(screen);
    let started = AppState.currentState === 'active' ? Date.now() : 0;
    const measure = () => {
      if (started) { const now = Date.now(); behavior('dwell', 'screen', Math.min(60000, now - started)); started = now; }
    };
    const interval = setInterval(() => { measure(); void flushBehavior(); }, 30000);
    const listener = AppState.addEventListener('change', (state) => {
      measure();
      started = state === 'active' ? Date.now() : 0;
      void flushBehavior();
    });
    return () => { measure(); void flushBehavior(); clearInterval(interval); listener.remove(); };
  }, [pathname, isAdmin, isAuthed, me.id]);
  useEffect(() => {
    const screen = analyticsScreen(pathname);
    if (!isAuthed || isAdmin || !screen) return;
    const record = () => {
      if (AppState.currentState !== 'active' || (typeof document !== 'undefined' && document.hidden)) return;
      // Best effort: analytics never delays or breaks the user's action.
      void supabase.rpc('record_app_visit', {
        p_platform: Platform.OS, p_screen: screen, p_app_version: Constants.expoConfig?.version ?? 'unknown',
      }).then(() => {}, () => {});
    };
    record();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') record(); });
    return () => subscription.remove();
  }, [pathname, isAuthed, isAdmin, me.id]);
  return null;
}
