import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import { SymbolView } from '@/components/symbol-view';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Platform, StyleSheet, View, type ViewInstance } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ClayBoxFill, ClayPillFill, useClay, useClayBox } from '@/components/clay';
import { Pressable } from '@/components/analytics-controls';
import { CoachMarks, tabTarget, type CoachStep } from '@/components/coach-marks';
import { animateLayout } from '@/components/disclosure';
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

let replayTour = false;
/** Settings' "처음 안내 다시 보기": the guide comes back after "더 이상 안 보기", and the tour opens on Home (I-home-03). */
export function resetStartGuide() {
  return AsyncStorage.setItem(START_GUIDE_KEY, JSON.stringify(EMPTY)).then(() => { replayTour = true; });
}

/** Home's real buttons the tour lights up, measured where they are. */
export type TourTargets = Record<'city' | 'search' | 'chips' | 'write', RefObject<ViewInstance | null>>;
type Icon = SymbolViewProps['name'];
const WEB = Platform.OS === 'web';
// app-tabs.web.tsx: a 53pt button (padding, icon, label line) with 8pt above and below.
const WEB_TAB_BAR = 69;

// Home owns `touring` so its floating + stays on screen while the tour points at it.
export function StartGuide({ cityName, cityPicks = 0, onPickCity, onOpenMeetups, touring, onTouring, targets }: {
  cityName: string; cityPicks?: number; onPickCity: () => void; onOpenMeetups: () => void; touring: boolean; onTouring: (open: boolean) => void; targets: TourTargets;
}) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const clay = useClay(), clayBox = useClayBox();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const [state, setState] = useState<GuideState | null>(null);

  // Re-read on focus so "처음 안내 다시 보기" in settings shows it again on return, and opens the tour.
  useFocusEffect(useCallback(() => {
    void AsyncStorage.getItem(START_GUIDE_KEY).then(raw => setState(raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY)).catch(() => setState(EMPTY));
    if (!replayTour) return;
    replayTour = false;
    // After the settings screen has slid away, so the buttons are measured where they rest.
    const timer = setTimeout(() => onTouring(true), 500);
    return () => clearTimeout(timer);
  }, [onTouring]));

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
      icon: { ios: 'hand.point.up.left', android: 'touch_app', web: 'touch_app' }, run: () => onTouring(true) },
    { id: 'meetup', title: tr('모임 구경하기'), body: tr('이번 주 열리는 모임을 보고, 마음에 들면 바로 신청할 수 있어요.'),
      icon: { ios: 'person.2', android: 'groups', web: 'groups' }, run: () => { onOpenMeetups(); complete('meetup'); } },
  ];

  // Home's real buttons one at a time, one line each (I-home-03 A). Chat and notifications are left out: their tab names say enough.
  // The map is the middle of five native tabs (app-tabs.tsx). The web has no map tab or floating +, so its last step points at its 글쓰기 tab, also the middle of five.
  const tour: CoachStep[] = [
    { targets: [targets.city], title: tr('여기서 도시를 바꿔요'), body: tr('고른 도시의 글·모임·장소가 나와요.') },
    { targets: [targets.search], title: tr('글·모임·비즈니스를 한 번에 찾아요'), body: tr("'원베드', '알바'처럼 짧게 쳐 보세요.") },
    { targets: [targets.chips], title: tr('보고 싶은 주제만 골라요'), body: tr("나머지 주제는 맨 끝 '더보기'에 있어요.") },
    WEB ? { targets: [tabTarget(2, 5, WEB_TAB_BAR, 0)], title: tr('글쓰기는 아래에 있어요'), body: tr('궁금한 걸 묻거나 집·일자리·중고 글을 올려요. 주제를 고르면 맞는 칸이 나와요.') }
      : { targets: [tabTarget(2, 5), targets.write], title: tr('지도와 글쓰기는 아래에 있어요'), body: tr('지도에는 집·중고 물건·행사가 한 장에 나와요. 묻고 싶은 게 생기면 +를 눌러요.') },
  ];

  // One line instead of three explained rows (QA I-home-01): the steps left are chips that run the step, done steps drop out.
  // The step's longer description stays in its accessibility label.
  const left = steps.filter(step => !state.done.includes(step.id));
  return (
    <View style={[styles.card, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>
      {clayBox && <ClayBoxFill kind="tile" />}
      <View style={styles.head}>
        <ThemedText accessibilityRole="header" style={Typography.section}>{tr('시작하기')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>{tr('{0}/3 완료', state.done.length)}</ThemedText>
        <Pressable analyticsId="start-guide.hide" accessibilityRole="button" accessibilityLabel={tr('더 이상 안 보기')} accessibilityHint={tr('설정에서 다시 볼 수 있어요')}
          onPress={() => { play('selection'); save({ ...state, hidden: true }); }}
          style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
          <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={IconSize.inline} tintColor={theme.textSecondary} />
        </Pressable>
      </View>
      <View accessible={false} style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.fill, { width: `${(state.done.length / steps.length) * 100}%`, backgroundColor: theme.accent }]} />
      </View>
      <View style={styles.chips}>
        {left.map(step => (
          <Pressable key={step.id} analyticsId={`start-guide.${step.id}`} accessibilityRole="button" accessibilityLabel={`${step.title}. ${step.body}`}
            onPress={() => { play('selection'); step.run(); }}
            style={({ pressed }) => [ControlStyles.pill, styles.chip, clay && styles.clayChip, controlPresentation(theme, { pressed, clay }).container]}>
            {clay && <ClayPillFill kind="white" />}
            <SymbolView name={step.icon} size={IconSize.inline} tintColor={theme.accent} />
            <ThemedText type="label">{step.title}</ThemedText>
          </Pressable>
        ))}
      </View>

      {/* Seen to the end or skipped, the tour counts as done, as before. */}
      <CoachMarks visible={touring} steps={tour} analyticsIds={{ next: 'start-guide.tour.done', skip: 'sheet.close' }} onClose={() => { onTouring(false); complete('tour'); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  clayCard: { backgroundColor: 'transparent', borderColor: 'transparent', overflow: 'visible' },
  card: { borderWidth: 1, borderRadius: 20, padding: Spacing.three, gap: Spacing.two, marginTop: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginRight: -Spacing.two },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { flexDirection: 'row', gap: Spacing.one + Spacing.half, borderWidth: 1 },
  clayChip: { overflow: 'visible', paddingHorizontal: 18 },
});
