import { useLanguage } from '@/hooks/use-language';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from '@/components/symbol-view';
import { openBrowserAsync } from 'expo-web-browser';
// shortcut: React Native's own Clipboard is deprecated (a dev-only warning); move to expo-clipboard with the next native build.
import { Alert, Clipboard, Keyboard, Linking, Platform, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import Reanimated, { FadeIn, SlideInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { MeetupManageSheet } from '@/components/meetup-manage-sheet';
import { KeyboardScreen } from '@/components/keyboard-screen';
import { RaisedActionButton } from '@/components/raised-action-button';
import { Disclosure } from '@/components/disclosure';
import { ListCard, ListRow } from '@/components/list-card';
import { GlingVisitedBadge, Top50Badge } from '@/components/place-badges';
import { ReservationButton } from '@/components/reservation-button';
import { PlaceReviews } from '@/components/place-reviews';
import { PlaceExternalRatings } from '@/components/place-external-ratings';
import { PlaceHours } from '@/components/place-hours';
import { PageHeader } from '@/components/page-header';
import { PlaceRelated, PlaceSavedBy, usePlaceSaves } from '@/components/place-saves';
import { PostMapLink } from '@/components/post-map-link';
import { PostPhotoCredits } from '@/components/post-photo-credits';
import { StateCard } from '@/components/state-card';
import { ClayBoxFill, ClayControlFill, useClay, useClayBox } from '@/components/clay';
import { ThemedText } from '@/components/themed-text';
import { SavedEntryButton, useSavedEntry } from '@/components/saved-entry';
import { ShareCardSheet } from '@/components/share-card';
import { ControlMotion, ControlStyles, IconSize, Typography, controlPresentation } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTranslationPreference } from '@/hooks/use-content-translation';
import { useCommunityCity } from '@/lib/community-city';
import { CITY_PLACES_COLLECTED_AT, getCityPlaces, type CityPlace } from '@/lib/city-places';
import { deliveryPartnerPlace } from '@/lib/delivery-partners';
import { loadCityBusinessLinks } from '@/lib/webshops';
import { useCityPlacesRevision } from '@/hooks/use-city-places';
import { usePlaceCompose } from '@/hooks/use-place-compose';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { merchantMapsUrl, merchantPhoneUrl, safeMerchantSourceUrl } from '@/lib/merchant-source';
import { useAuth } from '@/lib/auth';
import { recordProductEvent } from '@/lib/product-analytics';
import { DISCOVERY_CATEGORIES, PLACE_SUBCATEGORIES, mapAppUrl, placeCategory, placeMapRoute, priceSymbol } from '@/lib/discovery';
import { publicPlaceId } from '@/lib/public-seo';
import { supabase } from '@/lib/supabase';
import { INSTAGRAM_LINK_SVG, instagramPostLink } from '../../../supabase/functions/_shared/post-links';

export default function PlaceDetailScreen() {
  useCityPlacesRevision();
  const { tr, language, locale: appLocale } = useLanguage();
  const [viewport, setViewport] = useState({ y: 0, height: 0 });
  const [sharing, setSharing] = useState(false), [reviewRequest, setReviewRequest] = useState(0);
  const [directions, setDirections] = useState(false), [copied, setCopied] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null), reviewsY = useRef(0);
  // The fixed buttons step aside while a review is being typed, so they never sit on the keyboard.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    // iOS announces the keyboard before it rises; Android only once it is up.
    const [show, hide] = Platform.OS === 'ios' ? ['keyboardWillShow', 'keyboardWillHide'] as const : ['keyboardDidShow', 'keyboardDidHide'] as const;
    const shown = Keyboard.addListener(show, () => setTyping(true)), hidden = Keyboard.addListener(hide, () => setTyping(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  // The scroll position only decides which reviews auto-translate; other modes skip a re-render per scroll event.
  const trackViewport = useTranslationPreference().mode === 'auto';
  const { cityId, id, review } = useLocalSearchParams<{ cityId?: string; id?: string; review?: string }>();
  // 가 봤어요 on the map card lands here for its review; the section's first layout gives the scroll target.
  const reviewPending = useRef(review === '1');
  const { isAuthed, isAuthLoading, me } = useAuth();
  const hidden = useContentVisibility();
  const isFocused = useIsFocused(), userId = isAuthed ? me.id : null;
  const identity = useRef(userId);
  useLayoutEffect(() => { identity.current = userId; return () => { identity.current = null; }; }, [userId]);
  const { city: selected } = useCommunityCity();
  const city = CITIES.find(item => item.id === (cityId ?? selected.id));
  const theme = useTheme(), clay = useClay(), clayBox = useClayBox(), router = useRouter(), { play } = useInteractionFeedback();
  const reduced = useReducedMotion();
  let found: CityPlace | undefined;
  // Links from the public place page carry its slug (node-123); the catalog keys the place osm:node:123.
  const placeId = typeof id === 'string' ? publicPlaceId(id) : undefined;
  try { if (city && placeId) found = getCityPlaces(city.id).find(item => item.id === placeId) ?? deliveryPartnerPlace(city.id, placeId); } catch { /* Invalid/missing catalog stays an explicit missing-place state. */ }
  const place = found, website = place?.website ? safeMerchantSourceUrl(place.website) : null;
  const phoneUrl = place?.phone ? merchantPhoneUrl(place.phone) : null, instagram = place?.instagram ? instagramPostLink(place.instagram) : null;
  const targetId = place?.id, loadedCityId = place?.cityId;
  const saves = usePlaceSaves(loadedCityId, targetId, isFocused && !isAuthLoading, userId);
  const saved = useSavedEntry(place ? { kind: 'place', id: place.id, cityId: place.cityId } : null, !!place && !!city);
  const compose = usePlaceCompose(place);
  const linkScope = useRef<object | null>(null);
  useLayoutEffect(() => {
    linkScope.current = {};
    return () => { linkScope.current = null; };
  }, [targetId, loadedCityId, userId, isAuthLoading, hidden, isFocused]);
  useEffect(() => {
    if (!isFocused || isAuthLoading || !targetId || !loadedCityId) return;
    const scope = linkScope.current;
    const controller = new AbortController();
    void loadCityBusinessLinks(supabase, loadedCityId, controller.signal).then(links => {
      if (!controller.signal.aborted && linkScope.current === scope && links[targetId]) router.replace({ pathname: '/company/[id]', params: { id: links[targetId] } });
    }).catch(() => {});
    return () => controller.abort();
  }, [isFocused, isAuthLoading, targetId, loadedCityId, router, userId, hidden]);
  const record = useCallback((kind: 'place_view' | 'place_directions' | 'place_website') => {
    if (userId && identity.current === userId && targetId && loadedCityId) {
      void recordProductEvent(supabase, { kind, targetId, cityId: loadedCityId, platform: Platform.OS }).catch(() => {});
    }
  }, [userId, targetId, loadedCityId]);
  useEffect(() => { if (isFocused) record('place_view'); }, [isFocused, record]);
  // G1: after saving as 가 봤음, open the review editor and bring it into view.
  const reviewable = !!targetId?.startsWith('osm:');
  const openReview = () => { setReviewRequest(value => value + 1); scroll.current?.scrollTo({ y: Math.max(0, reviewsY.current - 16), animated: true }); };
  const mapsUrl = place && city ? merchantMapsUrl([place.name, place.address, city.englishName, city.province, 'Canada'].filter(Boolean).join(', ')) : null;
  const openSource = (url: string, kind?: 'place_website') => {
    play('selection');
    // P4: the place's own website opens in the in-app browser like the map screen; sources keep the system browser.
    void (kind ? openBrowserAsync(url) : Linking.openURL(url)).then(() => { if (kind) record(kind); }).catch(() => { play('warning'); Alert.alert(tr("페이지를 열지 못했어요"), tr("잠시 후 다시 시도해 주세요.")); });
  };
  const openMap = (url: string) => {
    void Linking.openURL(url).then(() => record('place_directions'), () => { play('warning'); Alert.alert(tr("길찾기를 열지 못했어요"), tr("인터넷 연결을 확인한 뒤 다시 시도해 주세요.")); });
  };
  const pill = ({ pressed }: { pressed: boolean }) => [ControlStyles.pill, styles.pill, clay && styles.clayPill, controlPresentation(theme, { pressed, clay }).container];
  const tile = [styles.tile, clayBox ? styles.clayCard : { backgroundColor: theme.card }];
  const top50 = !!place && place.recommendation?.placeId === place.id;
  // Openverse's own note belongs with the photo's other credits (A안: 사진 출처 창 안).
  const credits = place?.photo ? [
    place.photo.title && tr(place.photo.title), `${language === 'en' ? 'Photo' : '사진'}: ${place.photo.artist && tr(place.photo.artist)}`, place.photo.sourceUrl,
    place.photo.license, place.photo.licenseUrl,
    language === 'en' ? 'Photos show the place when they were taken. It may look different now.' : '사진은 찍은 때의 모습이라 지금과 다를 수 있어요.',
    place.photo.discoveredVia === 'Openverse' && (language === 'en' ? 'Photos found with Openverse. This service isn’t endorsed or certified by Openverse.' : 'Openverse로 찾은 사진 · Openverse는 이 서비스를 인증하거나 보증하지 않아요.'),
  ].filter(Boolean).join('\n') : '';
  const kinds = place ? [tr(DISCOVERY_CATEGORIES.find(item => item.id === placeCategory(place))!.label), ...PLACE_SUBCATEGORIES.filter(option => place.subcategories?.includes(option.id)).map(option => tr(option.label))] : [];
  const openDirections = () => { play('selection'); setCopied(false); setDirections(true); };
  const copyAddress = () => { if (!place?.address) return; Clipboard.setString(place.address); play('success'); setCopied(true); };
  return <KeyboardScreen><SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
    <PageHeader title={tr('장소')} analyticsId="places.detail.back" fallback={{ pathname: '/places', params: { cityId: city?.id ?? selected.id } }}
      right={place ? <View style={styles.headerActions}>
        {city && <Pressable analyticsId="places.detail.share" accessibilityRole="button" accessibilityLabel={tr('장소 공유')} onPress={() => { play('selection'); setSharing(true); }} style={ControlStyles.icon}>
          <SymbolView name={{ ios: 'square.and.arrow.up', android: 'ios_share', web: 'ios_share' }} size={IconSize.toolbar} tintColor={theme.text} accessible={false} />
        </Pressable>}
        <SavedEntryButton entry={saved} kind="place" analyticsId="save.place"
          onBeen={reviewable ? openReview : undefined} />
      </View> : undefined} />
    {!!saved.error && <ThemedText type="small" accessibilityRole="alert" style={styles.saveError}>{saved.error}</ThemedText>}
    <ScrollView ref={scroll} analyticsId="places.detail.scroll" contentContainerStyle={styles.content} scrollEventThrottle={100}
      onLayout={({ nativeEvent: { layout: { height } } }) => setViewport(previous => previous.height === height ? previous : { ...previous, height })}
      onScroll={trackViewport ? ({ nativeEvent }) => setViewport({ y: nativeEvent.contentOffset.y, height: nativeEvent.layoutMeasurement.height }) : undefined}>
      {!place || !city ? <StateCard kind="error" title={tr("장소를 찾지 못했어요")} body={tr("선택한 도시의 장소 목록에서 다시 열어 주세요.")} /> : <>
        <View>
          <CityPlacePhoto place={place} style={styles.photo} />
          {(top50 || !!place.glingVisited) && <View style={styles.badges}>{top50 && <Top50Badge />}{!!place.glingVisited && <GlingVisitedBadge />}</View>}
          {!!credits && <View style={styles.credit}><PostPhotoCredits credits={credits} variant="photo" /></View>}
        </View>
        <View style={styles.head}>
          <ThemedText type="small" themeColor="textSecondary">{tr(city.name)}{" " + tr("· 지도 등록 장소")}</ThemedText>
          <ThemedText accessibilityRole="header" style={styles.title}>{place.name}</ThemedText>
          {/* Named like the map card (owner 2026-11-11): the map category, then the place's kinds in the map's own order. */}
          <ThemedText type="small" themeColor="textSecondary">{kinds.join(' · ')}</ThemedText>
        </View>
        {!!place.recommendation && <ThemedText>{language === 'en' ? place.recommendation.reasonEn ?? place.recommendation.reason : place.recommendation.reason}</ThemedText>}
        {/* A안 요약 칸: 가격대 and 영업 시간 side by side (a missing one leaves no empty box), then the address with its copy button. */}
        <View style={styles.tiles}>
          {(!!place.priceLevel || !!place.openingHours) && <View style={styles.tileRow}>
            {!!place.priceLevel && <View accessible accessibilityLabel={tr('가격대 {0}, 4단계 중 {1}', priceSymbol(place.priceLevel), place.priceLevel)} style={[tile, !place.openingHours && styles.grow]}>
              {clayBox && <ClayBoxFill kind="tile" />}
              <ThemedText type="small" themeColor="textSecondary">{tr('가격대')}</ThemedText>
              <ThemedText style={Typography.section}>{priceSymbol(place.priceLevel)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{tr('4단계 중 {0}', place.priceLevel)}</ThemedText>
            </View>}
            {!!place.openingHours && <View style={[tile, styles.grow]}>
              {clayBox && <ClayBoxFill kind="tile" />}
              <ThemedText type="small" themeColor="textSecondary">{tr('영업 시간')}</ThemedText>
              <PlaceHours openingHours={place.openingHours} cityId={city.id}
                fallback={<ThemedText type="small" themeColor="textSecondary">{tr("등록된 운영 시간: {0}", (place.openingHours))}</ThemedText>} />
            </View>}
          </View>}
          <View style={tile}>
            {clayBox && <ClayBoxFill kind="tile" />}
            <ThemedText type="small" themeColor="textSecondary">{tr('주소')}</ThemedText>
            <View style={styles.addressRow}>
              <ThemedText style={styles.grow}>{place.address || tr("등록된 주소 정보가 없어요. 지도에서 위치를 확인해 주세요.")}</ThemedText>
              {!!place.address && <Pressable analyticsId="post.share.copy" accessibilityRole="button" accessibilityLabel={tr("주소 복사")} accessibilityHint={place.address} onPress={copyAddress} style={ControlStyles.icon}>
                <SymbolView name={{ ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' }} size={IconSize.inline} tintColor={theme.accent} accessible={false} />
              </Pressable>}
            </View>
          </View>
        </View>
        {copied && <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert" accessibilityLiveRegion="polite">{tr("주소를 복사했어요.")}</ThemedText>}
        {/* P3: 전화·인스타그램·예약 only when the place has them. These reuse IDs already in the server allowlist. */}
        <View style={styles.actions}>
          <Pressable analyticsId="places.open" accessibilityRole="button" accessibilityLabel={`${place.name} · ${tr('글링 지도에서 보기')}`}
            onPress={() => { play('selection'); router.navigate(placeMapRoute(place)); }} style={pill}>
            {clay && <ClayControlFill />}
            <SymbolView name={{ ios: 'map', android: 'map', web: 'map' }} size={IconSize.inline} tintColor={theme.accent} accessible={false} />
            <ThemedText type="smallBold">{tr('글링 지도에서 보기')}</ThemedText>
          </Pressable>
          {!!website && <Pressable analyticsId="places.detail.website" accessibilityRole="link" accessibilityLabel={tr("{0} 웹사이트 열기", (place.name))} onPress={() => openSource(website, 'place_website')} style={pill}>
            {clay && <ClayControlFill />}
            <SymbolView name={{ ios: 'globe', android: 'language', web: 'language' }} size={IconSize.inline} tintColor={theme.accent} accessible={false} />
            <ThemedText type="smallBold">{tr("웹사이트")} ↗</ThemedText>
          </Pressable>}
          {!!phoneUrl && <Pressable analyticsId="company.about.phone" accessibilityRole="link" accessibilityLabel={tr("공개 전화 {0}", (place.phone))} style={pill}
            onPress={() => { play('selection'); void Linking.openURL(phoneUrl).catch(() => { play('warning'); Alert.alert(tr("전화를 걸지 못했어요"), tr("잠시 후 다시 시도해 주세요.")); }); }}>
            {clay && <ClayControlFill />}
            <SymbolView name={{ ios: 'phone', android: 'call', web: 'call' }} size={IconSize.inline} tintColor={theme.accent} accessible={false} />
            <ThemedText type="smallBold">{tr("전화하기")}</ThemedText>
          </Pressable>}
          {!!instagram && <Pressable analyticsId="post.attachment.open" accessibilityRole="link" accessibilityLabel={`${tr("인스타그램")} @${instagram.handle}`} onPress={() => openSource(instagram.url)} style={pill}>
            {clay && <ClayControlFill />}
            <Image source={{ uri: `data:image/svg+xml,${encodeURIComponent(INSTAGRAM_LINK_SVG.replaceAll('currentColor', theme.accent))}` }} style={styles.pillIcon} accessible={false} />
            <ThemedText type="smallBold">{tr("인스타그램")}</ThemedText>
          </Pressable>}
          {/* Business-linked places redirect to the company page, so only a booking-site website can show here. */}
          <ReservationButton website={place.website} />
        </View>
        {mapsUrl && <PostMapLink url={mapsUrl} label={place.name} pin={place} onOpened={() => record('place_directions')} />}
        {/* The legacy analytics target distinguishes this shared action by its screen. 모임 is one list row now; the page's filled button is 글쓰기 below. */}
        {place.id.startsWith('osm:') && <ListCard>
          <ListRow analyticsId="ticketmaster.meetup.find" title={language === 'en' ? 'Find a meetup here' : '이곳에 갈 모임 보기'}
            detail={city.state !== 'open' ? (language === 'en' ? 'Meetups in this city are coming soon.' : '이 도시의 모임은 준비 중이에요.') : undefined}
            leading={<SymbolView name={{ ios: 'person.2', android: 'group', web: 'group' }} size={IconSize.toolbar} tintColor={city.state === 'open' ? theme.accent : theme.textSecondary} accessible={false} />}
            onPress={city.state === 'open' ? () => router.push({ pathname: '/(tabs)/meetups', params: { placeId: place.id, placeCityId: city.id } }) : undefined} />
        </ListCard>}
        <PlaceSavedBy place={place} saves={saves} />
        {place.id.startsWith('osm:') && <View style={styles.section} onLayout={event => { reviewsY.current = event.nativeEvent.layout.y; if (reviewPending.current) { reviewPending.current = false; openReview(); } }}>
          <ThemedText type="subtitle" accessibilityRole="header">{tr('후기')}</ThemedText>
          <PlaceReviews cityId={city.id} placeId={place.id} viewport={viewport} writeRequest={reviewRequest} />
          <PlaceExternalRatings key={`${city.id}:${place.id}`} cityId={city.id} placeId={place.id} />
        </View>}
        <PlaceRelated place={place} saves={saves} />
        {/* OSM attribution has to show without a tap, so it rides in the folded title. */}
        <Disclosure analyticsId="places.detail.attribution" title={tr('출처·이용 조건 · © OpenStreetMap')}>
          {!!place.recommendation && <Pressable analyticsId="places.detail.source" accessibilityRole="link" accessibilityLabel={tr("사진 명소 선정 출처 보기")} onPress={() => openSource(place.recommendation!.sourceUrl)} style={styles.link}>
            <ThemedText type="smallBold" themeColor="accent">{tr("사진 명소 선정 출처 보기")}</ThemedText>
          </Pressable>}
          <Pressable analyticsId="places.detail.source" accessibilityRole="link" accessibilityLabel={tr("OpenStreetMap에서 장소 정보 보기")} onPress={() => openSource(place.sourceUrl)} style={styles.link}>
            <ThemedText type="smallBold" themeColor="accent">{tr("OpenStreetMap에서 장소 정보 보기")}</ThemedText>
          </Pressable>
          {!!credits && <PostPhotoCredits credits={credits} variant="link" />}
          <ThemedText type="small" themeColor="textSecondary">{tr("방문 전 운영 여부와 시간을 확인해 주세요.")}</ThemedText>
          <Pressable analyticsId="places.detail.attribution" accessibilityRole="link" accessibilityLabel={tr("OpenStreetMap 자료 출처와 이용 조건")} onPress={() => openSource('https://www.openstreetmap.org/copyright')} style={styles.link}>
            <ThemedText type="small" themeColor="textSecondary">{tr("© OpenStreetMap contributors · {0} 확인 자료", (new Date(CITY_PLACES_COLLECTED_AT).toLocaleDateString(appLocale)))}</ThemedText>
          </Pressable>
        </Disclosure>
      </>}
    </ScrollView>
    {/* A안: 길찾기 and 글쓰기 stay at the bottom however far the page scrolls. */}
    {place && city && !typing && <Reanimated.View entering={reduced ? FadeIn.duration(ControlMotion.settleMs) : SlideInDown.duration(ControlMotion.expandMs)} style={[styles.footer, { backgroundColor: theme.background, borderTopColor: theme.line }]}>
      <View style={styles.footerRow}>
        <View style={styles.grow}><RaisedActionButton analyticsId="company.about.maps" tone={compose ? 'secondary' : 'primary'} label={tr("길찾기")} onPress={openDirections} /></View>
        {compose && <View style={styles.grow}><RaisedActionButton analyticsId="places.detail.compose" label={tr('이 장소로 글쓰기')} onPress={compose} /></View>}
      </View>
    </Reanimated.View>}
    {place && city && <ShareCardSheet target={{ kind: 'place', place, city }} visible={sharing} onClose={() => setSharing(false)} />}
    {place && directions && <MeetupManageSheet visible title={place.name} onClose={() => setDirections(false)} actions={[
      ...(place.address ? [{ key: 'copy', analyticsId: 'post.share.copy', label: tr("주소 복사"), hint: place.address, icon: { ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' } as const,
        onPress: copyAddress }] : []),
      ...(Platform.OS === 'ios' ? [{ key: 'apple', analyticsId: 'company.location', label: tr("Apple 지도"), icon: { ios: 'map', android: 'map', web: 'map' } as const,
        onPress: () => openMap(mapAppUrl({ cityId: place.cityId, latitude: place.latitude, longitude: place.longitude, place }, 'apple')) }] : []),
      { key: 'google', analyticsId: 'discovery.google', label: tr("Google 지도"), icon: { ios: 'map', android: 'map', web: 'map' }, onPress: () => openMap(mapAppUrl({ cityId: place.cityId, latitude: place.latitude, longitude: place.longitude, place }, 'google')) },
    ]} />}
  </SafeAreaView></KeyboardScreen>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  saveError: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: Spacing.three },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.three, gap: Spacing.three },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 16 },
  badges: { position: 'absolute', top: Spacing.two, left: Spacing.two, flexDirection: 'row', gap: Spacing.one },
  credit: { position: 'absolute', right: Spacing.one, bottom: Spacing.one },
  head: { gap: Spacing.one },
  title: { fontSize: 26, lineHeight: 36, fontWeight: '700' },
  clayCard: { backgroundColor: 'transparent', overflow: 'visible' },
  tiles: { gap: Spacing.two },
  tileRow: { flexDirection: 'row', gap: Spacing.two },
  tile: { padding: Spacing.three, borderRadius: 16, gap: Spacing.one },
  grow: { flex: 1, minWidth: 0 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  section: { gap: Spacing.two },
  link: { minHeight: 44, justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  clayPill: { overflow: 'visible', paddingHorizontal: 18 },
  pill: { flexDirection: 'row', gap: Spacing.one, borderWidth: 1 },
  pillIcon: { width: IconSize.inline, height: IconSize.inline },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.two },
  footerRow: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three },
});
