import { StyleSheet, View } from 'react-native';

import { GlingRatingIcon } from '@/components/merchant-rating-bar';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { getPlaceExternalRatings } from '@/lib/place-external-ratings';
import type { PlaceRatingSummary } from '@/lib/place-reviews';

export function getPlaceReviewRating(cityId: string, placeId: string, summary?: PlaceRatingSummary) {
  const external = getPlaceExternalRatings(cityId, placeId)[0];
  const externalScore = external ? external.score * 2 : null;
  const known = summary?.cityId === cityId && summary.placeId === placeId ? summary : undefined;
  const own = known && known.count > 0 && known.average != null;
  return { cityId, placeId, score: own ? known.average : externalScore,
    source: own ? 'gling' as const : external ? 'external' as const : null,
    count: known?.count ?? null, externalScore, externalCount: external?.count ?? null };
}

export function PlaceReviewSummary({ rating, compact = false }: { rating: ReturnType<typeof getPlaceReviewRating>; compact?: boolean }) {
  const { tr, locale } = useLanguage();
  const count = rating.source === 'gling' ? rating.count : rating.externalCount;
  if (rating.score == null) return <ThemedText type="small" themeColor="accent" style={compact ? styles.compact : undefined}>
    {tr(rating.count === 0 ? '첫 리뷰 남기기' : '글링 리뷰 보기')}
  </ThemedText>;
  return <View style={styles.summary}>
    <ThemedText type="smallBold" style={compact ? styles.compactScore : undefined}>
      <GlingRatingIcon score={rating.score} />{' '}{rating.score.toFixed(1)}<ThemedText type="small" themeColor="textSecondary" style={compact ? styles.compactScale : undefined}> /10</ThemedText>
    </ThemedText>
    {count != null && <ThemedText type="small" themeColor="textSecondary" style={compact ? styles.compact : undefined} numberOfLines={2}>
      {tr(rating.source === 'gling' ? '글링 {0}개 평가' : '{0}개 평가', count.toLocaleString(locale))}
    </ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  summary: { gap: 2 },
  compactScore: { fontSize: 13, lineHeight: 20 },
  compactScale: { fontSize: 11, lineHeight: 20 },
  compact: { fontSize: 11, lineHeight: 15 },
});
