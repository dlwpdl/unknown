import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { getChillingError, loadChillingApplication, type ChillingApplication } from '@/lib/chilling-data';
import { supabase } from '@/lib/supabase';

export default function MeetupApplicationRoute() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>(), { me, isAuthed } = useAuth();
  return <Application key={`${requestId}:${isAuthed ? me.id : 'guest'}`} requestId={requestId} />;
}
function Application({ requestId }: { requestId: string }) {
  const router = useRouter(), theme = useTheme(), hidden = useContentVisibility();
  const { isAuthed } = useAuth();
  const [application, setApplication] = useState<ChillingApplication | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    setApplication(null); setLoading(true); setError('');
    if (!isAuthed) { setLoading(false); return; }
    void loadChillingApplication(supabase, requestId).then(value => { if (active) setApplication(value); })
      .catch(e => { if (active) setError(getChillingError(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // retry deliberately re-runs the focused screen's load after an explicit retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, requestId, retry]));
  const visible = application && !hidden('post', application.postId, application.requesterId);
  return <ThemedView style={styles.fill}><SafeAreaView style={styles.fill}><ScrollView analyticsId="app_meetup-application.scrollview.1" contentContainerStyle={styles.content}>
    <Pressable analyticsId="app_meetup-application.pressable.1" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/chat')} accessibilityRole="button" style={styles.button}><ThemedText themeColor="accent">‹ 신청함으로</ThemedText></Pressable>
    <ThemedText type="title">공유받은 모임 프로필</ThemedText>
    {loading ? <ActivityIndicator color={theme.accent} accessibilityLabel="신청 정보 불러오는 중" /> : visible ? <>
      <ChillingProfileCard profile={application.profile} />
      <ThemedText type="smallBold" themeColor="accent">{application.question}</ThemedText><ThemedText>{application.answer}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">신청 시 공유한 프로필이에요. 검토 후 신청함으로 돌아가 승인 또는 거절해 주세요.</ThemedText>
    </> : <ThemedText>공유된 프로필이 없거나 열람 권한이 종료됐어요. 기존 모임의 신청 메시지는 신청함에서 확인할 수 있어요.</ThemedText>}
    {!!error && <><ThemedText accessibilityRole="alert">{error}</ThemedText><Pressable analyticsId="app_meetup-application.pressable.2" onPress={() => setRetry(x => x + 1)} style={styles.button} accessibilityRole="button"><ThemedText themeColor="accent">다시 시도</ThemedText></Pressable></>}
  </ScrollView></SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({ fill: { flex: 1 }, content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: Spacing.four }, button: { minHeight: 44, justifyContent: 'center' } });
