import { useLanguage } from '@/hooks/use-language';
import { Pressable } from '@/components/analytics-controls';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MeetupReviews } from '@/components/meetup-reviews';
import { MeetupLoyaltyTools } from '@/components/meetup-loyalty';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

/** Host tools and attendance moved out of the meetup detail; the server still decides what each viewer may do. */
export default function MeetupToolsRoute() {
  const { postId, kind, host } = useLocalSearchParams<{ postId: string; kind: string; host: string }>();
  const { tr } = useLanguage();
  const theme = useTheme(), router = useRouter();
  const { isAuthed, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const back = () => { if (router.canGoBack()) router.back(); else router.replace(Platform.OS === 'web' ? '/?tag=meetup' : '/(tabs)/meetups'); };
  const id = typeof postId === 'string' ? postId : '';
  return <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
    <View style={[styles.head, { backgroundColor: theme.background }]}><Pressable analyticsId="meetup.tools.back" accessibilityRole="button" accessibilityLabel={tr('뒤로가기')} onPress={() => { play('selection'); back(); }} style={({ pressed }) => [styles.back, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable><ThemedText accessibilityRole="header" style={styles.headTitle}>{host === '1' ? tr('호스트 도구') : tr('참석 확인')}</ThemedText></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {!isAuthed ? <StateCard kind="blocked" title={tr('로그인 후 확인할 수 있어요')} body={tr('모임에 참여한 계정으로 로그인해 주세요.')} actionLabel={tr('로그인')} onAction={() => promptLogin('모임을 관리하려면 로그인해 주세요.')} />
        : id ? <><MeetupReviews key={id} postId={id} kind={kind === 'once' ? 'once' : 'group'} attendanceOnly /><MeetupLoyaltyTools key={`loyalty:${id}`} postId={id} /></>
        : <StateCard kind="empty" title={tr('이 모임을 찾을 수 없어요.')} body={tr('삭제되었거나 볼 수 없는 모임이에요.')} />}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, head: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three }, back: { position: 'absolute', zIndex: 1, left: Spacing.three, width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, headTitle: { ...Typography.screenTitle, textAlign: 'center', flex: 1, paddingHorizontal: 44 + Spacing.two },
  content: { padding: 22, paddingBottom: Spacing.five, width: '100%', maxWidth: 640, alignSelf: 'center', gap: Spacing.three },
});
