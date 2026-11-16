import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { ClayBoxFill, useClayBox } from '@/components/clay';
import { SymbolView } from '@/components/symbol-view';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, IconSize, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { getCityDiscoveryPlaces, type CityPlace } from '@/lib/city-places';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { pickMeetupPlaces } from '@/lib/meetup-convenience';

/** Free for everyone: three Gling map places for the meetup's city and topic, or any of them by name (I-meet-14). Picking one links its map like a place meetup. */
export function MeetupPlaceSuggestions({ cityId, category, text, selectedId, onPick, disabled }: {
  cityId: string; category: string; text: string; selectedId: string | null; onPick: (place: CityPlace | null) => void; disabled?: boolean;
}) {
  const { tr, language } = useLanguage();
  const theme = useTheme(), clayBox = useClayBox(), { play } = useInteractionFeedback();
  const places = useMemo(() => { // Only OSM places can be linked as a meetup place (placeMeetupTail).
    try { return getCityDiscoveryPlaces(cityId).filter(place => /^osm:(node|way|relation):[1-9]\d*$/.test(place.id)); } catch { return []; } }, [cityId]);
  const picks = useMemo(() => {
    const top = pickMeetupPlaces(places, category, text);
    const chosen = places.find(place => place.id === selectedId);
    return chosen && !top.some(place => place.id === chosen.id) ? [chosen, ...top.slice(0, 2)] : top;
  }, [places, category, text, selectedId]);
  const [searching, setSearching] = useState(false), [query, setQuery] = useState('');
  const found = useMemo(() => {
    const words = query.trim().toLowerCase();
    return words ? places.filter(place => place.name.toLowerCase().includes(words)).slice(0, 5) : [];
  }, [places, query]);
  if (!picks.length) return null;
  const row = (place: CityPlace) => {
    const selected = place.id === selectedId;
    return <Pressable key={place.id} analyticsId={selected ? 'meetup-create.place.clear' : 'meetup-create.place.pick'} accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }} accessibilityHint={selected ? tr('선택을 풀어요') : tr('모임 장소로 골라요')} disabled={disabled}
      onPress={() => { play('selection'); onPick(selected ? null : place); setSearching(false); setQuery(''); }}
      style={({ pressed }) => [styles.place, { borderColor: selected ? theme.accent : clayBox ? 'transparent' : theme.line, backgroundColor: clayBox ? 'transparent' : theme.card, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 }]}>
      {clayBox && <ClayBoxFill kind="tile" />}
      <CityPlacePhoto place={place} style={styles.photo} />
      <View style={styles.text}>
        <ThemedText type="smallBold" numberOfLines={1}>{place.name}</ThemedText>
        {place.recommendation && <ThemedText type="small" themeColor="accent">{tr('글링 추천')}</ThemedText>}
        {!!(language === 'en' ? place.recommendation?.reasonEn ?? place.recommendation?.reason : place.recommendation?.reason) &&
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{language === 'en' ? place.recommendation?.reasonEn ?? place.recommendation?.reason : place.recommendation?.reason}</ThemedText>}
      </View>
      <ThemedText type="smallBold" themeColor={selected ? 'accent' : 'textSecondary'}>{selected ? tr('선택 해제') : tr('고르기')}</ThemedText>
    </Pressable>;
  };
  return <View style={styles.wrap}>
    <ThemedText type="smallBold" style={Typography.menu}>{tr('어디서')}</ThemedText>
    {picks.map(row)}
    <Pressable analyticsId="meetup-create.place.search" accessibilityRole="button" accessibilityState={{ expanded: searching, disabled: !!disabled }} disabled={disabled}
      onPress={() => { play('selection'); setSearching(value => !value); }} style={({ pressed }) => [styles.search, { opacity: disabled ? 0.45 : pressed ? 0.82 : 1 }]}>
      <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={IconSize.inline} tintColor={theme.text} />
      <ThemedText type="smallBold" style={styles.text}>{tr('다른 곳 찾기')}</ThemedText>
      <SymbolView name={{ ios: searching ? 'chevron.up' : 'chevron.down', android: searching ? 'expand_less' : 'expand_more', web: searching ? 'expand_less' : 'expand_more' }} size={IconSize.chevron} tintColor={theme.textSecondary} />
    </Pressable>
    {searching && <>
      <TextInput accessibilityLabel={tr('다른 곳 찾기')} autoFocus value={query} onChangeText={setQuery} placeholder={tr('장소 이름')} placeholderTextColor={theme.textSecondary} maxLength={80} editable={!disabled}
        style={[ControlStyles.field, styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
      {found.map(row)}
      {!!query.trim() && !found.length && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{tr('글링 지도에는 없는 곳이에요. 장소는 소개에 적어 주세요.')}</ThemedText>}
    </>}
    <ThemedText type="small" themeColor="textSecondary">{tr('글링 추천 · 고르면 모임에 장소 지도가 붙어요')}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  place: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 12, padding: Spacing.two },
  photo: { width: 52, height: 52, borderRadius: 8, overflow: 'hidden' },
  text: { flex: 1, gap: 2 },
  search: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { fontSize: 16, lineHeight: 22 },
});
