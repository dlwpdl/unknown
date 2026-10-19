import { useLanguage } from '@/hooks/use-language';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '@/hooks/use-theme';
import { Colors } from '@/constants/theme';
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
  const iris = theme.background === Colors.dark.background ? IRIS.dark : IRIS.light;
  const [progress] = useState(() => Array.from({ length: 10 }, () => new Animated.Value(1)));
  const rounded = score != null && Number.isFinite(score) && score >= 1 && score <= 10 ? Math.round(score * 10) / 10 : null;
  useEffect(() => {
    const values = progress;
    if (reducedMotion || rounded == null) { values.forEach(value => value.setValue(1)); return; }
    values.forEach(value => value.setValue(0));
    const animation = Animated.stagger(22, values.slice(0, Math.ceil(rounded)).map(value =>
      Animated.timing(value, { toValue: 1, duration: 240, useNativeDriver: true })));
    animation.start();
    return () => { animation.stop(); values.forEach(value => value.setValue(1)); };
  }, [rounded, reviewKind, reducedMotion, progress]);
  const employment = reviewKind === 'employment';
  const shape = (color: string) => employment
    ? <View testID="merchant-rating-segment" style={[styles.segment, { backgroundColor: color }]} />
    : <Text style={[styles.sparkle, { color }]} accessible={false}>✦</Text>;
  return <View style={[styles.bar, employment && styles.employmentBar]} accessible accessibilityLabel={tr("{0} {1}", (label ?? (employment ? tr('근무') : tr('상품·서비스'))), (rounded == null ? tr('점수 없음') : tr("평균 {0}점, 10점 만점", rounded.toFixed(1))))}>
    {progress.map((value, index) => <View key={index} style={[styles.unit, employment && styles.employmentUnit]} accessible={false}>
      {shape(theme.line)}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
        transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [2, 0] }) }] }]}>
        <View testID={`merchant-rating-fill-${index}`} style={{ width: `${rounded == null ? 0 : Math.max(0, Math.min(10, Math.round(rounded * 10) - index * 10)) * 10}%`, overflow: 'hidden', height: employment ? 4 : 14 }}>
          {shape(iris[index])}
        </View>
      </Animated.View>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 2, width: 118, height: 14 },
  unit: { width: 10, height: 14 },
  inlineSparkle: { fontSize: 14 },
  sparkle: { width: 10, fontSize: 14, lineHeight: 14, textAlign: 'center', includeFontPadding: false },
  employmentBar: { gap: 0, height: 4, borderRadius: 2, overflow: 'hidden' },
  employmentUnit: { width: 11.8, height: 4 },
  segment: { width: 11.8, height: 4 },
});
