import { GlingLoader } from '@/components/gling-loader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { AccessibilityInfo, Animated, AppState, Easing, ScrollView as NativeScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { FestivalVideo } from '@/components/festival-video';
import { GlassSurface } from '@/components/glass-surface';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { eventVideo } from '@/lib/event-videos';
import { EVENT_CITIES, eventPriceLabel, eventTime, loadTicketmasterEvents, spotlightLocalEvents, type EventCity, type TicketmasterEvent } from '@/lib/ticketmaster';

export function LocalEventsCarousel({ cityId, refreshKey, cityLoading, onCityReady }: { cityId: string; refreshKey: number; cityLoading: boolean; onCityReady: (cityId: string) => void }) {
  const theme = useTheme();
  const router = useRouter();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const isFocused = useIsFocused();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 44, 596);
  const [attempt, setAttempt] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [screenReader, setScreenReader] = useState(false);
  const carousel = useRef<NativeScrollView>(null);
  const activeIndexRef = useRef(0);
  const userPauseUntil = useRef(0);
  const [result, setResult] = useState<{ key: string; events: TicketmasterEvent[]; error: string } | null>(null);
  const key = `${cityId}:${refreshKey}:${attempt}`;
  const current = result?.key === key ? result : null;

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isFocused || reducedMotion || screenReader || !current || current.events.length < 2) return;
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active' || Date.now() < userPauseUntil.current) return;
      const next = (activeIndexRef.current + 1) % current.events.length;
      activeIndexRef.current = next;
      setActiveIndex(next);
      carousel.current?.scrollTo({ x: next * (cardWidth + 12), animated: true });
    }, 6000);
    return () => clearInterval(timer);
  }, [cardWidth, current, isFocused, reducedMotion, screenReader]);

  useEffect(() => {
    if (!Object.hasOwn(EVENT_CITIES, cityId)) { onCityReady(cityId); return; }
    let active = true;
    loadTicketmasterEvents({ cityId: cityId as EventCity, category: 'all', page: 0, festival: true })
      .then(data => spotlightLocalEvents(data.events).sort((a, b) => Number(!!eventVideo(b)) - Number(!!eventVideo(a))))
      .then(events => { if (active) { activeIndexRef.current = 0; setActiveIndex(0); setResult({ key, events, error: '' }); onCityReady(cityId); } })
      .catch(cause => { if (active) { setResult({ key, events: [], error: cause.message }); onCityReady(cityId); } });
    return () => { active = false; };
  }, [cityId, key, onCityReady]);

  if (!Object.hasOwn(EVENT_CITIES, cityId)) return null;
  const browse = () => { play('selection'); router.push('/events'); };
  return <View style={styles.section}>
    <View style={styles.heading}>
      <View style={styles.titleGroup}>
        <ThemedText accessibilityRole="header" style={styles.title}>다가오는 페스티벌</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">가고 싶은 무대를 먼저 둘러보세요</ThemedText>
      </View>
      <Pressable analyticsId="today.events.browse" accessibilityRole="button" accessibilityLabel="행사 전체 보기" onPress={browse} style={({ pressed }) => [styles.browse, { opacity: pressed ? 0.65 : 1 }]}>
        <ThemedText type="smallBold" themeColor="accent">전체 보기 ›</ThemedText>
      </Pressable>
    </View>
    {!current ? <View style={[styles.loading, { width: cardWidth, backgroundColor: cityLoading ? theme.backgroundElement : 'transparent' }]}>{!cityLoading && <GlingLoader color={theme.accent} accessibilityLabel="행사 불러오는 중" />}</View>
        : current.error ? <Pressable analyticsId="today.events.retry" accessibilityRole="button" onPress={() => { play('selection'); setAttempt(value => value + 1); }} style={[styles.message, { borderColor: theme.line, backgroundColor: theme.card }]}><ThemedText type="small" themeColor="textSecondary">{current.error} 눌러서 다시 시도해 주세요.</ThemedText></Pressable>
          : current.events.length === 0 ? <View style={[styles.message, { borderColor: theme.line, backgroundColor: theme.card }]}><ThemedText type="small" themeColor="textSecondary">예정된 페스티벌이 아직 없어요. 나중에 다시 확인해 주세요.</ThemedText></View>
            : <ScrollView ref={carousel} analyticsId="today.events.carousel" horizontal snapToInterval={cardWidth + 12} decelerationRate="fast" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards} onScrollBeginDrag={() => { userPauseUntil.current = Date.now() + 20000; }} onMomentumScrollEnd={event => {
              const index = Math.max(0, Math.min(current.events.length - 1, Math.round(event.nativeEvent.contentOffset.x / (cardWidth + 12))));
              activeIndexRef.current = index;
              setActiveIndex(index);
            }}>
              {current.events.map((event, index) => <FeaturedEventCard key={`${event.id}:${isFocused && activeIndex === index}`} event={event} cityId={cityId} index={index} width={cardWidth} active={isFocused && activeIndex === index} reducedMotion={!!reducedMotion} onOpen={() => { userPauseUntil.current = Date.now() + 60000; play('selection'); }} />)}
            </ScrollView>}
    <ThemedText type="small" themeColor="textSecondary" style={styles.source}>행사 정보: Ticketmaster · 일정과 판매 상태는 변경될 수 있어요</ThemedText>
  </View>;
}

