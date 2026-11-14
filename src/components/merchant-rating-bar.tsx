import { useLanguage } from '@/hooks/use-language';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '@/hooks/use-theme';
import { Colors } from '@/constants/theme';
import { Pressable } from '@/components/analytics-controls';
import { SymbolView } from '@/components/symbol-view';
import { ControlStyles, controlPresentation } from '@/constants/design-system';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { MerchantReviewKind } from '@/lib/merchant-reviews';

const IRIS = {
  dark: ['#716180', '#79628F', '#82639F', '#8B64B0', '#9465C1', '#9D66D3', '#A86AE4', '#B470F3', '#BF7BFC', '#CA8CFF'],
  light: ['#665272', '#6D5182', '#745192', '#7A50A1', '#814FB1', '#884FC0', '#8F4ED0', '#954DE0', '#9C4DEF', '#A34DFF'],
};

export function GlingRatingIcon({ score }: { score: number | null }) {
  const theme = useTheme();
  const iris = theme.background === Colors.dark.background ? IRIS.dark : IRIS.light;
  const band = score != null && Number.isFinite(score) && score > 0 && score <= 10 ? Math.ceil(score) - 1 : null;
  const color = band == null ? theme.line : iris[band];
  return <Text style={[styles.inlineSparkle, { color, textShadowColor: color, textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: band == null ? 0 : Math.max(0, band - 6) * 0.7 }]} accessible={false}>✦</Text>;
}

export function MerchantRatingBar({ score, reviewKind = 'usage', label }: { score: number | null; reviewKind?: MerchantReviewKind; label?: string }) {
  const { tr } = useLanguage();
  const theme = useTheme(), reducedMotion = useReducedMotion();
  const dark = theme.background === Colors.dark.background, iris = dark ? IRIS.dark : IRIS.light;
  // The line colour vanished on white cards (QA H43-6), so light mode draws empty marks in 70% secondary grey (about 3:1 on white).
  // Dark keeps line: a brighter grey there would read like the lowest filled iris colour.
  const empty = dark ? theme.line : `${theme.textSecondary}B3`;
  const employment = reviewKind === 'employment';
  // Both kinds draw the same five sparkles worth two points each, so one score reads one way everywhere (QA A-company-01).
  const pointsPerUnit = 2, unitCount = 5;
  const [progress] = useState(() => Array.from({ length: 5 }, () => new Animated.Value(1)));
  const rounded = score != null && Number.isFinite(score) && score >= 1 && score <= 10 ? Math.round(score * 10) / 10 : null;
  useEffect(() => {
    const values = progress.slice(0, unitCount);
    if (reducedMotion || rounded == null) { values.forEach(value => value.setValue(1)); return; }
    values.forEach(value => value.setValue(0));
    const animation = Animated.stagger(22, values.slice(0, Math.ceil(rounded / pointsPerUnit)).map(value =>
      Animated.timing(value, { toValue: 1, duration: 240, useNativeDriver: true })));
    animation.start();
    return () => { animation.stop(); values.forEach(value => value.setValue(1)); };
  }, [rounded, pointsPerUnit, unitCount, reducedMotion, progress]);
  const shape = (color: string) => <Text style={[styles.sparkle, { color }]} accessible={false}>✦</Text>;
  return <View style={styles.bar} accessible accessibilityLabel={tr("{0} {1}", (label ?? (employment ? tr('직원 후기') : tr('상품·서비스 후기'))), (rounded == null ? tr('점수 없음') : tr("평균 {0}점, 10점 만점", rounded.toFixed(1))))}>
    {progress.slice(0, unitCount).map((value, index) => <View key={index} style={styles.unit} accessible={false}>
      {shape(empty)}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
        transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [2, 0] }) }] }]}>
        <View testID={`merchant-rating-fill-${index}`} style={{ width: `${rounded == null ? 0 : Math.max(0, Math.min(100, Math.round((rounded / pointsPerUnit - index) * 100)))}%`, overflow: 'hidden', height: 14 }}>
          {shape(iris[(index + 1) * pointsPerUnit - 1])}
        </View>
      </Animated.View>
    </View>)}
  </View>;
}

