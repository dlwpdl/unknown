import { useLanguage } from '@/hooks/use-language';
import { Pressable } from '@/components/analytics-controls';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from '@/components/symbol-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MeetupEditLink, MeetupHostHome } from '@/components/meetup-host-home';
import { MeetupHostTools } from '@/components/meetup-host-tools';
import { MeetupMemberList, MeetupNoticeManager } from '@/components/meetup-loyalty';
import { MeetupReviews } from '@/components/meetup-reviews';
import { MeetupAutomation } from '@/components/meetup-automation';
import { MeetupSchedule } from '@/components/meetup-schedule';
import { MeetupCheckInQr, MeetupQuestPhoto } from '@/components/meetup-quest-tools';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

const TITLES: Record<string, string> = { schedule: '일정·참석', session: '회차', members: '멤버', notices: '공지', dues: '회비', settings: '운영 설정', 'checkin-qr': '체크인 QR', 'quest-photo': '모임 인증샷' };

/** Host management and attendance. Each area is the same route with a section, so the back gesture and transitions are the platform's. The server still decides what each viewer may do. */
export default function MeetupToolsRoute() {
  const { postId, kind: kindParam, host, section, sessionId } = useLocalSearchParams<{ postId: string; kind: string; host: string; section?: string; sessionId?: string }>();
  const { tr, language } = useLanguage();
  const theme = useTheme(), router = useRouter();
  const { isAuthed, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const back = () => { if (router.canGoBack()) router.back(); else router.replace(Platform.OS === 'web' ? '/?tag=meetup' : '/(tabs)/meetups'); };
  const id = typeof postId === 'string' ? postId : '';
  const kind = kindParam === 'once' ? 'once' : 'group', own = host === '1';
  // 공지 is also the tag on a single notice ("Notice"); this screen lists them.
  const title = section === 'notices' && language === 'en' ? 'Notices' : section && TITLES[section] ? tr(TITLES[section]) : own ? tr('호스트 관리') : tr('참석 확인');
  const home = own && !section && isAuthed && !!id;
  const body = !isAuthed ? <StateCard kind="blocked" title={tr('로그인 후 확인할 수 있어요')} body={tr('모임에 참여한 계정으로 로그인해 주세요.')} actionLabel={tr('로그인')} onAction={() => promptLogin('모임을 관리하려면 로그인해 주세요.')} />
    : !id ? <StateCard kind="empty" title={tr('이 모임을 찾을 수 없어요.')} body={tr('삭제되었거나 볼 수 없는 모임이에요.')} />
    : section === 'schedule' ? <MeetupSchedule key={id} postId={id} kind={kind} host={own} />
    : section === 'session' ? <MeetupReviews key={`${id}:${sessionId}`} postId={id} kind={kind} attendanceOnly sessionId={typeof sessionId === 'string' ? sessionId : undefined} />
    : section === 'members' ? <><MeetupMemberList key={id} postId={id} /><MeetupHostTools key={`waitlist:${id}`} postId={id} sections={['waitlist']} /></>
    : section === 'checkin-qr' && typeof sessionId === 'string' ? <MeetupCheckInQr key={sessionId} sessionId={sessionId} />
    : section === 'quest-photo' && typeof sessionId === 'string' ? <MeetupQuestPhoto key={sessionId} sessionId={sessionId} />
    : section === 'notices' ? <MeetupNoticeManager key={id} postId={id} />
    : section === 'dues' ? <MeetupHostTools key={id} postId={id} sections={['dues']} />
    : section === 'settings' ? <><MeetupHostTools key={id} postId={id} sections={['cohosts']} /><MeetupAutomation key={`automation:${id}`} postId={id} /><MeetupHostTools key={`stats:${id}`} postId={id} sections={['stats']} /></>
    : <MeetupReviews key={id} postId={id} kind={kind} attendanceOnly />;
  return <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
    <View style={[styles.head, { backgroundColor: theme.background }]}>
      <Pressable analyticsId="meetup.tools.back" accessibilityRole="button" accessibilityLabel={tr('뒤로가기')} onPress={() => { play('selection'); back(); }} style={({ pressed }) => [styles.back, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable>
      <ThemedText accessibilityRole="header" numberOfLines={1} style={styles.headTitle}>{title}</ThemedText>
      {home && <View style={styles.right}><MeetupEditLink postId={id} /></View>}
    </View>
    {home ? <MeetupHostHome key={id} postId={id} kind={kind} />
      : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{body}</ScrollView>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, head: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three }, back: { position: 'absolute', zIndex: 1, left: Spacing.three, width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, right: { position: 'absolute', zIndex: 1, right: Spacing.three }, headTitle: { ...Typography.section, textAlign: 'center', flex: 1, paddingHorizontal: 80 },
  content: { padding: 22, paddingBottom: Spacing.five, width: '100%', maxWidth: 640, alignSelf: 'center', gap: Spacing.two },
});
