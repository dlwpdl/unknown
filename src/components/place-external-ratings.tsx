import { SymbolView } from 'expo-symbols';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { getPlaceExternalRatings } from '@/lib/place-external-ratings';

type PlaceScope = { cityId: string; placeId: string };

export function PlaceRatingSummary({ cityId, placeId }: PlaceScope) {
  const { tr, locale } = useLanguage();
  const rating = getPlaceExternalRatings(cityId, placeId)[0];
  if (!rating) return null;
  return <ThemedText type="small" numberOfLines={2}>
    {rating.provider} {rating.score.toFixed(1)}/5 · {tr('{0}개 평가', rating.count.toLocaleString(locale))}
  </ThemedText>;
}

export function PlaceExternalRatings({ cityId, placeId }: PlaceScope) {
  const { tr, locale } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback();
  const ratings = getPlaceExternalRatings(cityId, placeId);
  if (!ratings.length) return null;
  const open = (url: string) => {
    play('selection');
    void Linking.openURL(url).catch(() => {
      play('warning'); Alert.alert(tr('페이지를 열지 못했어요'), tr('잠시 후 다시 시도해 주세요.'));
    });
  };
  return <View style={styles.section}>
    <ThemedText type="smallBold" accessibilityRole="header">{tr('외부 평점')}</ThemedText>
    {ratings.map(rating => <Pressable key={rating.provider} analyticsId="places.rating.source" accessibilityRole="link"
      accessibilityLabel={tr('{0} 평점 {1}/5 · {2}개 평가 · 출처 보기', rating.provider, rating.score.toFixed(1), rating.count.toLocaleString(locale))}
      onPress={() => open(rating.sourceUrl)}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.card, borderColor: theme.line, opacity: pressed ? 0.65 : 1 }]}>
      <View style={styles.source}>
        <ThemedText type="smallBold">{rating.provider}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr('{0}에서 확인', rating.via)}</ThemedText>
        <ThemedText style={styles.date} themeColor="textSecondary">{tr('{0} 확인', new Date(rating.checkedAt).toLocaleDateString(locale))}</ThemedText>
      </View>
      <View style={styles.score}>
        <ThemedText style={styles.number}>{rating.score.toFixed(1)}<ThemedText type="small" themeColor="textSecondary"> /5</ThemedText></ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr('{0}개 평가', rating.count.toLocaleString(locale))}</ThemedText>
      </View>
      <SymbolView name={{ ios: 'arrow.up.right', android: 'north_east', web: 'north_east' }} size={15} tintColor={theme.textSecondary} />
    </Pressable>)}
    <ThemedText type="small" themeColor="textSecondary">{tr('평점은 확인한 날짜 기준이에요. 누르면 출처의 후기를 볼 수 있어요.')}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  card: { minHeight: 96, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: Spacing.three,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  source: { flex: 1, gap: Spacing.one },
  score: { alignItems: 'flex-end', gap: Spacing.one, flexShrink: 1 },
  number: { fontSize: 26, lineHeight: 34, fontWeight: '700' },
  date: { fontSize: 11, lineHeight: 16 },
});
