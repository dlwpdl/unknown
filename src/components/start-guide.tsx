import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, IconSize, Typography, controlPresentation } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export const START_GUIDE_KEY = 'gling.startGuide.v1';
type Step = 'city' | 'tour' | 'meetup';
type GuideState = { hidden: boolean; done: Step[] };
const EMPTY: GuideState = { hidden: false, done: [] };

/** Settings uses this to bring the guide back after "더 이상 안 보기". */
export function resetStartGuide() {
  return AsyncStorage.setItem(START_GUIDE_KEY, JSON.stringify(EMPTY));
}

type Icon = SymbolViewProps['name'];
const TOUR: { icon: Icon; title: string; body: string }[] = [
  { icon: { ios: 'location', android: 'location_on', web: 'location_on' }, title: '위쪽 도시 이름', body: '눌러서 사는 도시로 바꿀 수 있어요. 글·모임·장소가 모두 그 도시 기준으로 바뀌어요.' },
  { icon: { ios: 'magnifyingglass', android: 'search', web: 'search' }, title: '돋보기 (검색)', body: '제목·내용·해시태그로 이웃 글을 찾아요. "원베드", "알바"처럼 짧게 쳐 보세요.' },
  { icon: { ios: 'map', android: 'map', web: 'map' }, title: '지도', body: '렌트·매매 매물, 중고거래, 가볼 만한 곳, 행사를 지도에서 한눈에 봐요.' },
  { icon: { ios: 'line.3.horizontal.decrease', android: 'filter_list', web: 'filter_list' }, title: '카테고리 줄', body: "맨 위 로고 바로 밑 줄이에요. 부동산·구인구직·중고거래처럼 주제별로 모아 보고, 끝의 '더보기'에 나머지가 있어요." },
  { icon: { ios: 'person.2', android: 'groups', web: 'groups' }, title: '아래 모임 탭', body: '이번 주 열리는 모임을 보고 바로 신청해요. 직접 모임을 열 수도 있어요.' },
  { icon: { ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }, title: '아래 글쓰기 탭', body: '궁금한 걸 묻거나 집·일자리·중고 글을 올려요. 주제를 고르면 맞는 칸이 나와요.' },
  { icon: { ios: 'bubble.left.and.bubble.right', android: 'forum', web: 'forum' }, title: '채팅 · 알림', body: '채팅은 1:1 대화와 모임 단톡방, 알림은 내 글에 달린 댓글과 모임 소식이에요.' },
];

