import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { ThemedText } from '@/components/themed-text';
import { Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { getCityDiscoveryPlaces, type CityPlace } from '@/lib/city-places';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { pickMeetupPlaces } from '@/lib/meetup-convenience';

/** Free for everyone: three Gling map places for the meetup's city and topic. Picking one links its map like a place meetup. */
export function MeetupPlaceSuggestions({ cityId, category, text, selectedId, onPick, disabled }: {
  cityId: string; category: string; text: string; selectedId: string | null; onPick: (place: CityPlace | null) => void; disabled?: boolean;
}) {
  const { tr, language } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const places = useMemo(() => { // Only OSM places can be linked as a meetup place (placeMeetupTail).
    try { return getCityDiscoveryPlaces(cityId).filter(place => /^osm:(node|way|relation):[1-9]\d*$/.test(place.id)); } catch { return []; } }, [cityId]);
  const picks = useMemo(() => {
    const top = pickMeetupPlaces(places, category, text);
    const chosen = places.find(place => place.id === selectedId);
    return chosen && !top.some(place => place.id === chosen.id) ? [chosen, ...top.slice(0, 2)] : top;
  }, [places, category, text, selectedId]);
  if (!picks.length) return null;
  return <View style={styles.wrap}>
    <ThemedText type="smallBold" style={Typography.menu}>{tr('이런 곳은 어때요?')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{tr('도시와 모임 주제에 맞춰 글링 지도에서 골랐어요. 하나를 누르면 모임에 장소 지도가 붙어요.')}</ThemedText>
    {picks.map(place => {
      const selected = place.id === selectedId;
      return <Pressable key={place.id} analyticsId={selected ? 'meetup-create.place.clear' : 'meetup-create.place.pick'} accessibilityRole="button"
        accessibilityState={{ selected, disabled: !!disabled }} accessibilityHint={selected ? tr('선택을 풀어요') : tr('모임 장소로 골라요')} disabled={disabled}
        onPress={() => { play('selection'); onPick(selected ? null : place); }}
        style={({ pressed }) => [styles.place, { borderColor: selected ? theme.accent : theme.line, backgroundColor: theme.card, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 }]}>
        <CityPlacePhoto place={place} style={styles.photo} />
        <View style={styles.text}>
          <ThemedText type="smallBold" numberOfLines={1}>{place.name}</ThemedText>
          {place.recommendation && <ThemedText type="small" themeColor="accent">{tr('글링 추천')}</ThemedText>}
          {!!(language === 'en' ? place.recommendation?.reasonEn ?? place.recommendation?.reason : place.recommendation?.reason) &&
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{language === 'en' ? place.recommendation?.reasonEn ?? place.recommendation?.reason : place.recommendation?.reason}</ThemedText>}
        </View>
        <ThemedText type="smallBold" themeColor={selected ? 'accent' : 'textSecondary'}>{selected ? tr('선택 해제') : tr('고르기')}</ThemedText>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  place: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 12, padding: Spacing.two },
  photo: { width: 52, height: 52, borderRadius: 8, overflow: 'hidden' },
  text: { flex: 1, gap: 2 },
});
