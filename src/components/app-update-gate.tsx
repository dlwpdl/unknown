import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { createClient } from '@supabase/supabase-js';
import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, Modal, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateCard } from '@/components/state-card';
import { LaunchMoment } from '@/components/launch-moment';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { requiresAppUpdate } from '@/lib/app-update';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// Public policy must not wait on a saved login session or token refresh.
const releasePolicyClient = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
  auth: { storageKey: 'gling-release-policy', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// Debug binaries reload current source without changing their installed build number.
const build = __DEV__ || Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? null : Application.nativeBuildVersion;
const storeUrl = Platform.OS === 'ios'
  ? 'https://apps.apple.com/app/id6809273242'
  : 'https://play.google.com/store/apps/details?id=com.dlwpdl.gling';

export function AppUpdateGate({ children }: { children: ReactNode }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [status, setStatus] = useState<'checking' | 'allowed' | 'blocked' | 'error'>(Platform.OS === 'web' || !build ? 'allowed' : 'checking');
  const [introDone, setIntroDone] = useState(Platform.OS === 'web');
  const [storeError, setStoreError] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => { if (status === 'blocked' || status === 'error') void SplashScreen.hideAsync().catch(() => {}); }, [status]);

  const check = useCallback(async () => {
    if (Platform.OS === 'web' || !build) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const { data, error } = await releasePolicyClient.from('app_release_policy')
        .select('minimum_build').eq('platform', Platform.OS).abortSignal(controller.signal).maybeSingle();
      if (error || !data || !Number.isSafeInteger(data.minimum_build) || data.minimum_build < 0) throw error ?? new Error('Invalid release policy');
      if (request.current === controller) setStatus(requiresAppUpdate(build, data.minimum_build) ? 'blocked' : 'allowed');
    } catch {
      if (request.current === controller) setStatus('error');
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' || !build) return;
    const initial = setTimeout(() => { void check(); }, 0);
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (previous !== 'active' && next === 'active') { setStatus('checking'); void check(); }
      previous = next;
    });
    return () => { clearTimeout(initial); subscription.remove(); request.current?.abort(); request.current = null; };
  }, [check]);

  return <>
    {children}
    <Modal visible={status !== 'allowed' || !introDone} animationType="none" onRequestClose={() => {}}>
      {status === 'blocked' ? <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <View style={styles.content}>
          <StateCard kind="update" title={tr("새 버전으로 업데이트해 주세요")}
            body={tr(storeError ? '스토어를 열지 못했어요. 잠시 후 다시 시도해 주세요.' : '글링을 계속 사용하려면 최신 버전을 설치해 주세요.')}
            actionLabel={tr("스토어에서 업데이트")} onAction={() => {
              play('selection');
              setStoreError(false);
              void Linking.openURL(storeUrl).catch(() => setStoreError(true));
            }} />
        </View>
      </SafeAreaView> : status === 'error' ? <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <View style={styles.content}>
          <StateCard kind="error" title={tr("업데이트를 확인할 수 없어요")} body={tr("인터넷 연결을 확인하고 다시 시도해 주세요.")}
            actionLabel={tr("다시 확인")} onAction={() => { play('selection'); setStatus('checking'); void check(); }} />
        </View>
      </SafeAreaView> : introDone ? <View style={[styles.screen, { backgroundColor: theme.background }]} accessibilityLabel={tr("새 버전 확인 중")}>
        <GlingLoader color={theme.accent} style={styles.spinner} />
      </View> : <LaunchMoment ready={status === 'allowed'} onComplete={() => setIntroDone(true)} />}
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: Spacing.three },
  content: { width: '100%', maxWidth: 400, alignSelf: 'center', gap: Spacing.three, alignItems: 'center' },
  spinner: { alignSelf: 'center' },
});
