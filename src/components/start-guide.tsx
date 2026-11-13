import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import { SymbolView } from '@/components/symbol-view';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClayBoxFill, ClayPillFill, useClay, useClayBox } from '@/components/clay';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { animateLayout } from '@/components/disclosure';
import { PopIn } from '@/components/state-card';
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
const WEB = Platform.OS === 'web';
// 앱은 지도 탭·떠 있는 글쓰기 버튼(owner 2026-11-01 A안), 웹은 아래 탭에 글쓰기가 그대로이고 지도 탭이 없어요.
const TOUR: { icon: Icon; title: string; body: string }[] = [
  { icon: { ios: 'location', android: 'location_on', web: 'location_on' }, title: '위쪽 도시 이름', body: '눌러서 사는 도시로 바꿀 수 있어요. 글·모임·장소가 모두 그 도시 기준으로 바뀌어요.' },
  { icon: { ios: 'magnifyingglass', android: 'search', web: 'search' }, title: '맨 위 돋보기', body: '프로필 옆에 있어요. 글·모임·장소·비즈니스를 한 번에 찾아요. "원베드", "알바"처럼 짧게 쳐 보세요.' },
  { icon: { ios: 'line.3.horizontal.decrease', android: 'filter_list', web: 'filter_list' }, title: '카테고리 줄', body: "도시 이름 바로 아래 줄이에요. 부동산·맛집처럼 주제별로 골라 볼 수 있어요. 나머지 주제는 맨 끝 '더보기'에 있어요." },
  ...(WEB ? [] : [{ icon: { ios: 'map', android: 'map', web: 'map' }, title: '아래 지도 탭', body: '집 매물, 중고 물건, 가볼 만한 곳, 행사가 지도 한 장에 다 나와요. 보고 싶은 것만 지도 위쪽에서 골라도 돼요.' } as const]),
  { icon: { ios: 'person.2', android: 'groups', web: 'groups' }, title: '아래 모임 탭', body: '이번 주 열리는 모임을 보고 바로 신청해요. 직접 모임을 열 수도 있어요.' },
  WEB
    ? { icon: { ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }, title: '아래 글쓰기 탭', body: '궁금한 걸 묻거나 집·일자리·중고 글을 올려요. 주제를 고르면 맞는 칸이 나와요.' }
    : { icon: { ios: 'plus', android: 'add', web: 'add' }, title: "'+ 글쓰기' 버튼", body: '홈 오른쪽 아래에 떠 있어요. 글을 내려 읽는 동안엔 잠깐 숨고, 위로 올리면 다시 나와요. 궁금한 걸 묻거나 집·일자리·중고 글을 올려요. 주제를 고르면 맞는 칸이 나와요.' },
  { icon: { ios: 'bubble.left.and.bubble.right', android: 'forum', web: 'forum' }, title: '채팅 · 알림', body: '채팅은 1:1 대화와 모임 단톡방, 알림은 내 글에 달린 댓글과 모임 소식이에요.' },
];

export function StartGuide({ cityName, cityPicks = 0, onPickCity, onOpenMeetups }: { cityName: string; cityPicks?: number; onPickCity: () => void; onOpenMeetups: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const clay = useClay(), clayBox = useClayBox();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const [state, setState] = useState<GuideState | null>(null);
  const [touring, setTouring] = useState(false);

  // Re-read on focus so "처음 안내 다시 보기" in settings shows it again on return.
  useFocusEffect(useCallback(() => {
    void AsyncStorage.getItem(START_GUIDE_KEY).then(raw => setState(raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY)).catch(() => setState(EMPTY));
  }, []));

  const save = (next: GuideState) => {
    animateLayout(reducedMotion);
    setState(next);
    void AsyncStorage.setItem(START_GUIDE_KEY, JSON.stringify(next)).catch(() => {});
  };
  const complete = (step: Step) => {
    if (!state || state.done.includes(step)) return;
    const done = [...state.done, step];
    save({ hidden: done.length === 3, done });
  };
  // A city picked from the top city button counts too, not only one picked from this card (QA Q17).
  const seenPicks = useRef(cityPicks);
  useEffect(() => {
    if (!state || seenPicks.current === cityPicks) return;
    seenPicks.current = cityPicks;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- once per new pick (seenPicks guard), and it also saves the step to storage
    if (!state.hidden) complete('city');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per new pick, after the saved steps have loaded
  }, [cityPicks, state]);

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
    <View style={[styles.card, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>
      {clayBox && <ClayBoxFill kind="tile" />}
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
              {done ? <PopIn><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={IconSize.inline} tintColor={theme.accentInk} /></PopIn>
                : <SymbolView name={step.icon} size={IconSize.inline} tintColor={theme.accent} />}
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

      <Modal visible={touring} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { play('selection'); setTouring(false); complete('tour'); }}>
        <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
          <ScrollView analyticsId="start-guide.tour" contentContainerStyle={styles.tour}>
            <ThemedText accessibilityRole="header" style={Typography.sheetTitle}>{tr('글링은 이렇게 생겼어요')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{tr('홈 화면 맨 위부터 차례로 보면 돼요.')}</ThemedText>
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
              style={({ pressed }) => [ControlStyles.action, styles.tourDone, controlPresentation(theme, { tone: 'primary', pressed, clay }).container]}>
              {clay && <ClayPillFill kind="cta" />}
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
  clayCard: { backgroundColor: 'transparent', borderColor: 'transparent', overflow: 'visible' },
  card: { borderWidth: 1, borderRadius: 20, padding: Spacing.three, gap: Spacing.two, marginTop: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, marginBottom: Spacing.one },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.three, minHeight: 44 },
  stepIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  hide: { alignSelf: 'center', borderWidth: 0 },
  tour: { padding: Spacing.four, gap: Spacing.three },
  tourRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  tourDone: { marginTop: Spacing.three, borderWidth: 1 },
});
