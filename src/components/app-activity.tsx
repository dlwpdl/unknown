import Constants from 'expo-constants';
import { usePathname } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { analyticsScreen } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export function AppActivity() {
  const { isAuthed, me, isAdmin } = useAuth();
  const pathname = usePathname();
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
