import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCommunityCity } from '@/lib/community-city';
import { CITY_PLACES_COLLECTED_AT, getCityPlaces, getCityPlacesCoverage, type CityPlace, type PlaceCategory } from '@/lib/city-places';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';

const categories: { id: PlaceCategory; label: string }[] = [
  { id: 'all', label: '전체' }, { id: 'food', label: '맛집' }, { id: 'cafe', label: '카페' }, { id: 'places', label: '가볼 만한 곳' },
];

export default function PlacesScreen() {
  const { cityId } = useLocalSearchParams<{ cityId?: string }>();
  const { city: selected } = useCommunityCity();
  const city = CITIES.find(item => item.id === (cityId ?? selected.id));
  return <PlacesList key={city?.id ?? 'unknown'} city={city} />;
}

function PlacesList({ city }: { city?: (typeof CITIES)[number] }) {
  const theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const [limit, setLimit] = useState(10), [category, setCategory] = useState<PlaceCategory>('all'), [query, setQuery] = useState('');
  let places: CityPlace[] = [], error = '';
  if (city) {
    try { places = getCityPlaces(city.id, category).filter(place => (place.name + ' ' + place.address).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())); }
    catch { error = '이 도시의 장소 정보를 불러오지 못했어요.'; }
  }
  return <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
    <View style={[styles.header, { borderBottomColor: theme.line }]}>
      <Pressable analyticsId="places.back" accessibilityRole="button" accessibilityLabel="이전 화면으로 돌아가기"
        onPress={() => { play('selection'); router.back(); }} style={styles.back}>
        <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={19} tintColor={theme.text} />
        <ThemedText type="smallBold">장소 둘러보기</ThemedText>
      </Pressable>
      {!!city && <ThemedText type="small" themeColor="textSecondary">{city.name}</ThemedText>}
    </View>
    <ScrollView analyticsId="places.list.scroll" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {!city ? <StateCard kind="error" title="도시를 확인해 주세요" body="홈에서 도시를 선택한 뒤 다시 열어 주세요." />
        : error ? <StateCard kind="error" title="장소를 불러오지 못했어요" body={error} /> : <>
          <ThemedText type="small" themeColor="textSecondary">{city.name} · {getCityPlacesCoverage(city.id)}</ThemedText>
          <ThemedText accessibilityRole="header" style={styles.title}>이 도시에서 요즘 많이 가는 곳</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">지도에 등록된 실제 장소예요. 인기 순위는 아직 집계 전이에요.</ThemedText>
          <TextInput accessibilityLabel="장소 검색" value={query} onChangeText={setQuery} onFocus={() => play('selection')}
            placeholder="목록에서 이름·주소 검색" placeholderTextColor={theme.textSecondary} returnKeyType="search" autoCorrect={false}
            onSubmitEditing={() => play('selection')} style={[styles.search, { color: theme.text, backgroundColor: theme.card, borderColor: theme.line }]} />
          <View style={styles.heading}>
            <ThemedText type="smallBold">{`${city.name} · ${Math.min(limit, places.length)}곳`}</ThemedText>
            <Pressable analyticsId="places.view-more" accessibilityRole="button" accessibilityLabel={limit === 10 ? '25곳까지 보기' : '10곳 먼저 보기'}
              onPress={() => { play('selection'); setLimit(limit === 10 ? 25 : 10); }} style={styles.control}>
              <ThemedText type="smallBold" themeColor="accent">{limit === 10 ? '25곳까지 보기' : '10곳 먼저 보기'}</ThemedText>
            </Pressable>
          </View>
          <View style={styles.categories}>
            {categories.map(item => <Pressable key={item.id} analyticsId={`places.category.${item.id}`} accessibilityRole="button"
              accessibilityLabel={`${item.label} 장소`} accessibilityState={{ selected: category === item.id }}
              onPress={() => { play('selection'); setCategory(item.id); setLimit(item.id === 'all' ? 10 : 25); }}
              style={[styles.category, { borderColor: category === item.id ? theme.accent : theme.line, backgroundColor: category === item.id ? theme.accent : 'transparent' }]}>
              <ThemedText type="smallBold" style={{ color: category === item.id ? theme.accentInk : theme.text }}>{item.label}</ThemedText>
            </Pressable>)}
          </View>
          <View>
            {places.slice(0, limit).map(place => <Pressable key={place.id} analyticsId="places.open" accessibilityRole="button" accessibilityLabel={`${place.name} 장소 정보`}
              onPress={() => { play('selection'); router.push({ pathname: '/places/[id]', params: { id: place.id, cityId: city.id } }); }}
              style={({ pressed }) => [styles.place, { borderBottomColor: theme.line, opacity: pressed ? 0.65 : 1 }]}>
              <CityPlacePhoto place={place} style={styles.photo} />
              <View style={styles.copy}>
                <ThemedText style={styles.categoryLabel} themeColor="accent">{categories.find(item => item.id === place.category)?.label}</ThemedText>
                <ThemedText style={styles.placeName} numberOfLines={2}>{place.name}</ThemedText>
                {!!place.address && <ThemedText style={styles.address} themeColor="textSecondary" numberOfLines={2}>{place.address}</ThemedText>}
              </View>
              <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={14} tintColor={theme.textSecondary} />
            </Pressable>)}
          </View>
          {!places.length && <StateCard kind="empty" title="목록에서 찾지 못했어요" body="검색어를 바꾸거나 다른 분류를 골라보세요." />}
          <ThemedText type="small" themeColor="textSecondary">{`© OpenStreetMap contributors · ${new Date(CITY_PLACES_COLLECTED_AT).toLocaleDateString('ko-KR')} 확인 자료`}</ThemedText>
        </>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.one,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.three, gap: Spacing.three },
  back: { minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { fontSize: 24, lineHeight: 34, fontWeight: '700' },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: Spacing.three, fontSize: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  control: { minHeight: 44, justifyContent: 'center' },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  category: { minHeight: 44, justifyContent: 'center', borderRadius: 999, borderWidth: 1, paddingHorizontal: Spacing.three },
  place: { minHeight: 112, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: { width: 80, height: 80, borderRadius: 12 },
  copy: { flex: 1, gap: Spacing.one },
  categoryLabel: { fontSize: 11, lineHeight: 16 },
  placeName: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  address: { fontSize: 12, lineHeight: 18 },
});