function FeaturedEventCard({ event, cityId, index, width, active, reducedMotion, onOpen }: { event: TicketmasterEvent; cityId: string; index: number; width: number; active: boolean; reducedMotion: boolean; onOpen: () => void }) {
  const theme = useTheme();
  const promo = eventVideo(event);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageScale] = useState(() => new Animated.Value(1));
  useFocusEffect(useCallback(() => {
    if (reducedMotion || !event.image || (active && videoPlaying)) return;
    const motion = Animated.loop(Animated.sequence([
      Animated.timing(imageScale, { toValue: 1.22, duration: 6200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(imageScale, { toValue: 1, duration: 6200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    motion.start();
    return () => { motion.stop(); imageScale.setValue(1); };
  }, [active, event.image, imageScale, reducedMotion, videoPlaying]));

  return <View style={[styles.ticket, { width }]}>
  <Link href={{ pathname: '/events/[id]', params: { id: event.id, cityId } }} asChild><Link.AppleZoom>
  <Pressable analyticsId="today.events.open" accessibilityRole="button" accessibilityLabel={`${event.name}, ${eventTime(event)}, ${event.venue}`} onPress={onOpen} style={StyleSheet.flatten([styles.card, { backgroundColor: theme.card }])}>
    {event.image ? <Animated.View style={[styles.image, { transform: [{ scale: imageScale }, { translateX: imageScale.interpolate({ inputRange: [1, 1.22], outputRange: [0, -12] }) }, { translateY: imageScale.interpolate({ inputRange: [1, 1.22], outputRange: [0, 8] }) }] }]}><Image source={{ uri: event.image }} style={styles.imageFill} contentFit="cover" accessibilityLabel={event.name} /></Animated.View> : <View style={[styles.image, styles.fallback, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'calendar', android: 'event', web: 'event' }} size={38} tintColor={theme.textSecondary} /></View>}
    {promo && active && !reducedMotion && !videoFailed && <FestivalVideo youtubeId={promo.youtubeId} ambient visible={videoPlaying} onPlaying={() => setVideoPlaying(true)} onError={() => { setVideoPlaying(false); setVideoFailed(true); }} />}
    <Image source={require('@/assets/brand/event-card-scrim.png')} style={styles.scrim} contentFit="fill" accessible={false} />
    <Animated.View style={[styles.badge, event.image && !reducedMotion && { opacity: imageScale.interpolate({ inputRange: [1, 1.22], outputRange: [0.76, 1] }), transform: [{ scale: imageScale.interpolate({ inputRange: [1, 1.22], outputRange: [0.97, 1.03] }) }] }]}><ThemedText style={styles.badgeText}>SPOTLIGHT {String(index + 1).padStart(2, '0')}</ThemedText></Animated.View>
    {promo && !videoFailed && <GlassSurface style={styles.videoBadge}><SymbolView name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }} size={12} tintColor="#F6F3F0" /><ThemedText style={styles.videoBadgeText}>{promo.label} · YouTube</ThemedText></GlassSurface>}
    <View style={styles.cardBody}>
      <ThemedText style={styles.eventTitle} numberOfLines={2}>{event.name}</ThemedText>
      <ThemedText style={styles.eventMeta} numberOfLines={1}>{event.timeUnconfirmed ? eventTime(event) : eventTime(event).split(' · ')[0]} · {event.venue || event.city}</ThemedText>
      <ThemedText style={styles.price} numberOfLines={1}>{eventPriceLabel(event)}</ThemedText>
    </View>
  </Pressable></Link.AppleZoom></Link></View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 24, gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titleGroup: { flex: 1, gap: 2 },
  title: { fontSize: 18, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4 },
  browse: { minHeight: 44, justifyContent: 'center', paddingLeft: 8 },
  cards: { gap: 12, paddingTop: 4, paddingBottom: 18, paddingRight: 16 },
  ticket: { height: 290, borderRadius: 20 },
  card: { flex: 1, borderRadius: 20, overflow: 'hidden' },
  image: { ...StyleSheet.absoluteFill },
  imageFill: { width: '100%', height: '100%' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', zIndex: 2, left: 0, right: 0, bottom: 0, width: '100%', height: 210 },
  badge: { position: 'absolute', zIndex: 2, top: 16, left: 16, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#CBB9FF' },
  badgeText: { color: '#171123', fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.2 },
  videoBadge: { position: 'absolute', zIndex: 2, top: 16, right: 16, maxWidth: '62%', minHeight: 28, borderRadius: 14, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4 },
  videoBadgeText: { color: '#F6F3F0', fontSize: 10, lineHeight: 14, fontWeight: '700' },
  cardBody: { position: 'absolute', zIndex: 2, left: 18, right: 18, bottom: 18, gap: 5 },
  eventTitle: { color: '#F6F3F0', fontSize: 23, lineHeight: 29, fontWeight: '800', letterSpacing: -0.7 },
  eventMeta: { color: '#E9E5EE', fontSize: 12, lineHeight: 18 },
  price: { color: '#CBB9FF', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  loading: { minHeight: 290, borderRadius: 20, justifyContent: 'center' },
  message: { minHeight: 88, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 16, justifyContent: 'center' },
  source: { fontSize: 11, lineHeight: 16 },
});
