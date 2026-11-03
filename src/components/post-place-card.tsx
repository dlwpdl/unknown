import { useLanguage } from '@/hooks/use-language';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { ThemedText } from '@/components/themed-text';
import { IconSize, MiniCard } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CityPlace } from '@/lib/city-places';
import { placeMapRoute } from '@/lib/discovery';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { nearestNeighborhood, neighborhoodName } from '@/lib/neighborhoods';

/** The place a Today post is already about, under its text. Opens that place on the Gling map (owner 2026-11-03); saving it comes later. */
export function PostPlaceCard({ place }: { place: CityPlace }) {
  const { tr, language } = useLanguage(), theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const large = useWindowDimensions().fontScale > 1.2;
  const pick = place.recommendation ?? place.diningRecommendation;
  const kind = place.category === 'food' ? tr('맛집') : place.category === 'cafe' ? tr('카페') : tr('가볼 만한 곳');
  // A Korean-only reason is not shown to English readers; the kind of place stands in.
  const intro = (language === 'en' ? pick?.reasonEn : pick?.reason) || kind;
  const area = nearestNeighborhood(place.cityId, place);
  const sub = [area && neighborhoodName(area, language), intro === kind ? null : kind].filter(Boolean).join(' · ');
  return <Pressable analyticsId="today.places.place-open" accessibilityRole="button" accessibilityLabel={[place.name, intro, sub, tr('지도 보기')].filter(Boolean).join(' · ')}
    onPress={() => { play('selection'); router.push(placeMapRoute(place)); }}
    style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <CityPlacePhoto place={place} style={styles.photo} />
    <View style={styles.copy}>
      <ThemedText type="label" numberOfLines={large ? 2 : 1}>{place.name}</ThemedText>
      <ThemedText type="small" numberOfLines={large ? 2 : 1}>{intro}</ThemedText>
      {!!sub && <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>{sub}</ThemedText>}
    </View>
    <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={IconSize.chevron} tintColor={theme.textSecondary} />
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { marginTop: 12, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 12, borderWidth: 1, borderRadius: MiniCard.radius, overflow: 'hidden' },
  photo: { width: 64, alignSelf: 'stretch', minHeight: 64 },
  copy: { flex: 1, minWidth: 0, paddingVertical: Spacing.two },
});