export function StartGuide({ cityName, onPickCity, onOpenMeetups }: { cityName: string; onPickCity: () => void; onOpenMeetups: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [state, setState] = useState<GuideState | null>(null);
  const [touring, setTouring] = useState(false);

  // Re-read on focus so "처음 안내 다시 보기" in settings shows it again on return.
  useFocusEffect(useCallback(() => {
    void AsyncStorage.getItem(START_GUIDE_KEY).then(raw => setState(raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY)).catch(() => setState(EMPTY));
  }, []));

  const save = (next: GuideState) => {
    setState(next);
    void AsyncStorage.setItem(START_GUIDE_KEY, JSON.stringify(next)).catch(() => {});
  };
  const complete = (step: Step) => {
    if (!state || state.done.includes(step)) return;
    const done = [...state.done, step];
    save({ hidden: done.length === 3, done });
  };

  if (!state || state.hidden) return null;
  const steps: { id: Step; title: string; body: string; icon: Icon; run: () => void }[] = [
    { id: 'city', title: tr('내 도시 고르기'), body: tr('지금은 {0} 글을 보고 있어요. 사는 도시로 바꾸면 그 동네 글과 모임만 보여요.', tr(cityName)),
      icon: { ios: 'location', android: 'location_on', web: 'location_on' }, run: () => { onPickCity(); complete('city'); } },
    { id: 'tour', title: tr('화면 둘러보기'), body: tr('카테고리, 검색, 지도, 글쓰기가 어디 있고 무엇을 하는지 알려 드려요.'),
      icon: { ios: 'hand.point.up.left', android: 'touch_app', web: 'touch_app' }, run: () => setTouring(true) },
    { id: 'meetup', title: tr('모임 구경하기'), body: tr('이번 주 열리는 모임을 보고, 마음에 들면 바로 신청할 수 있어요.'),
      icon: { ios: 'person.2', android: 'groups', web: 'groups' }, run: () => { onOpenMeetups(); complete('meetup'); } },
  ];

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <ThemedText accessibilityRole="header" style={Typography.section}>{tr('처음이세요? 여기서부터 시작해요')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tr('{0}/3 완료', state.done.length)}</ThemedText>
        </View>
      </View>
      {steps.map(step => {
        const done = state.done.includes(step.id);
        return (
          <Pressable key={step.id} analyticsId={`start-guide.${step.id}`} accessibilityRole="button" accessibilityState={{ checked: done }}
            accessibilityLabel={`${step.title}. ${step.body}`}
            onPress={() => { play('selection'); step.run(); }}
            style={({ pressed }) => [styles.step, { borderColor: theme.line }, pressed && { backgroundColor: theme.backgroundSelected }]}>
            <View style={[styles.stepIcon, { backgroundColor: done ? theme.accent : theme.backgroundElement }]}>
              <SymbolView name={done ? { ios: 'checkmark', android: 'check', web: 'check' } : step.icon} size={IconSize.inline} tintColor={done ? theme.accentInk : theme.accent} />
            </View>
            <View style={styles.flex}>
              <ThemedText type="smallBold" style={done && { color: theme.textSecondary }}>{step.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{step.body}</ThemedText>
            </View>
            <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={IconSize.chevron} tintColor={theme.textSecondary} />
          </Pressable>
        );
      })}
      <Pressable analyticsId="start-guide.hide" accessibilityRole="button" accessibilityHint={tr('설정에서 다시 볼 수 있어요')}
        onPress={() => { play('selection'); save({ ...state, hidden: true }); }}
        style={({ pressed }) => [ControlStyles.pill, styles.hide, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
        <ThemedText type="small" themeColor="textSecondary">{tr('더 이상 안 보기 · 설정에서 다시 볼 수 있어요')}</ThemedText>
      </Pressable>

      <Modal visible={touring} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setTouring(false); complete('tour'); }}>
        <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
          <ScrollView analyticsId="start-guide.tour" contentContainerStyle={styles.tour}>
            <ThemedText accessibilityRole="header" style={Typography.sheetTitle}>{tr('글링은 이렇게 생겼어요')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{tr('오늘 화면 위에서 아래 순서대로 보면 돼요.')}</ThemedText>
            {TOUR.map(item => (
              <View key={item.title} style={styles.tourRow}>
                <View style={[styles.stepIcon, { backgroundColor: theme.backgroundElement }]}>
                  <SymbolView name={item.icon} size={IconSize.inline} tintColor={theme.accent} />
                </View>
                <View style={styles.flex}>
                  <ThemedText type="smallBold">{tr(item.title)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{tr(item.body)}</ThemedText>
                </View>
              </View>
            ))}
            <Pressable analyticsId="start-guide.tour.done" accessibilityRole="button"
              onPress={() => { play('selection'); setTouring(false); complete('tour'); }}
              style={({ pressed }) => [ControlStyles.action, styles.tourDone, controlPresentation(theme, { tone: 'primary', pressed }).container]}>
              <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr('알겠어요')}</ThemedText>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderWidth: 1, borderRadius: 20, padding: Spacing.three, gap: Spacing.two, marginTop: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, marginBottom: Spacing.one },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.three, minHeight: 44 },
  stepIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  hide: { alignSelf: 'center', borderWidth: 0 },
  tour: { padding: Spacing.four, gap: Spacing.three },
  tourRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  tourDone: { marginTop: Spacing.three, borderWidth: 1 },
});
