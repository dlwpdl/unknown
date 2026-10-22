import { useLanguage } from '@/hooks/use-language';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { getPlaceReviewRating, PlaceReviewSummary } from '@/components/place-review-summary';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCityRecommendations } from '@/lib/city-places';
import { placeMapRoute } from '@/lib/discovery';
import { useCityPlacesRevision } from '@/hooks/use-city-places';
import { usePlaceReviewSummaries } from '@/hooks/use-place-review-summaries';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';

export function CityPopularPlaces({ cityId }: { cityId: string }) {
  const { tr } = useLanguage();
  const theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  useCityPlacesRevision();
  const city = CITIES.find(item => item.id === cityId);
  const places = city ? getCityRecommendations(cityId) : [];
  const ratings = usePlaceReviewSummaries(cityId, places.slice(0, 3).map(place => place.id));
  if (!city) return null;
  if (!places.length) return null;
  return <View style={styles.section}>
    <View style={styles.heading}>
      <ThemedText accessibilityRole="header" style={styles.title}>{tr("이 도시에서 가볼 만한 곳")}</ThemedText>
      <Pressable analyticsId="today.places.open" accessibilityRole="button" accessibilityLabel={tr("{0}의 실제 장소 {1}곳 보기", (tr(city.name)), (places.length))}
        onPress={() => { play('selection'); router.push({ pathname: '/places', params: { cityId } }); }}
        style={({ pressed }) => [styles.all, { opacity: pressed ? 0.65 : 1 }]}>
        <ThemedText style={styles.allText} themeColor="accent">{tr("전체 보기")}</ThemedText>
        <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={12} tintColor={theme.accent} />
      </Pressable>
    </View>
    <ThemedText style={styles.subtitle} themeColor="textSecondary">{tr("가볼 만한 곳과 레스토랑·카페를 골랐어요")}</ThemedText>
    <View style={styles.cards}>
      {places.slice(0, 3).map(place => {
        const rating = getPlaceReviewRating(cityId, place.id, ratings[place.id]);
        return <Pressable key={place.id} analyticsId="today.places.place-open" accessibilityRole="button" accessibilityLabel={`${place.name} · ${tr('지도 보기')}`}
        accessibilityValue={rating.score == null ? undefined : { text: tr(rating.source === 'gling' ? '글링 평균 {0}점, 10점 만점' : '{0}점, 10점 만점', rating.score.toFixed(1)) }}
        onPress={() => { play('selection'); router.push(placeMapRoute(place)); }}
        style={({ pressed }) => [styles.card, { opacity: pressed ? 0.65 : 1 }]}>
        <CityPlacePhoto place={place} style={styles.photo} />
        <ThemedText numberOfLines={2} style={styles.name}>{place.name}</ThemedText>
        <PlaceReviewSummary rating={rating} compact />
        <ThemedText style={styles.category} themeColor="textSecondary">{place.category === 'food' ? tr("맛집") : place.category === 'cafe' ? tr("카페") : tr("가볼 만한 곳")}</ThemedText>
      </Pressable>; })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: Spacing.three, gap: Spacing.two },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1, fontSize: 17, lineHeight: 25, fontWeight: '700' },
  all: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  allText: { fontSize: 12, lineHeight: 18 },
  subtitle: { fontSize: 12, lineHeight: 18, marginBottom: Spacing.one },
  cards: { flexDirection: 'row', gap: 10 },
  card: { flex: 1, gap: Spacing.one },
  photo: { width: '100%', aspectRatio: 1 / 1.15, borderRadius: 12, marginBottom: Spacing.one },
  name: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  category: { fontSize: 11, lineHeight: 16 },
});
