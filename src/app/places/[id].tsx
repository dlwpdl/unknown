import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { SymbolView } from 'expo-symbols';
import { Alert, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { PostMapLink } from '@/components/post-map-link';
import { PostPhotoCredits } from '@/components/post-photo-credits';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCommunityCity } from '@/lib/community-city';
import { CITY_PLACES_COLLECTED_AT, getCityPlaces, type CityPlace } from '@/lib/city-places';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { merchantMapsUrl, safeMerchantSourceUrl } from '@/lib/merchant-source';
import { useAuth } from '@/lib/auth';
import { recordProductEvent } from '@/lib/product-analytics';
import { supabase } from '@/lib/supabase';

export default function PlaceDetailScreen() {
  const { cityId, id } = useLocalSearchParams<{ cityId?: string; id?: string }>();
  const { isAuthed, me } = useAuth();
  const isFocused = useIsFocused(), userId = isAuthed ? me.id : null;
  const identity = useRef(userId);
  useLayoutEffect(() => { identity.current = userId; return () => { identity.current = null; }; }, [userId]);
  const { city: selected } = useCommunityCity();
  const city = CITIES.find(item => item.id === (cityId ?? selected.id));
  const theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  let found: CityPlace | undefined;
  try { if (city) found = getCityPlaces(city.id).find(item => item.id === id); } catch { /* Invalid/missing catalog stays an explicit missing-place state. */ }
  const place = found, website = place?.website ? safeMerchantSourceUrl(place.website) : null;
  const targetId = place?.id, loadedCityId = place?.cityId;
  const record = useCallback((kind: 'place_view' | 'place_directions' | 'place_website') => {
    if (userId && identity.current === userId && targetId && loadedCityId) {
      void recordProductEvent(supabase, { kind, targetId, cityId: loadedCityId, platform: Platform.OS }).catch(() => {});
    }
  }, [userId, targetId, loadedCityId]);
  useEffect(() => { if (isFocused) record('place_view'); }, [isFocused, record]);
  const mapsUrl = place && city ? merchantMapsUrl([place.name, place.address, city.englishName, city.province, 'Canada'].filter(Boolean).join(', ')) : null;
  const openSource = (url: string, kind?: 'place_website') => {
    play('selection');
    void Linking.openURL(url).then(() => { if (kind) record(kind); }, () => { play('warning'); Alert.alert('페이지를 열지 못했어요', '잠시 후 다시 시도해 주세요.'); });
  };
  return <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
    <View style={[styles.header, { borderBottomColor: theme.line }]}>
      <Pressable analyticsId="places.detail.back" accessibilityRole="button" accessibilityLabel="이전 화면으로 돌아가기"
        onPress={() => { play('selection'); router.back(); }} style={styles.back}>
        <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={19} tintColor={theme.text} />
        <ThemedText type="smallBold">돌아가기</ThemedText>
      </Pressable>
    </View>
    <ScrollView analyticsId="places.detail.scroll" contentContainerStyle={styles.content}>
      {!place || !city ? <StateCard kind="error" title="장소를 찾지 못했어요" body="선택한 도시의 장소 목록에서 다시 열어 주세요." /> : <>
        <CityPlacePhoto place={place} style={styles.photo} />
        {!!place.photo && <PostPhotoCredits credits={`사진: ${place.photo.artist}\n${place.photo.sourceUrl}\n${place.photo.license}\n${place.photo.licenseUrl}\n사진은 촬영 시점의 모습이며 현재와 다를 수 있어요.`} />}
        <ThemedText type="small" themeColor="textSecondary">{city.name} · 지도 등록 장소</ThemedText>
        <ThemedText accessibilityRole="header" style={styles.title}>{place.name}</ThemedText>
        <View style={[styles.facts, { backgroundColor: theme.card }]}>
          <ThemedText type="smallBold" themeColor="accent">{place.category === 'food' ? '맛집' : place.category === 'cafe' ? '카페' : '가볼 만한 곳'}</ThemedText>
          <ThemedText>{place.address || '등록된 주소 정보가 없어요. 지도에서 위치를 확인해 주세요.'}</ThemedText>
          {!!place.openingHours && <ThemedText type="small" themeColor="textSecondary">{`등록된 운영 시간: ${place.openingHours}`}</ThemedText>}
        </View>
        {mapsUrl && <PostMapLink url={mapsUrl} label={place.name} onOpened={() => record('place_directions')} />}
        <Pressable analyticsId="places.detail.source" accessibilityRole="link" accessibilityLabel="OpenStreetMap에서 장소 정보 보기" onPress={() => openSource(place.sourceUrl)} style={styles.link}>
          <ThemedText type="smallBold" themeColor="accent">OpenStreetMap에서 장소 정보 보기</ThemedText>
        </Pressable>
        {!!website && <Pressable analyticsId="places.detail.website" accessibilityRole="link" accessibilityLabel={`${place.name} 웹사이트 열기`} onPress={() => openSource(website, 'place_website')} style={styles.link}>
          <ThemedText type="smallBold" themeColor="accent">장소 웹사이트</ThemedText>
        </Pressable>}
        <ThemedText type="small" themeColor="textSecondary">방문 전 운영 여부와 시간을 확인해 주세요.</ThemedText>
        <Pressable analyticsId="places.detail.attribution" accessibilityRole="link" accessibilityLabel="OpenStreetMap 자료 출처와 이용 조건" onPress={() => openSource('https://www.openstreetmap.org/copyright')} style={styles.link}>
          <ThemedText type="small" themeColor="textSecondary">{`© OpenStreetMap contributors · ${new Date(CITY_PLACES_COLLECTED_AT).toLocaleDateString('ko-KR')} 확인 자료`}</ThemedText>
        </Pressable>
      </>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.three, gap: Spacing.three },
  back: { minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 16 },
  title: { fontSize: 26, lineHeight: 36, fontWeight: '700' },
  facts: { padding: Spacing.three, borderRadius: 16, gap: Spacing.two },
  link: { minHeight: 44, justifyContent: 'center' },
});
