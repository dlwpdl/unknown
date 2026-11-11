import { useLanguage } from '@/hooks/use-language';
import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { Pressable } from '@/components/analytics-controls';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { DiscoveryMap, type DiscoveryMarker } from '@/components/discovery-map';
import { ClayIcon, ClayPillFill, useClay } from '@/components/clay';
import { PostPinMap } from '@/components/post-pin-map';
import { ThemedText } from '@/components/themed-text';
import { useCityPlacesRevision } from '@/hooks/use-city-places';
import { useTheme } from '@/hooks/use-theme';
import { getCityDiscoveryPlaces, placeMatchesQuery, type CityPlace } from '@/lib/city-places';
import { DISCOVERY_CATEGORIES, discoveryPlace, pinSubcategory } from '@/lib/discovery';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { isFreshLocation } from '@/lib/location';
import { CITIES } from '@/lib/mock';
import { googlePinUrl, type PostPin } from '@/lib/post-maps';

export function PostLocationPicker({ visible, initialPin, initialLabel = '', cityName = '', onClose, onConfirm }: {
  visible: boolean; initialPin: PostPin | null; initialLabel?: string; cityName?: string; onClose: () => void; onConfirm: (pin: PostPin, label: string) => void;
}) {
  const { tr } = useLanguage();
  const theme = useTheme(), clay = useClay(), { play } = useInteractionFeedback(), insets = useSafeAreaInsets(), reduced = useReducedMotion();
  const [pin, setPin] = useState<PostPin | null>(initialPin), [label, setLabel] = useState(initialLabel);
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const revision = useRef(0);
  const [ready, setReady] = useState(false), [cardHeight, setCardHeight] = useState(150);
  const [dropping, setDropping] = useState(false), [center, setCenter] = useState<{ latitude: number; longitude: number; requestId: number } | null>(initialPin && { latitude: initialPin.latitude, longitude: initialPin.longitude, requestId: 0 });
  useCityPlacesRevision();
  // Our map's places come first (owner 2026-11-08 "글쓰기에서 장소추가하면 우리 지도에 있는걸 가져와야"): the phone's address search alone never finds them by name.
  const cityId = CITIES.find(city => city.englishName === cityName)?.id, needle = query.trim().toLocaleLowerCase();
  let ours: CityPlace[] = [];
  if (needle && cityId) { try { ours = getCityDiscoveryPlaces(cityId).filter(place => placeMatchesQuery(place, needle)).slice(0, 4); } catch { /* A missing catalog leaves the address search. */ } }
  // The picker opens on the map tab's own place pins for the city (owner 2026-11-11 "장소 추가를 열면 지도가 텅 비어 있고"): a place is one tap away and search is for the rest.
  // 직접 핀 놓기 switches to the plain pin map, where any spot or the pin itself can be moved; a city without catalog places opens there.
  let places: CityPlace[] = [];
  if (cityId) { try { places = getCityDiscoveryPlaces(cityId); } catch { /* A missing catalog opens the plain pin map. */ } }
  const free = dropping || !places.length, mapReady = free ? ready : true;
  const chosen = pin && places.find(place => place.latitude === pin.latitude && place.longitude === pin.longitude);
  // Same fields as the map tab's place pins (src/app/map.tsx): category colour and 3D art, the kind of place on the second line, TOP 50 and visited places named from further out.
  const markers = places.flatMap((place): DiscoveryMarker[] => {
    const item = discoveryPlace(place), category = item && DISCOVERY_CATEGORIES.find(value => value.id === item.category);
    if (!item || !category) return [];
    return [{ id: place.id, latitude: place.latitude, longitude: place.longitude, color: category.color, label: place.name.slice(0, 80), sublabel: tr(pinSubcategory(place.subcategories)?.label ?? category.label).slice(0, 40),
      icon: category.art, ...(item.top25 || item.glingVisited ? { featured: true } : {}), ...(item.top25 ? { top25: true } : {}) }];
  });
  // A spot that is not one of our places (내 위치, an address, an earlier pin) shows as its own chosen pin.
  if (pin && !chosen) markers.push({ id: 'chosen', latitude: pin.latitude, longitude: pin.longitude, color: theme.accent, label: tr('선택한 위치'), featured: true });
  useEffect(() => { const gate = revision; return () => { gate.current++; }; }, []);
  useEffect(() => { const listener = AppState.addEventListener('change', state => { if (state === 'background') { revision.current++; setBusy(false); } }); return () => listener.remove(); }, []);
  // quiet: a tap on a place pin, which the map already answered with its own feedback, so the camera also stays where the person put it.
  const select = (selected: PostPin, name = '', quiet = false) => {
    try { googlePinUrl(selected); } catch { return; }
    revision.current++; if (!quiet) { play('selection'); setCenter({ latitude: selected.latitude, longitude: selected.longitude, requestId: revision.current }); } setPin(selected); setLabel((typeof name === 'string' ? name : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100)); setBusy(false); setMessage('');
  };
  const pick = (place: CityPlace, quiet = false) => { select({ latitude: place.latitude, longitude: place.longitude }, place.name, quiet); setQuery(''); };
  const toggle = () => { revision.current++; play('selection'); setBusy(false); setDropping(!free); if (pin) setCenter({ latitude: pin.latitude, longitude: pin.longitude, requestId: revision.current }); };
  const close = () => { revision.current++; setBusy(false); onClose(); };
  const locate = async (search: boolean) => {
    if (!mapReady || busy || (search && !query.trim())) return;
    if (search && ours.length) { pick(ours[0]); return; }
    if (search && Platform.OS === 'web') { play('warning'); setMessage('주소 검색은 앱에서 지원해요. 지도에서 원하는 지점을 골라주세요.'); return; }
    play('selection'); const operation = ++revision.current; setBusy(true); setMessage('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!search) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (revision.current !== operation) return;
        if (!permission.granted) throw new Error('PERMISSION');
      } else if (Platform.OS === 'android' && !(await Location.getForegroundPermissionsAsync()).granted) throw new Error('SEARCH_PERMISSION');
      const result = await Promise.race([
        search ? Location.geocodeAsync([query.trim(), cityName].filter(Boolean).join(', ')) : Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), 15000); }),
      ]);
      if (revision.current !== operation || AppState.currentState !== 'active') return;
      if (Array.isArray(result)) {
        if (!result.length) throw new Error('NOT_FOUND');
        select({ latitude: result[0].latitude, longitude: result[0].longitude }, query.trim());
      } else {
        const fix = { latitude: result.coords.latitude, longitude: result.coords.longitude, accuracy: result.coords.accuracy, measuredAt: result.timestamp, mocked: result.mocked ?? false };
        if (!isFreshLocation(fix) || fix.accuracy == null || fix.accuracy > 250 || Date.now() - fix.measuredAt > 120000) throw new Error('INACCURATE');
        select({ latitude: fix.latitude, longitude: fix.longitude }, '내 위치');
      }
    } catch (error) {
      if (revision.current !== operation) return;
      play('warning'); setMessage(error instanceof Error && error.message === 'PERMISSION' ? '위치 권한이 꺼져 있어요. 지도에서 원하는 지점을 직접 고를 수 있어요.'
        : error instanceof Error && error.message === 'SEARCH_PERMISSION' ? '주소 검색에 위치 권한이 필요해요. 지도에서 핀을 고르거나 내 위치를 눌러 권한을 허용해 주세요.'
        : '위치를 찾지 못했어요. 주소를 다시 확인하거나 지도에서 핀을 골라주세요.');
    } finally { if (timer) clearTimeout(timer); if (revision.current === operation) setBusy(false); }
  };
  return <Modal visible={visible} animationType={reduced ? 'fade' : 'slide'} onRequestClose={close}>
    <SafeAreaProvider style={[styles.backdrop, { backgroundColor: theme.background }]}>
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.background, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.header}><Pressable analyticsId="post.location.cancel" accessibilityRole="button" accessibilityLabel={tr("위치 선택 취소")} onPress={close} style={styles.control}>{clay ? <ClayIcon clay="chevron_left" size={22} /> : <ThemedText>‹</ThemedText>}</Pressable><ThemedText type="smallBold">{tr("위치 공유")}</ThemedText><View style={styles.control} /></View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.canvas}>
        {visible && (free ? <PostPinMap pin={pin} label={label} cityName={cityName} onSelect={select} onReadyChange={setReady} bottomInset={cardHeight + 24} />
          : <DiscoveryMap markers={markers} cityName={cityName} selectedId={chosen ? chosen.id : pin ? 'chosen' : null} center={center} zoom={center ? 15 : undefined} topInset={74} bottomInset={cardHeight + 100}
            onSelect={id => { const place = places.find(item => item.id === id); if (place) pick(place, true); }} />)}
        <View style={[styles.search, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <TextInput value={query} onChangeText={value => { revision.current++; setBusy(false); setQuery(value); }} accessibilityLabel={tr("장소·주소 검색")} placeholder={tr("장소나 주소 찾기")} placeholderTextColor={theme.textSecondary}
            onFocus={() => play('selection')} onSubmitEditing={() => void locate(true)} returnKeyType="search" maxLength={150} style={[styles.input, { color: theme.text }]} />
          <Pressable analyticsId="post.location.search" accessibilityRole="button" accessibilityLabel={tr("주소 찾기")} disabled={!mapReady || busy || !query.trim()} onPress={() => void locate(true)} style={[styles.control, clay && { overflow: 'visible', paddingHorizontal: 18 }]}>{clay && <ClayPillFill kind="white" />}<ThemedText themeColor={clay ? undefined : 'accent'}>{tr("검색")}</ThemedText></Pressable>
        </View>
        {ours.length > 0 && <View style={[styles.results, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <ThemedText type="small" themeColor="textSecondary">{tr("글링 지도에 있는 곳")}</ThemedText>
          {ours.map(place => <Pressable key={place.id} analyticsId="post.location.search" accessibilityRole="button" accessibilityLabel={`${place.name}, ${place.address}`} accessibilityHint={tr("이 장소를 첨부할 위치로 골라요")}
            disabled={!mapReady || busy} onPress={() => pick(place)} style={({ pressed }) => [styles.result, { opacity: !mapReady || busy ? 0.5 : pressed ? 0.82 : 1 }]}>
            <CityPlacePhoto place={place} style={styles.photo} />
            <View style={styles.resultText}><ThemedText type="smallBold" numberOfLines={1}>{place.name}</ThemedText><ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{place.address}</ThemedText></View>
          </Pressable>)}
        </View>}
        {/* Above the pin map's credit line; our place map's credit button sits above this row (its bottomInset). */}
        <View pointerEvents="box-none" style={[styles.tools, { bottom: cardHeight + 48 }]}>
          <Pressable analyticsId="post.location.current" accessibilityRole="button" accessibilityLabel={tr("내 위치 선택")} disabled={!mapReady || busy} onPress={() => void locate(false)} style={[styles.current, clay && { overflow: 'visible', paddingHorizontal: 18 }, { backgroundColor: clay ? 'transparent' : theme.card, borderColor: clay ? 'transparent' : theme.line }]}>{clay && <ClayPillFill kind="white" />}<ThemedText type="smallBold">{busy ? tr("찾는 중…") : tr("내 위치")}</ThemedText></Pressable>
          {places.length > 0 && <Pressable analyticsId="post.location.mode" accessibilityRole="button" onPress={toggle} style={[styles.current, clay && { overflow: 'visible', paddingHorizontal: 18 }, { backgroundColor: clay ? 'transparent' : theme.card, borderColor: clay ? 'transparent' : theme.line }]}>{clay && <ClayPillFill kind="white" />}<ThemedText type="smallBold">{free ? tr("글링 장소 보기") : tr("직접 핀 놓기")}</ThemedText></Pressable>}
        </View>
        <View onLayout={event => setCardHeight(Math.min(900, Math.ceil(event.nativeEvent.layout.height)))} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
          {pin ? <TextInput value={label} onChangeText={value => { revision.current++; setBusy(false); setLabel(value.replace(/[\u0000-\u001f\u007f]/g, ' ')); }} maxLength={100} accessibilityLabel={tr("첨부할 위치 이름")} placeholder={tr("선택한 위치")} placeholderTextColor={theme.textSecondary}
            onFocus={() => play('selection')} style={[styles.name, { color: theme.text, borderColor: theme.line }]} /> : <ThemedText type="smallBold">{tr("지도에서 위치를 선택해 주세요.")}</ThemedText>}
          {!pin && <ThemedText type="small" themeColor="textSecondary">{free ? tr("가게를 누르거나, 원하는 지점으로 핀을 옮겨보세요.") : tr("지도의 장소를 누르거나 이름으로 찾아보세요.")}</ThemedText>}
          {pin && <ThemedText type="small" themeColor="textSecondary">{tr("글을 게시하면 글과 통합 지도에 이 위치가 공개돼요.")}</ThemedText>}
          {!!message && <ThemedText type="small" accessibilityRole="alert">{tr(message)}</ThemedText>}
          <Pressable analyticsId="post.location.confirm" accessibilityRole="button" disabled={!mapReady || !pin || busy} onPress={() => { if (!mapReady || !pin || busy) return; revision.current++; play('selection'); onConfirm(pin, label.trim() || '선택한 위치'); }}
            style={[styles.confirm, clay && { overflow: 'visible', paddingHorizontal: 24 }, { backgroundColor: clay ? 'transparent' : theme.accent, opacity: !mapReady || !pin || busy ? 0.5 : 1 }]}>{clay && <ClayPillFill kind="cta" />}<ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr("이 위치 첨부")}</ThemedText></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  screen: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 56 },
  control: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  search: { position: 'absolute', top: 16, left: 16, right: 16, flexDirection: 'row', borderWidth: 1, borderRadius: 14, paddingLeft: 12 },
  results: { position: 'absolute', top: 72, left: 16, right: 16, borderWidth: 1, borderRadius: 14, padding: 8, gap: 4 },
  result: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 }, photo: { width: 40, height: 40, borderRadius: 8, overflow: 'hidden' }, resultText: { flex: 1, gap: 2 },
  input: { flex: 1, minHeight: 48 }, canvas: { flex: 1 }, name: { minHeight: 44, fontSize: 17, borderBottomWidth: 1, paddingVertical: 6 },
  tools: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  current: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderWidth: 1, borderRadius: 12 },
  card: { position: 'absolute', bottom: 16, left: 16, right: 16, borderRadius: 16, padding: 12, gap: 8, borderWidth: 1 },
  confirm: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
});
