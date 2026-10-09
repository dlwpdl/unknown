import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '@/hooks/use-theme';
import type { MerchantReviewKind } from '@/lib/merchant-reviews';

const IRIS = ['#EEE7FF', '#E3D6FF', '#D8C4FF', '#CDB0FF', '#BD97FF', '#AD7BFF', '#9F61FF', '#9148FF', '#8538FF', '#7B2CFF'];

export function MerchantRatingBar({ score, reviewKind = 'usage' }: { score: number | null; reviewKind?: MerchantReviewKind }) {
  const theme = useTheme(), reducedMotion = useReducedMotion();
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
  return <View style={[styles.bar, employment && styles.employmentBar]} accessible accessibilityLabel={`${employment ? '근무' : '상품·서비스'} ${rounded == null ? '점수 없음' : `평균 ${rounded.toFixed(1)}점, 10점 만점`}`}>
    {progress.map((value, index) => <View key={index} style={[styles.unit, employment && styles.employmentUnit]} accessible={false}>
      {shape(theme.line)}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
        transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [2, 0] }) }] }]}>
        <View testID={`merchant-rating-fill-${index}`} style={{ width: `${rounded == null ? 0 : Math.max(0, Math.min(10, Math.round(rounded * 10) - index * 10)) * 10}%`, overflow: 'hidden', height: employment ? 4 : 14 }}>
          {shape(IRIS[index])}
        </View>
      </Animated.View>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 2, width: 118, height: 14 },
  unit: { width: 10, height: 14 },
  sparkle: { width: 10, fontSize: 14, lineHeight: 14, textAlign: 'center', includeFontPadding: false },
  employmentBar: { gap: 0, height: 4, borderRadius: 2, overflow: 'hidden' },
  employmentUnit: { width: 11.8, height: 4 },
  segment: { width: 11.8, height: 4 },
});
