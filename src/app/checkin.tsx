import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlingLoader } from '@/components/gling-loader';
import { RaisedActionButton } from '@/components/raised-action-button';
import { StateCard } from '@/components/state-card';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { registerSecurityDevice } from '@/lib/account-security-device';
import { parseCheckInLink } from '@/lib/app-links';
import { useAuth } from '@/lib/auth';
import { checkInWithQr, questError } from '@/lib/host-quests';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

const MESSAGES: Record<string, string> = {
  QR_EXPIRED: 'QR이 바뀌었어요. 모임장 폰에 뜬 새 QR을 다시 찍어 주세요.',
  CHECK_IN_CLOSED: '모임 시간 안에만 체크인할 수 있어요.',
  SESSION_NOT_FOUND: '이 모임에 참여가 승인된 계정만 체크인할 수 있어요.',
  CHECK_IN_UNAVAILABLE: '이 모임에 참여가 승인된 계정만 체크인할 수 있어요.',
  INVALID_ATTENDEE: '모임장은 자기 QR로 체크인할 수 없어요.',
  DEVICE_REQUIRED: '이 기기를 확인하지 못했어요. 앱을 다시 열고 QR을 찍어 주세요.',
  RATE_LIMITED: '너무 여러 번 찍었어요. 잠시 후 다시 찍어 주세요.',
};

// https://gling.ej-entertainment.com/checkin?s=…&c=… — the phone camera opens this from the host's QR. The server checks the one-time code.
export default function CheckInRoute() {
  const params = useLocalSearchParams<{ s?: string; c?: string }>();
  const link = parseCheckInLink(params);
  const { tr } = useLanguage();
  const theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const { isAuthed, isAuthLoading, promptLogin, me } = useAuth();
  const [result, setResult] = useState<{ postId: string } | { error: string } | null>(null);
  const sent = useRef('');
  const key = link ? `${link.sessionId}:${link.code}:${me.id}` : '';

  useEffect(() => {
    if (!link || !isAuthed || sent.current === key) return;
    sent.current = key;
    void (async () => {
      try {
        let postId: string;
        try { postId = await checkInWithQr(supabase, link.sessionId, link.code); }
        catch (error) {
          // The device row is written right after sign-in; a scan straight after signing in can arrive first.
          if (questError(error, ['DEVICE_REQUIRED']) !== 'DEVICE_REQUIRED') throw error;
          await registerSecurityDevice(supabase, me.id, AsyncStorage);
          postId = await checkInWithQr(supabase, link.sessionId, link.code);
        }
        setResult({ postId }); play('success');
      } catch (error) {
        setResult({ error: questError(error, Object.keys(MESSAGES)) ?? '' }); play('warning');
      }
    })();
  }, [key, isAuthed]); // eslint-disable-line react-hooks/exhaustive-deps -- one scan per link and account

  const home = () => { play('selection'); router.replace('/'); };
  const body = !link ? <StateCard layout="start" mark="alert" title={tr('체크인 QR이 올바르지 않아요')} body={tr('모임장 폰에 뜬 QR을 다시 찍어 주세요.')}>
      <RaisedActionButton analyticsId="checkin.home" tone="secondary" label={tr('홈으로')} onPress={home} />
    </StateCard>
    : !isAuthed ? <StateCard layout="start" title={tr('로그인하고 체크인해 주세요')} body={tr('모임에 참여한 계정으로 로그인한 다음, 모임장 폰의 QR을 다시 찍어 주세요.')}>
      <RaisedActionButton analyticsId="checkin.login" label={tr('로그인')} disabled={isAuthLoading} onPress={() => { play('selection'); promptLogin('모임에 참여한 계정으로 로그인해 주세요.'); }} />
    </StateCard>
    : !result ? <GlingLoader color={theme.accent} accessibilityLabel={tr('체크인하는 중')} />
    : 'postId' in result ? <StateCard layout="start" mark="check" title={tr('체크인했어요')} body={tr('모임이 끝나면 모임장과 서로 참석 확인까지 하면 돼요.')}>
      <RaisedActionButton analyticsId="checkin.open_meetup" label={tr('모임 보기')} onPress={() => { play('selection'); router.replace({ pathname: '/post/[id]', params: { id: result.postId } }); }} />
    </StateCard>
    : <StateCard layout="start" mark="alert" title={tr('체크인하지 못했어요')} body={tr(MESSAGES[result.error] ?? '잠시 후 모임장 폰의 QR을 다시 찍어 주세요.')}>
      <RaisedActionButton analyticsId="checkin.home" tone="secondary" label={tr('홈으로')} onPress={home} />
    </StateCard>;
  return <ThemedView style={styles.container}>
    <SafeAreaView style={styles.safeArea}><View style={styles.content}>{body}</View></SafeAreaView>
  </ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { flex: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
});
