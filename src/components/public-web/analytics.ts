import { useEffect } from 'react';
import { behavior, behaviorScreen, configureBehavior, flushBehavior, scrollThresholds } from '@/lib/behavior-analytics';

export function useReaderAnalytics(screen: string, viewKey: string) {
  useEffect(() => {
    configureBehavior(async ({ session, events }) => {
      // Dedicated telemetry transport; public content client remains read-only.
      const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/rpc/record_behavior_events`, {
        method: 'POST', credentials: 'omit', keepalive: true,
        headers: { 'Content-Type': 'application/json', apikey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
        body: JSON.stringify({ p_session: session, p_events: events, p_platform: 'web' }),
      });
      return response.ok;
    });
    return () => { void flushBehavior(); configureBehavior(null); };
  }, []);
  useEffect(() => {
    behaviorScreen(screen);
    let reached = 0;
    let started = document.hidden ? 0 : Date.now();
    const measure = () => {
      if (started) { const now = Date.now(); behavior('dwell', 'screen', Math.min(60000, now - started)); started = now; }
    };
    const visibility = () => { measure(); started = document.hidden ? 0 : Date.now(); void flushBehavior(); };
    const scroll = () => {
      for (const value of scrollThresholds(window.scrollY, window.innerHeight, document.documentElement.scrollHeight, reached)) {
        reached = value; behavior('scroll', 'web_page', value);
      }
    };
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-analytics]') : null;
      const id = target?.getAttribute('data-analytics');
      if (id) { behavior('press', id); void flushBehavior(); }
    };
    const leave = () => { measure(); started = 0; void flushBehavior(); };
    const interval = setInterval(() => { measure(); void flushBehavior(); }, 30000);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('click', click);
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('pagehide', leave);
    return () => {
      leave(); clearInterval(interval);
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('click', click);
      window.removeEventListener('scroll', scroll); window.removeEventListener('pagehide', leave);
    };
  }, [screen, viewKey]);
}
