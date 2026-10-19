import { useLanguage } from '@/hooks/use-language';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { getPlaceReviewRating, PlaceReviewSummary } from '@/components/place-review-summary';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCommunityCity } from '@/lib/community-city';
import { CITY_PLACES_COLLECTED_AT, getCityBrowsePlaces, getCityPlacesCoverage, type CityPlace, type PlaceCategory } from '@/lib/city-places';
import { useCityPlacesRevision } from '@/hooks/use-city-places';
import { usePlaceReviewSummaries } from '@/hooks/use-place-review-summaries';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { placeMapRoute } from '@/lib/discovery';
import { CITIES } from '@/lib/mock';



export default function PlacesScreen() {
  useCityPlacesRevision();

  const { cityId } = useLocalSearchParams<{ cityId?: string }>();
  const { city: selected } = useCommunityCity();
  const city = CITIES.find(item => item.id === (cityId ?? selected.id));
  return <PlacesList key={city?.id ?? 'unknown'} city={city} />;
}

function PlacesList({ city }: { city?: (typeof CITIES)[number] }) {
  const { tr, language, locale: appLocale } = useLanguage();
  const categories: { id: PlaceCategory; label: string }[] = [
    { id: 'all', get label() { return tr("TOP 50"); } }, { id: 'food', get label() { return tr("레스토랑"); } }, { id: 'cafe', get label() { return tr("카페"); } }, { id: 'places', get label() { return tr("가볼 만한 곳"); } },
  ];
  const theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const [limit, setLimit] = useState(10), [category, setCategory] = useState<PlaceCategory>('all'), [query, setQuery] = useState('');
  let places: CityPlace[] = [], recommendations: CityPlace[] = [], error = '';
  if (city) {
    try {
      recommendations = getCityBrowsePlaces(city.id, category);
      places = recommendations.filter(place => (place.name + ' ' + place.address).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    }
    catch { error = '이 도시의 장소 정보를 불러오지 못했어요.'; }
  }
  const ratings = usePlaceReviewSummaries(city?.id ?? '', recommendations.slice(0, 50).map(place => place.id));
  return <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
    <View style={[styles.header, { borderBottomColor: theme.line }]}>
      <Pressable analyticsId="places.back" accessibilityRole="button" accessibilityLabel={tr("이전 화면으로 돌아가기")}
        onPress={() => { play('selection'); if (router.canGoBack()) router.back(); else router.replace('/'); }} style={styles.back}>
        <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={19} tintColor={theme.text} />
        <ThemedText type="smallBold">{tr("장소 둘러보기")}</ThemedText>
      </Pressable>
      {!!city && <ThemedText type="small" themeColor="textSecondary">{tr(city.name)}</ThemedText>}
    </View>
    <ScrollView analyticsId="places.list.scroll" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {!city ? <StateCard kind="error" title={tr("도시를 확인해 주세요")} body={tr("홈에서 도시를 선택한 뒤 다시 열어 주세요.")} />
        : error ? <StateCard kind="error" title={tr("장소를 불러오지 못했어요")} body={error} /> : <>
          <ThemedText type="small" themeColor="textSecondary">{tr(city.name)} · {tr(getCityPlacesCoverage(city.id))}</ThemedText>
          <ThemedText accessibilityRole="header" style={styles.title}>{tr("이 도시에서 가볼 만한 곳")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tr("사진 명소와 들러 볼 만한 식당을 골랐어요")}</ThemedText>
          <TextInput accessibilityLabel={tr("장소 검색")} value={query} onChangeText={setQuery} onFocus={() => play('selection')}
            placeholder={tr("목록에서 이름·주소 검색")} placeholderTextColor={theme.textSecondary} returnKeyType="search" autoCorrect={false}
            onSubmitEditing={() => play('selection')} style={[styles.search, { color: theme.text, backgroundColor: theme.card, borderColor: theme.line }]} />
          <View style={styles.heading}>
            <ThemedText type="smallBold">{tr("{0} · {1}곳", (tr(city.name)), (Math.min(limit, places.length)))}</ThemedText>
            {places.length > 10 && <Pressable analyticsId="places.view-more" accessibilityRole="button" accessibilityLabel={limit === 10 ? tr("{0}곳 모두 보기", Math.min(50, places.length)) : tr("10곳 먼저 보기")}
              onPress={() => { play('selection'); setLimit(limit === 10 ? 50 : 10); }} style={styles.control}>
              <ThemedText type="smallBold" themeColor="accent">{limit === 10 ? tr("{0}곳 모두 보기", Math.min(50, places.length)) : tr("10곳 먼저 보기")}</ThemedText>
            </Pressable>}
          </View>
          <View style={styles.categories}>
            {categories.map(item => <Pressable key={item.id} analyticsId={`places.category.${item.id}`} accessibilityRole="button"
              accessibilityLabel={tr("{0} 장소", (item.label))} accessibilityState={{ selected: category === item.id }}
              onPress={() => { play('selection'); setCategory(item.id); setLimit(item.id === 'all' ? 10 : 50); }}
              style={[styles.category, { borderColor: category === item.id ? theme.accent : theme.line, backgroundColor: category === item.id ? theme.accent : 'transparent' }]}>
              <ThemedText type="smallBold" style={{ color: category === item.id ? theme.accentInk : theme.text }}>{item.label}</ThemedText>
            </Pressable>)}
          </View>
          <View>
            {places.slice(0, limit).map(place => {
              const rating = getPlaceReviewRating(city.id, place.id, ratings[place.id]);
              return <Pressable key={place.id} analyticsId="places.open" accessibilityRole="button" accessibilityLabel={`${place.name} · ${tr('지도 보기')}`}
              accessibilityValue={rating.score == null ? undefined : { text: tr(rating.source === 'gling' ? '글링 평균 {0}점, 10점 만점' : '{0}점, 10점 만점', rating.score.toFixed(1)) }}
              onPress={() => { play('selection'); router.push(placeMapRoute(place)); }}
              style={({ pressed }) => [styles.place, { borderBottomColor: theme.line, opacity: pressed ? 0.65 : 1 }]}>
              <CityPlacePhoto place={place} style={styles.photo} />
              <View style={styles.copy}>
                <ThemedText style={styles.categoryLabel} themeColor="accent">{categories.find(item => item.id === place.category)?.label}</ThemedText>
                <ThemedText style={styles.placeName} numberOfLines={2}>{place.name}</ThemedText>
                <PlaceReviewSummary rating={rating} />
                {!!place.recommendation && <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>{language === 'en' ? place.recommendation.reasonEn ?? place.recommendation.reason : place.recommendation.reason}</ThemedText>}
                {!!place.address && <ThemedText style={styles.address} themeColor="textSecondary" numberOfLines={2}>{place.address}</ThemedText>}
              </View>
              <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={14} tintColor={theme.textSecondary} />
            </Pressable>; })}
          </View>
          {!places.length && <StateCard kind="empty" title={tr("목록에서 찾지 못했어요")} body={tr("검색어를 바꾸거나 다른 분류를 골라보세요.")} />}
          <ThemedText type="small" themeColor="textSecondary">{tr("© OpenStreetMap contributors · {0} 확인 자료", (new Date(CITY_PLACES_COLLECTED_AT).toLocaleDateString(appLocale)))}</ThemedText>
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
