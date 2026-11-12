import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Linking from 'expo-linking';
import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { behavior, behaviorScreen, configureBehavior, flushBehavior, isIdle, noteTouch } from '@/lib/behavior-analytics';
import { analyticsScreen } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { buildLabel } from '@/lib/error-reporting';
import { getOAuthCallbackPath } from '@/lib/kakao-auth';
import { getAcquisitionSource, getInstallReferrerSource, knownAcquisitionSource, type AcquisitionSource } from '@/lib/product-analytics';
import { supabase } from '@/lib/supabase';

const INSTALL_SOURCE_KEY = 'gling.install-source';
// Android: Play's install referrer is read once, on the first launch without an account, and kept until the first login.
async function installSource(): Promise<AcquisitionSource> {
  const saved = await AsyncStorage.getItem(INSTALL_SOURCE_KEY);
  if (saved !== null) return knownAcquisitionSource(saved);
  const { data } = await supabase.auth.getSession();
  const source = data.session ? 'unknown' : getInstallReferrerSource(await Application.getInstallReferrerAsync().catch(() => null));
  await AsyncStorage.setItem(INSTALL_SOURCE_KEY, source);
  return source;
}

export function AppActivity() {
  const { isAuthed, me, isAdmin } = useAuth();
  const pathname = usePathname();
  const attribution = useRef<{ initial: boolean; source: AcquisitionSource; userId: string | null; revision: number }>({ initial: true, source: 'unknown', userId: null, revision: 0 });
  useEffect(() => {
    const context = attribution.current, userId = me.id === 'me' ? null : me.id;
    if (context.userId !== userId) {
      // The first session owns its guest entry through signup; later accounts start unknown.
      if (context.userId) { context.source = 'unknown'; context.revision += 1; }
      context.userId = userId;
    }
    const initial = context.initial;
    context.initial = false;
    if (isAuthed && Platform.OS === 'android') void AsyncStorage.setItem(INSTALL_SOURCE_KEY, 'unknown').catch(() => {});
    if (isAdmin) { context.source = 'unknown'; context.revision += 1; configureBehavior(null); return; }
    let active = true;
    if (initial) {
      const revision = context.revision;
      if (Platform.OS === 'web') context.source = getAcquisitionSource(typeof window === 'undefined' ? null : window.location.href);
      else {
        const linked = Linking.getInitialURL().then(url => { if (context.revision === revision) context.source = getAcquisitionSource(url); }, () => {});
        // A tagged link that opened the app wins; otherwise the guest keeps the store install source.
        if (Platform.OS === 'android') void Promise.all([installSource(), linked]).then(([installed]) => {
          if (context.revision === revision && context.source === 'unknown') context.source = installed;
        }, () => {});
      }
    }
    const entry = Platform.OS === 'web' ? null : Linking.addEventListener('url', ({ url }) => {
      if (!active) return;
      try {
        const target = new URL(url);
        if (target.protocol === 'gling:' && `${target.hostname}${target.pathname}`.replace(/^\/+/, '') === getOAuthCallbackPath(Platform.OS)) return;
      } catch { /* Invalid entry URLs stay unknown. */ }
      context.revision += 1;
      context.source = getAcquisitionSource(url);
    });
    configureBehavior(async ({ session, events }) => {
      if (!active) return false;
      const { error } = await supabase.rpc('record_behavior_events', {
        p_session: session, p_events: events, p_platform: Platform.OS, p_source: context.source,
      });
      // INVALID_BEHAVIOR never succeeds on retry; resending it from the queue front would block every later event.
      return !error || error.message === 'INVALID_BEHAVIOR';
    });
    return () => { active = false; entry?.remove(); configureBehavior(null); };
  }, [isAdmin, isAuthed, me.id]);
  useEffect(() => {
    const screen = analyticsScreen(pathname);
    if (isAdmin || !screen) return;
    behaviorScreen(screen);
    noteTouch();
    let started = AppState.currentState === 'active' ? Date.now() : 0;
    const measure = () => {
      if (started) { const now = Date.now(); if (!isIdle(now)) behavior('dwell', 'screen', Math.min(60000, now - started)); started = now; }
    };
    const interval = setInterval(() => { measure(); void flushBehavior(); }, 30000);
    const listener = AppState.addEventListener('change', (state) => {
      measure();
      started = state === 'active' ? Date.now() : 0;
      if (state === 'active') noteTouch();
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
        p_platform: Platform.OS, p_screen: screen, p_app_version: buildLabel(),
      }).then(() => {}, () => {});
    };
    record();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') record(); });
    return () => subscription.remove();
  }, [pathname, isAuthed, isAdmin, me.id]);
  return null;
}
