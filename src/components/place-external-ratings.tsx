import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { GlingRatingIcon } from '@/components/merchant-rating-bar';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { getPlaceExternalRatings } from '@/lib/place-external-ratings';

type PlaceScope = { cityId: string; placeId: string };

export function PlaceExternalRatings({ cityId, placeId }: PlaceScope) {
  const { tr, locale } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback();
  const [expanded, setExpanded] = useState(false);
  const ratings = getPlaceExternalRatings(cityId, placeId);
  if (!ratings.length) return null;
  const open = (url: string) => {
    play('selection');
    void Linking.openURL(url).catch(() => {
      play('warning'); Alert.alert(tr('페이지를 열지 못했어요'), tr('잠시 후 다시 시도해 주세요.'));
    });
  };
  return <View style={styles.section}>
    <Pressable analyticsId="places.ratings.toggle" accessibilityRole="button" aria-expanded={expanded} accessibilityState={{ expanded }}
      onPress={() => { play('selection'); setExpanded(!expanded); }}
      style={({ pressed }) => [styles.toggle, { borderColor: theme.line, opacity: pressed ? 0.65 : 1 }]}>
      <ThemedText type="smallBold" themeColor="textSecondary">{tr('외부 평점 참고하기')}</ThemedText>
      <SymbolView name={{ ios: expanded ? 'chevron.up' : 'chevron.down', android: expanded ? 'expand_less' : 'expand_more', web: expanded ? 'expand_less' : 'expand_more' }} size={15} tintColor={theme.textSecondary} />
    </Pressable>
    {expanded && <>
    {ratings.map(rating => <Pressable key={rating.provider} analyticsId="places.detail.source" accessibilityRole="link"
      accessibilityLabel={tr('{0} 평점 {1}/5 · {2}개 평가 · 출처 보기', rating.provider, rating.score.toFixed(1), rating.count.toLocaleString(locale))}
      onPress={() => open(rating.sourceUrl)}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.card, borderColor: theme.line, opacity: pressed ? 0.65 : 1 }]}>
      <View style={styles.source}>
        <ThemedText type="smallBold">{rating.provider}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr('{0}에서 확인', rating.via)}</ThemedText>
        <ThemedText style={styles.date} themeColor="textSecondary">{tr('{0} 확인', new Date(rating.checkedAt).toLocaleDateString(locale))}</ThemedText>
      </View>
      <View style={styles.score}>
        <ThemedText style={styles.number}><GlingRatingIcon score={rating.score * 2} />{' '}{rating.score.toFixed(1)}<ThemedText type="small" themeColor="textSecondary"> /5</ThemedText></ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr('{0}개 평가', rating.count.toLocaleString(locale))}</ThemedText>
      </View>
      <SymbolView name={{ ios: 'arrow.up.right', android: 'north_east', web: 'north_east' }} size={15} tintColor={theme.textSecondary} />
    </Pressable>)}
    <ThemedText type="small" themeColor="textSecondary">{tr('외부 점수는 메인에서 10점 기준으로 환산해 보여줘요.')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{tr('평점은 확인한 날짜 기준이에요. 누르면 출처의 후기를 볼 수 있어요.')}</ThemedText>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  toggle: { minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  card: { minHeight: 96, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: Spacing.three,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  source: { flex: 1, gap: Spacing.one },
  score: { alignItems: 'flex-end', gap: Spacing.one, flexShrink: 1 },
  number: { fontSize: 26, lineHeight: 34, fontWeight: '700' },
  date: { fontSize: 11, lineHeight: 16 },
});
