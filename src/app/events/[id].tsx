import { GlingLoader } from '@/components/gling-loader';
import { useEffect, useState } from 'react';
import { Link, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { LayoutAnimation, Linking, Platform, StyleSheet, UIManager, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { FestivalVideo } from '@/components/festival-video';
import { GlassSurface } from '@/components/glass-surface';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { StateCard } from '@/components/state-card';
import { Depth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { eventVideo } from '@/lib/event-videos';
import { useCommunityCity } from '@/lib/community-city';
import { useAuth } from '@/lib/auth';
import { CITIES } from '@/lib/mock';
import { eventNotice, eventPriceLabel, eventTime, loadTicketmasterEvent, meetupAllowed, recordTicketmasterEventClick, type TicketmasterEvent } from '@/lib/ticketmaster';

export default function EventDetailScreen() {
  const { id, cityId } = useLocalSearchParams<{ id: string; cityId: string }>();
  const theme = useTheme(), router = useRouter();
  const { setCity } = useCommunityCity();
  const { isAuthed, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const isFocused = useIsFocused();
  const [result, setResult] = useState<{ key: string; event: TicketmasterEvent | null; error: string } | null>(null);
  const [videoOpen, setVideoOpen] = useState(!reducedMotion);
  const [videoError, setVideoError] = useState('');
  const [linkError, setLinkError] = useState(''), [attempt, setAttempt] = useState(0);
  const requestKey = `${cityId}:${id}:${attempt}`;
  const current = result?.key === requestKey ? result : null;
  const event = current?.event, error = current?.error ?? '', loading = !current;
  const promo = event ? eventVideo(event) : null;
  useEffect(() => {
    let active = true;
    const show = (event: TicketmasterEvent | null, error: string) => {
      if (!active) return;
      setVideoOpen(!reducedMotion);
      setVideoError('');
      if (!reducedMotion && Platform.OS !== 'web') {
        if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
        LayoutAnimation.configureNext({ duration: 220, create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity } });
      }
      setResult({ key: requestKey, event, error });
    };
    loadTicketmasterEvent(cityId, id).then(result => show(result.event, ''))
      .catch(cause => show(null, cause.message));
    return () => { active = false; };
  }, [cityId, id, requestKey, reducedMotion]);
  useEffect(() => {
    if (isAuthed && isFocused && event?.id) void recordTicketmasterEventClick(cityId, event.id).catch(() => {});
  }, [cityId, event?.id, isAuthed, isFocused]);
  const create = () => {
    play('selection');
    const city = CITIES.find(item => item.id === cityId && item.state === 'open');
    if (!city || !event || !meetupAllowed(event)) return;
    if (!isAuthed) return promptLogin('이 행사에 갈 모임을 만들려면 가입하거나 로그인해 주세요.');
    setCity(city);
    router.push({ pathname: '/meetup-create', params: { ticketmasterEventId: event.id, ticketmasterCityId: cityId } });
  };
  const findMeetups = () => {
    play('selection');
    const city = CITIES.find(item => item.id === cityId && item.state === 'open');
    if (!city || !event || !meetupAllowed(event)) return;
    setCity(city);
    router.push({ pathname: '/(tabs)/meetups', params: { ticketmasterEventId: event.id } });
  };
  return <Link.AppleZoomTarget><SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
    <View style={[styles.header, { backgroundColor: theme.background }]}><Pressable analyticsId="ticketmaster.detail.back" accessibilityRole="button" accessibilityLabel="뒤로가기" onPress={() => { play('selection'); router.back(); }} style={({ pressed }) => [styles.back, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable><ThemedText accessibilityRole="header" style={styles.headerTitle}>행사 정보</ThemedText><View style={styles.back} /></View>
    <ScrollView analyticsId="ticketmaster.detail" style={styles.scroll} contentContainerStyle={[styles.content, loading && styles.loadingContent]}>
      {loading ? <GlingLoader color={theme.accent} accessibilityLabel="행사 불러오는 중" /> : error ? <StateCard kind="error" title="행사를 확인하지 못했어요" body={error} actionLabel="다시 시도" onAction={() => { play('selection'); setAttempt(n => n + 1); }} /> : event && <>
        {(event.image || promo) && <View style={[styles.hero, { backgroundColor: theme.card }]}>
          {event.image && <Image source={{ uri: event.image }} style={styles.heroImage} contentFit="cover" accessibilityLabel={event.name} />}
          {promo && videoOpen && isFocused && <FestivalVideo youtubeId={promo.youtubeId} muted onError={() => { setVideoOpen(false); setVideoError('영상을 재생하지 못했어요. 다시 시도해 주세요.'); }} />}
          {promo && !videoOpen && <GlassSurface interactive style={styles.playVideo}><Pressable analyticsId="ticketmaster.detail.video.play" accessibilityRole="button" accessibilityLabel={`${promo.label} 보기`} onPress={() => { play('selection'); setVideoError(''); setVideoOpen(true); }} style={({ pressed }) => [styles.videoTouch, { opacity: pressed ? 0.65 : 1 }]}><SymbolView name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }} size={16} tintColor="#F6F3F0" /><ThemedText style={styles.playVideoText}>영상 보기</ThemedText></Pressable></GlassSurface>}
          {promo && videoOpen && <GlassSurface interactive style={styles.closeVideo}><Pressable analyticsId="ticketmaster.detail.video.close" accessibilityRole="button" accessibilityLabel="영상 닫기" onPress={() => { play('selection'); setVideoOpen(false); }} style={({ pressed }) => [styles.closeTouch, { opacity: pressed ? 0.65 : 1 }]}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} tintColor="#F6F3F0" /></Pressable></GlassSurface>}
        </View>}
        {promo && <ThemedText type="small" themeColor="textSecondary">{promo.label} · YouTube{videoOpen ? ' · 음소거 자동 재생' : ''}</ThemedText>}
        {!!videoError && <ThemedText accessibilityRole="alert" themeColor="accent">{videoError}</ThemedText>}
        <ThemedText type="subtitle" accessibilityRole="header">{event.name}</ThemedText>
        <View style={[styles.facts, { backgroundColor: theme.card }]}><ThemedText type="smallBold" themeColor="accent">{eventTime(event)}</ThemedText><ThemedText>{event.venue || '장소 확인 필요'}</ThemedText><ThemedText type="small" themeColor="textSecondary">{event.city} · 행사 현지 시간 기준</ThemedText><ThemedText type="smallBold" themeColor={event.price ? 'accent' : 'textSecondary'}>{eventPriceLabel(event)}</ThemedText></View>
        {!!eventNotice(event) && <ThemedText accessibilityRole="alert" themeColor="accent">{eventNotice(event)}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">티켓 구매와 모임 참여는 별개예요. 각자 티켓을 준비하고, 집결 장소는 모임 대화에서 정해 주세요.</ThemedText>
        <Pressable analyticsId="ticketmaster.meetup.find" accessibilityRole="button" accessibilityState={{ disabled: !meetupAllowed(event) }} disabled={!meetupAllowed(event)} onPress={findMeetups} style={({ pressed }) => [styles.button, Depth.control, { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, opacity: !meetupAllowed(event) ? 0.4 : 1, transform: [{ translateY: pressed ? 2 : 0 }] }]}><ThemedText type="smallBold">함께 갈 모임 찾기</ThemedText></Pressable>
        <RaisedActionButton analyticsId="ticketmaster.meetup.create" label="함께 갈 모임 만들기" disabled={!meetupAllowed(event)} onPress={create} />
        <View style={styles.description}><ThemedText type="smallBold">행사 안내</ThemedText><ThemedText type="small" themeColor="textSecondary">{event.description || '판매처에서 행사 소개를 제공하지 않았어요. 자세한 내용은 티켓 페이지에서 확인해 주세요.'}</ThemedText></View>
        <Pressable analyticsId="ticketmaster.purchase" accessibilityRole="link" accessibilityState={{ disabled: !event.ticketUrl }} disabled={!event.ticketUrl} onPress={() => { play('selection'); setLinkError(''); if (event.ticketUrl) void Linking.openURL(event.ticketUrl).catch(() => setLinkError('티켓 페이지를 열지 못했어요. 다시 시도해 주세요.')); }} style={({ pressed }) => [styles.button, Depth.control, { borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, opacity: !event.ticketUrl ? 0.4 : 1, transform: [{ translateY: pressed ? 2 : 0 }] }]}><ThemedText type="smallBold">Ticketmaster에서 티켓 확인 ↗</ThemedText></Pressable>
        {!!linkError && <ThemedText accessibilityRole="alert" themeColor="accent">{linkError}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">최종 가격·수수료·남은 티켓·최신 일정은 판매처에서 확인해 주세요. 이 링크로 구매하면 글링이 수수료를 받을 수 있어요.</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">행사 정보 제공: Ticketmaster</ThemedText>
      </>}
    </ScrollView>
  </SafeAreaView></Link.AppleZoomTarget>;
}
const styles = StyleSheet.create({ root: { flex: 1 }, header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }, back: { width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 22, fontWeight: '600' }, scroll: { flex: 1 }, content: { padding: 22, gap: 20 }, loadingContent: { flexGrow: 1, justifyContent: 'center' }, hero: { width: '100%', aspectRatio: 16 / 9, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, heroImage: { ...StyleSheet.absoluteFill }, playVideo: { minHeight: 48, borderRadius: 24 }, videoTouch: { minHeight: 48, minWidth: 48, flexDirection: 'row', gap: 8, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' }, closeVideo: { position: 'absolute', zIndex: 2, top: 8, right: 8, width: 48, height: 48, borderRadius: 24 }, closeTouch: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }, playVideoText: { color: '#F6F3F0', fontSize: 15, fontWeight: '700' }, facts: { padding: 18, borderRadius: 16, gap: 8 }, description: { gap: 8 }, button: { minHeight: 52, borderRadius: 16, padding: 14, alignItems: 'center', justifyContent: 'center' } });