/** Next score for RatingScorePicker: a mark is worth two points and a second tap on a full mark takes one off; a step moves 0.5 within 1–10. */
export function ratingPickerNext(current: number | null, action: { mark: number } | { step: 1 | -1 }): number | null {
  if ('mark' in action) { const full = action.mark * 2; return current === full ? full - 1 : full; }
  if (current == null) return action.step > 0 ? 1 : null;
  return Math.min(10, Math.max(1, current + action.step / 2));
}

/** Picks a 1–10 score in 0.5 steps with the same five ✦ marks the score bar shows (QA A-place-02). Screen readers get one adjustable control. */
export function RatingScorePicker({ value, onChange, label, analyticsId, disabled = false, testID }: { value: number | null; onChange: (score: number) => void; label: string; analyticsId: string; disabled?: boolean; testID?: string }) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const dark = theme.background === Colors.dark.background, iris = dark ? IRIS.dark : IRIS.light;
  const empty = dark ? theme.line : `${theme.textSecondary}B3`;
  const pick = (next: number | null) => { if (disabled || next == null || next === value) return; play('selection'); onChange(next); };
  const step = (direction: 1 | -1, edge: boolean) => <Pressable analyticsId={analyticsId} testID={testID && `${testID}.${direction > 0 ? 'up' : 'down'}`}
    accessibilityRole="button" accessibilityLabel={tr(direction > 0 ? '0.5점 올리기' : '0.5점 내리기')} disabled={disabled || edge} onPress={() => pick(ratingPickerNext(value, { step: direction }))}
    style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', pressed, disabled: disabled || edge }).container, { opacity: disabled || edge ? 0.4 : 1 }]}>
    <SymbolView name={direction > 0 ? { ios: 'plus', android: 'add', web: 'add' } : { ios: 'minus', android: 'remove', web: 'remove' }} size={18} tintColor={theme.text} />
  </Pressable>;
  return <View testID={testID} style={styles.picker} accessible accessibilityRole="adjustable" accessibilityLabel={label}
    accessibilityState={{ disabled }} accessibilityValue={{ min: 1, max: 10, now: value ?? undefined, text: value == null ? tr('점수를 선택해 주세요') : tr('{0}점 / 10점', value.toFixed(1)) }}
    accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
    onAccessibilityAction={({ nativeEvent }) => pick(ratingPickerNext(value, { step: nativeEvent.actionName === 'increment' ? 1 : -1 }))}>
    {step(-1, value == null || value <= 1)}
    <View style={styles.marks}>{[1, 2, 3, 4, 5].map(mark => <Pressable key={mark} analyticsId={analyticsId} testID={testID && `${testID}.mark.${mark}`}
      accessibilityRole="button" accessibilityLabel={tr('{0}점', mark * 2)} disabled={disabled} onPress={() => pick(ratingPickerNext(value, { mark }))} style={styles.mark}>
      <View style={styles.markGlyph}>
        <Text style={[styles.bigSparkle, { color: empty }]} accessible={false}>✦</Text>
        <View style={[StyleSheet.absoluteFill, { width: `${value == null ? 0 : Math.max(0, Math.min(100, Math.round((value / 2 - (mark - 1)) * 100)))}%`, overflow: 'hidden' }]}>
          <Text style={[styles.bigSparkle, { color: iris[mark * 2 - 1] }]} accessible={false}>✦</Text>
        </View>
      </View>
    </Pressable>)}</View>
    {step(1, value != null && value >= 10)}
  </View>;
}

const styles = StyleSheet.create({
  picker: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  marks: { flexDirection: 'row' },
  mark: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  markGlyph: { width: 30, height: 34 },
  bigSparkle: { width: 30, fontSize: 30, lineHeight: 34, textAlign: 'center', includeFontPadding: false },
  bar: { flexDirection: 'row', gap: 2, width: 58, height: 14 },
  unit: { width: 10, height: 14 },
  inlineSparkle: { fontSize: 14 },
  sparkle: { width: 10, fontSize: 14, lineHeight: 14, textAlign: 'center', includeFontPadding: false },
});
