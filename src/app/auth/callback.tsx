import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { useIsFocused, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { getOAuthCallbackPath, getOAuthCode } from '@/lib/kakao-auth';
import { clearSharedPostReturn, readSharedPostReturn } from '@/lib/shared-post-return';
import { sharedPostReturnPath } from '@/lib/sharing';
import { supabase } from '@/lib/supabase';

type Scope = { active: boolean; url: string | null; account: string; authed: boolean; loading: boolean };

export default function AuthCallbackRoute() {
  const { language } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback();
  const { isAuthed, isAuthLoading, authError, me } = useAuth();
  const router = useRouter(), focused = useIsFocused(), url = Linking.useURL();
  const [error, setError] = useState(false), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const scope = useRef<Scope | null>(null), mounted = useRef(true), flight = useRef(false), returned = useRef(false);
  const attempted = useRef<string | null>(null);
  const failedExchange = useRef<{ url: string | null; account: string } | null>(null);
  const resumed = useRef<Scope | null>(null);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => {
    const next = { active: focused, url, account: me.id, authed: isAuthed, loading: isAuthLoading };
    scope.current = next;
    return () => { next.active = false; };
  }, [focused, url, me.id, isAuthed, isAuthLoading]);

  const run = useCallback((mode: 'exchange' | 'resume' | 'back') => {
    const current = scope.current;
    if (!current?.active || current.loading || flight.current || returned.current) return;
    if ((mode === 'exchange' && current.authed) || (mode === 'resume' && !current.authed)) return;
    if (mode === 'exchange') { attempted.current = current.url; failedExchange.current = null; }
    flight.current = true; setBusy(true); setError(false);
    const valid = () => mounted.current && current.active && scope.current === current;
    void Promise.resolve().then(async () => {
      if (!valid()) return;
      if (mode === 'exchange') {
        if (!current.url) throw new Error('OAUTH_CODE_MISSING');
        const code = getOAuthCode(current.url, Linking.createURL(getOAuthCallbackPath(Platform.OS)));
        const { error: failure } = await supabase.auth.exchangeCodeForSession(code);
        if (failure) throw new Error('OAUTH_CALLBACK_ERROR');
        return; // AuthProvider owns the resulting session, active profile and onboarding.
      }
      const path = await readSharedPostReturn(AsyncStorage);
      const web = path ? sharedPostReturnPath(path.replace('/post/', '/post?id=').replace('?invite=1', '&invite=1')) : null;
      if (web === '/') throw new Error('INVALID_SHARED_POST_RETURN');
      if (!valid()) return;
      const destination = web ? web.replace('/post?id=', '/post/').replace('&invite=1', '?invite=1') : '/';
      returned.current = true;
      try { router.replace(destination as Href); } catch (failure) { returned.current = false; throw failure; }
      if (mode === 'resume' && web) {
        try { await clearSharedPostReturn(AsyncStorage, web); }
        catch { /* The destination post route retries this same matching cleanup. */ }
      }
    }).catch(() => {
      if (mode === 'exchange' && mounted.current && scope.current?.url === current.url && scope.current.account === current.account) {
        failedExchange.current = { url: current.url, account: current.account };
      }
      if (valid()) setError(true);
    })
      .finally(() => { flight.current = false; if (mounted.current) setBusy(false); });
  }, [router]);

  useEffect(() => {
    if (!focused || busy || isAuthLoading || returned.current) return;
    if (isAuthed) {
      if (resumed.current !== scope.current) { resumed.current = scope.current; run('resume'); }
      return;
    }
    // A warm provider failure belongs to AuthProvider, not another code exchange.
    if (authError || !url || (failedExchange.current?.url === url && failedExchange.current.account === me.id)) { setError(true); return; }
    if (attempted.current !== url) run('exchange');
  }, [focused, busy, isAuthed, isAuthLoading, authError, url, me.id, retry, run]);

  const copy = language === 'ko'
    ? { pending: '로그인을 완료하는 중이에요.', error: '로그인을 완료하지 못했어요.', help: '다시 시도하거나 공유 글로 돌아가 주세요.', retry: '다시 시도', back: '공유 글로 돌아가기' }
    : { pending: 'Finishing sign-in…', error: 'Couldn’t finish signing in.', help: 'Try again or return to the shared post.', retry: 'Try again', back: 'Return to shared post' };
  const failed = error && !isAuthLoading, disabled = busy || isAuthLoading;
  return <View style={[styles.page, { backgroundColor: theme.background }]}>
    {!failed && <GlingLoader accessibilityLabel={copy.pending} />}
    <ThemedText type="subtitle" accessibilityRole={failed ? 'alert' : undefined} style={styles.copy}>{failed ? copy.error : copy.pending}</ThemedText>
    {failed && <>
      <ThemedText type="small" themeColor="textSecondary" style={styles.copy}>{copy.help}</ThemedText>
      <Pressable analyticsId="shared.auth.retry" accessibilityRole="button" accessibilityLabel={copy.retry} disabled={disabled} accessibilityState={{ disabled, busy }}
        onPress={() => {
          if (!scope.current?.active || scope.current.loading || flight.current || returned.current) return;
          play('selection');
          if (isAuthed) run('resume');
          else if (authError) run('back');
          else { attempted.current = null; failedExchange.current = null; setRetry(value => value + 1); }
        }} style={({ pressed }) => [ControlStyles.action, { backgroundColor: theme.accent, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 }]}>
        <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{copy.retry}</ThemedText>
      </Pressable>
    </>}
    <Pressable analyticsId="app_auth_callback.pressable.1" accessibilityRole="button" accessibilityLabel={copy.back}
      disabled={disabled} accessibilityState={{ disabled, busy }} onPress={() => { play('selection'); run(isAuthed ? 'resume' : 'back'); }}
      style={({ pressed }) => [ControlStyles.action, { opacity: disabled ? 0.45 : pressed ? 0.82 : 1 }]}>
      <ThemedText type="smallBold" themeColor="accent">{copy.back}</ThemedText>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  page: { flex: 1, minHeight: '100%', alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.two },
  copy: { textAlign: 'center' },
});
