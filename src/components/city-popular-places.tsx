import { useLanguage } from '@/hooks/use-language';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { getPlaceReviewRating, PlaceReviewSummary } from '@/components/place-review-summary';
import { ThemedText } from '@/components/themed-text';
import { ControlMotion, ControlStyles, MiniCard } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCityDiscoveryPlaces } from '@/lib/city-places';
import { placeMapRoute } from '@/lib/discovery';
import { formatNearbyDistance, preferVisitedPlaces, rankPlacesByDistance } from '@/lib/discovery-sort';
import { loadCityPlaceSignals } from '@/lib/place-reviews';
import { supabase } from '@/lib/supabase';
import { useCityPlacesRevision } from '@/hooks/use-city-places';
import { useCurrentLocation, type CurrentLocation } from '@/hooks/use-current-location';
import { usePlaceReviewSummaries } from '@/hooks/use-place-review-summaries';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';

export function NearbyPlacesLocation({ location, analyticsId }: { location: CurrentLocation; analyticsId: string }) {
  const { language } = useLanguage(), ko = language === 'ko', { play } = useInteractionFeedback(), theme = useTheme();
  const settings = location.status === 'permission' && !location.canAskAgain;
  const message = location.fix ? ko ? '내 위치에서 가까운 순 · 직선거리' : 'Nearest to your location · straight-line distance'
    : location.busy ? ko ? '현재 위치를 확인하고 있어요…' : 'Checking your location…'
      : location.status === 'permission' ? ko ? '위치를 허용하면 가까운 곳부터 볼 수 있어요.' : 'Allow location to see nearby places first.'
        : ko ? '현재 위치 없이 이 도시의 장소를 보여드려요.' : 'Showing this city’s places without your current location.';
  const label = location.busy ? ko ? '위치 확인 중…' : 'Locating…' : settings ? ko ? '설정에서 위치 허용' : 'Allow in Settings'
    : location.fix ? ko ? '위치 다시 확인' : 'Refresh location' : ko ? '내 위치로 보기' : 'Use my location';
  return <View style={styles.locationRow}><ThemedText style={styles.subtitle} themeColor="textSecondary" accessibilityLiveRegion="polite">{message}</ThemedText>
    <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={label} disabled={location.busy} accessibilityState={{ disabled: location.busy, busy: location.busy }}
      onPress={() => { play('selection'); void location.request(); }} style={({ pressed }) => [ControlStyles.pill, { backgroundColor: theme.backgroundElement, opacity: location.busy ? .6 : pressed ? .82 : 1 }]}>
      <ThemedText type="label" themeColor="accent">{label}</ThemedText></Pressable>
  </View>;
}

export function CityPopularPlaces({ cityId }: { cityId: string }) {
  const { tr } = useLanguage(), { fontScale } = useWindowDimensions(), large = fontScale > 1.2;
  const router = useRouter(), { play } = useInteractionFeedback();
  useCityPlacesRevision();
  const city = CITIES.find(item => item.id === cityId), location = useCurrentLocation(cityId, !!city);
  const [signals, setSignals] = useState<{ cityId: string; ids: string[] }>({ cityId: '', ids: [] });
  useEffect(() => {
    if (!city) return;
    let active = true;
    // shortcut: production answers only after 20261030190000 is applied; until then a failed call keeps today's order.
    loadCityPlaceSignals(supabase, cityId).then(ids => { if (active) setSignals({ cityId, ids }); }, () => {});
    return () => { active = false; };
  }, [city, cityId]);
  const places = city ? getCityDiscoveryPlaces(cityId).filter(place => place.cityId === cityId) : [];
  const ranked = rankPlacesByDistance(places, location.fix);
  // "내 위치로 보기" asked for nearest first; otherwise places members actually go to lead.
  const preview = (ranked.some(row => row.distance !== null) ? ranked : preferVisitedPlaces(ranked, signals.cityId === cityId ? signals.ids : [])).slice(0, 3);
  const ratings = usePlaceReviewSummaries(cityId, preview.map(row => row.place.id));
  if (!city || !places.length) return null;
  return <View style={styles.section}>
    <View style={styles.heading}>
      <ThemedText accessibilityRole="header" type="section" style={styles.title}>{tr('이 도시에서 가볼 만한 곳')}</ThemedText>
      <Pressable analyticsId="today.places.open" accessibilityRole="button" accessibilityLabel={tr('{0}의 실제 장소 {1}곳 보기', tr(city.name), places.length)}
        onPress={() => { play('selection'); router.push({ pathname: '/places', params: { cityId, nearby: '1' } }); }} style={({ pressed }) => [styles.all, { opacity: pressed ? ControlMotion.pressedOpacity : 1 }]}>
        <ThemedText type="smallBold" themeColor="accent">{tr('전체 보기 ›')}</ThemedText>
      </Pressable>
    </View>
    <NearbyPlacesLocation location={location} analyticsId="today.places.locate" />
    <View style={[styles.cards, large && styles.cardsLarge]}>
      {preview.map(({ place, distance }) => {
        const rating = getPlaceReviewRating(cityId, place.id, ratings[place.id]), distanceLabel = formatNearbyDistance(distance, tr);
        const kind = place.category === 'food' ? tr('맛집') : place.category === 'cafe' ? tr('카페') : tr('가볼 만한 곳');
        return <Pressable key={place.id} analyticsId="today.places.place-open" accessibilityRole="button" accessibilityLabel={[place.name, distanceLabel, tr('지도 보기')].filter(Boolean).join(' · ')}
          accessibilityValue={rating.score == null ? undefined : { text: tr(rating.source === 'gling' ? '글링 평균 {0}점, 10점 만점' : '{0}점, 10점 만점', rating.score.toFixed(1)) }}
          onPress={() => { play('selection'); router.push(placeMapRoute(place)); }} style={({ pressed }) => [styles.card, large && styles.cardLarge, { opacity: pressed ? ControlMotion.pressedOpacity : 1 }]}>
          <CityPlacePhoto place={place} style={[styles.photo, large && styles.photoLarge]} />
          <View style={[styles.cardCopy, large && styles.cardCopyLarge]}>
            <ThemedText type="label" numberOfLines={large ? 2 : 1}>{place.name}</ThemedText>
            <PlaceReviewSummary rating={rating} compact />
            <ThemedText type="caption" themeColor="textSecondary" numberOfLines={large ? 2 : 1}>{[kind, distanceLabel].filter(Boolean).join(' · ')}</ThemedText>
          </View>
        </Pressable>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: Spacing.four, gap: Spacing.two }, heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1, minWidth: 0 }, all: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingLeft: Spacing.two },
  locationRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one }, subtitle: { flexGrow: 1, flexBasis: 160, minWidth: 0, fontSize: 12, lineHeight: 18 },
  cards: { flexDirection: 'row', gap: Spacing.two }, cardsLarge: { flexDirection: 'column' }, card: { flex: 1, minWidth: 0, gap: Spacing.one }, cardLarge: { flex: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  photo: { width: '100%', height: MiniCard.photoHeight, borderRadius: MiniCard.radius }, photoLarge: { width: MiniCard.photoHeight, height: MiniCard.photoHeight }, cardCopy: { minWidth: 0, gap: 2 }, cardCopyLarge: { flex: 1 },
});
