import { useState, type RefObject } from 'react';
import { AccessibilityInfo, Modal, ScrollView, StyleSheet, View, type ViewInstance } from 'react-native';
import Reanimated, { FadeIn, FadeInDown, LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pressable } from '@/components/analytics-controls';
import { ClayPillFill, useClay } from '@/components/clay';
import { ThemedText } from '@/components/themed-text';
import { ControlMotion, ControlStyles, Typography, controlPresentation } from '@/constants/design-system';
import { Colors, MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export type CoachRect = { x: number; y: number; width: number; height: number };
type Screen = { width: number; height: number };
/** A view on screen to measure, or a frame worked out from the screen size for what can't be measured. */
export type CoachTarget = RefObject<ViewInstance | null> | ((screen: Screen) => CoachRect);
export type CoachStep = { targets: CoachTarget[]; title: string; body: string };

const PAD = Spacing.one, GAP = Spacing.three, TIP_WIDTH = 480;

// shortcut: native tab bars report no frame, so a tab is placed from the screen size, the bar height and the device's bottom inset
// (iOS 26's floating bar sits a few points off). Measure it instead if the tab bar ever exposes its frame.
export const tabTarget = (index: number, count: number, barHeight: number = TabBarHeight, bottomInset = initialWindowMetrics?.insets.bottom ?? 0): CoachTarget => ({ width, height }) => {
  const slot = Math.min(width, MaxContentWidth) / count;
  return { x: (width - slot * count) / 2 + slot * index, y: height - bottomInset - barHeight, width: slot, height: barHeight };
};

/** One band per hole, cut halfway between holes, so each band dims everything but its own hole. A step's targets stack top to bottom. */
export function coachBands(holes: CoachRect[], height: number) {
  const sorted = [...holes].sort((a, b) => a.y - b.y);
  const cut = (i: number) => i <= 0 ? 0 : i >= sorted.length ? height : (sorted[i - 1].y + sorted[i - 1].height + sorted[i].y) / 2;
  return sorted.map((hole, i) => ({ hole, top: cut(i), height: cut(i + 1) - cut(i) }));
}

/** Under the targets when they sit in the top half, over them otherwise, so a card that grows with large text grows away from them. */
export function coachTipPlace(holes: CoachRect[], screen: Screen, insets: { top: number; bottom: number }) {
  const top = Math.min(...holes.map(hole => hole.y)), bottom = Math.max(...holes.map(hole => hole.y + hole.height));
  const width = Math.min(screen.width - 2 * Spacing.three, TIP_WIDTH), left = (screen.width - width) / 2;
  return top + bottom < screen.height
    ? { left, width, top: bottom + GAP, maxHeight: screen.height - bottom - GAP - insets.bottom - Spacing.two }
    : { left, width, bottom: screen.height - top + GAP, maxHeight: top - GAP - insets.top - Spacing.two };
}

const radius = (hole: CoachRect) => Math.min(hole.width, hole.height) / 2;

const SETTLE_MS = 150;

function frame(target: CoachTarget, screen: Screen) {
  if (typeof target === 'function') return Promise.resolve<CoachRect | null>(target(screen));
  return new Promise<CoachRect | null>(resolve => {
    const view = target.current;
    if (!view) return resolve(null);
    const timer = setTimeout(() => resolve(null), 500 + SETTLE_MS);
    // A button that mounts for the tour (home's floating +) reads its own pre-layout spot, about 50pt low on a fresh start (QA I-home-03); a beat later it is where it rests.
    setTimeout(() => view.measureInWindow((x, y, width, height) => { clearTimeout(timer); resolve(width > 0 && height > 0 ? { x, y, width, height } : null); }), SETTLE_MS);
  });
}

/** Dims the screen and lights its real buttons one step at a time, with a short card beside them. Steps whose buttons aren't on screen are left out. */
export function CoachMarks({ visible, steps, analyticsIds, onClose }: { visible: boolean; steps: CoachStep[]; analyticsIds: { next: string; skip: string }; onClose: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme(), clay = useClay(), insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { play } = useInteractionFeedback();
  const [screen, setScreen] = useState<Screen | null>(null);
  const [shown, setShown] = useState<(CoachStep & { holes: CoachRect[] })[] | null>(null);
  const [at, setAt] = useState(0);

  const close = () => { play('selection'); setAt(0); setShown(null); onClose(); };
  // Measured once the overlay has its size: the buttons under it are laid out by then and the screen frame is the overlay's own.
  const measure = (next: Screen) => {
    setScreen(next);
    void Promise.all(steps.map(step => Promise.all(step.targets.map(target => frame(target, next))))).then(frames => {
      const found = steps.map((step, i) => ({ ...step, holes: frames[i].flatMap(rect => rect ? [{ x: rect.x - PAD, y: rect.y - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD }] : []).sort((a, b) => a.y - b.y) }))
        .filter(step => step.holes.length);
      if (found.length) setShown(found); else { setAt(0); onClose(); }
    });
  };
  const next = () => {
    const following = shown?.[at + 1];
    if (!following) return close();
    play('selection'); setAt(at + 1);
    AccessibilityInfo.announceForAccessibility(`${following.title}. ${following.body}`);
  };

  const step = shown?.[at], count = shown?.length ?? 0, last = at === count - 1;
  const scrim = theme === Colors.dark ? 'rgba(4,4,9,0.74)' : 'rgba(20,16,30,0.58)';
  const moving = reducedMotion ? undefined : LinearTransition.duration(ControlMotion.expandMs);
  // A border this thick around each hole covers its whole band; the band clips it.
  const reach = screen ? 2 * Math.max(screen.width, screen.height) : 0;
  return (
    <Modal visible={visible} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={close}>
      <View style={StyleSheet.absoluteFill} accessibilityViewIsModal onLayout={({ nativeEvent: { layout } }) => measure({ width: layout.width, height: layout.height })}>
        {!step || !screen ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: scrim }]} /> : <>
          {coachBands(step.holes, screen.height).map(({ hole, top, height }, i) => (
            <View key={i} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.band, { top, height }]}>
              <Reanimated.View layout={moving} style={{ position: 'absolute', left: hole.x - reach, top: hole.y - top - reach, width: hole.width + 2 * reach, height: hole.height + 2 * reach, borderWidth: reach, borderRadius: radius(hole) + reach, borderColor: scrim }} />
            </View>
          ))}
          {step.holes.map((hole, i) => (
            <Reanimated.View key={i} layout={moving} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
              style={[styles.ring, { left: hole.x, top: hole.y, width: hole.width, height: hole.height, borderRadius: radius(hole), borderColor: theme.accent }]} />
          ))}
          <Reanimated.View key={at} entering={(reducedMotion ? FadeIn : FadeInDown).duration(ControlMotion.settleMs)}
            style={[styles.tip, { backgroundColor: theme.card, borderColor: theme.line }, coachTipPlace(step.holes, screen, insets)]}>
            <ScrollView style={styles.tipText} contentContainerStyle={styles.tipTextContent}>
              <ThemedText accessibilityRole="header" style={Typography.section}>{step.title}</ThemedText>
              <ThemedText themeColor="textSecondary">{step.body}</ThemedText>
            </ScrollView>
            <View style={styles.tipFoot}>
              <ThemedText type="label" themeColor="textSecondary" accessibilityLabel={tr('{1}개 중 {0}번째', at + 1, count)} style={styles.count}>{`${at + 1}/${count}`}</ThemedText>
              {!last && <Pressable analyticsId={analyticsIds.skip} accessibilityRole="button" onPress={close}
                style={({ pressed }) => [ControlStyles.pill, controlPresentation(theme, { tone: 'ghost', pressed, reducedMotion }).container]}>
                <ThemedText type="label" themeColor="textSecondary">{tr('건너뛰기')}</ThemedText>
              </Pressable>}
              <Pressable analyticsId={analyticsIds.next} accessibilityRole="button" onPress={next}
                style={({ pressed }) => [ControlStyles.pill, clay && styles.clayPill, controlPresentation(theme, { tone: 'primary', pressed, reducedMotion, clay }).container]}>
                {clay && <ClayPillFill kind="cta" />}
                <ThemedText type="label" style={{ color: theme.accentInk }}>{last ? tr('다 봤어요') : tr('다음')}</ThemedText>
              </Pressable>
            </View>
          </Reanimated.View>
        </>}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', left: 0, right: 0, overflow: 'hidden' },
  ring: { position: 'absolute', borderWidth: 2 },
  tip: { position: 'absolute', borderWidth: 1, borderRadius: 20, padding: Spacing.three, gap: Spacing.two },
  tipText: { flexGrow: 0, flexShrink: 1 },
  tipTextContent: { gap: Spacing.one },
  tipFoot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.one },
  count: { flexGrow: 1 },
  clayPill: { overflow: 'visible', paddingHorizontal: 18 },
});
