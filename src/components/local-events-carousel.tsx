import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { useCallback, useEffect, useState } from 'react';
import { Link, useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { SymbolView } from '@/components/symbol-view';
import { AppState, StyleSheet, View } from 'react-native';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { ControlMotion, MiniCard } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadPublicFestivals } from '@/lib/public-web';
import { supabase } from '@/lib/supabase';
import { EVENT_CITIES, eventPriceLabel, eventTime, festivalLocalDay, type EventCity, type TicketmasterEvent } from '@/lib/ticketmaster';

// 큰 회전 카드 대신 작은 가로 줄 (owner 2026-10-30). 불러오기·하루 바뀜·앱 복귀 때 다시 읽는 동작은 그대로다.
export function LocalEventsCarousel({ cityId, refreshKey, cityLoading, page = 0 }: { cityId: string; refreshKey: number; cityLoading: boolean; page?: number }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const router = useRouter();
  const { play } = useInteractionFeedback();
  const isFocused = useIsFocused();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; events: TicketmasterEvent[]; error: string; nextRefreshAt?: string } | null>(null);
  const key = `${cityId}:${refreshKey}:${attempt}`;
  const current = result?.key === key ? result : null;

  useFocusEffect(useCallback(() => {
    if (!Object.hasOwn(EVENT_CITIES, cityId)) return;
    let active = true;
    loadPublicFestivals(supabase, cityId)
      .then(data => {
        if (active) setResult({ key, events: data.events, error: '', nextRefreshAt: data.nextRefreshAt });
      })
      .catch(() => { if (active) setResult({ key, events: [], error: '행사 정보를 불러오지 못했어요.', nextRefreshAt: new Date(Date.now() + 15 * 60000).toISOString() }); });
    return () => { active = false; };
  }, [cityId, key]));

  useEffect(() => {
    if (!isFocused || !Object.hasOwn(EVENT_CITIES, cityId)) return;
    let day = festivalLocalDay(cityId as EventCity);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setAttempt(value => value + 1);
    });
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      const nextDay = festivalLocalDay(cityId as EventCity);
      if (nextDay !== day || (current?.nextRefreshAt && Date.parse(current.nextRefreshAt) <= Date.now())
        || current?.events.some(event => event.startsAt && Date.parse(event.startsAt) <= Date.now())) {
        day = nextDay;
        setAttempt(value => value + 1);
      }
    }, 60000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [cityId, current, isFocused]);

  if (!Object.hasOwn(EVENT_CITIES, cityId)) return null;
  // page: the Nth festival turn between 오늘 posts (owner 2026-11-04). Every turn lists the whole row (owner 2026-10-30);
  // with no events the turn is skipped, and only the first turn shows the loader and the retry.
  if ((page > 0 || (current && !current.error)) && !current?.events.length) return null;
  const browse = () => { play('selection'); router.push('/events'); };
  return <View style={styles.section}>
    <View style={styles.heading}>
      <ThemedText accessibilityRole="header" type="section" style={styles.title}>{tr("다가오는 페스티벌")}</ThemedText>
      <Pressable analyticsId="today.events.browse" accessibilityRole="button" accessibilityLabel={tr("행사 전체 보기")} onPress={browse} style={({ pressed }) => [styles.browse, { opacity: pressed ? ControlMotion.pressedOpacity : 1 }]}>
        <ThemedText type="smallBold" themeColor="accent">{tr("전체 보기 ›")}</ThemedText>
      </Pressable>
    </View>
    {!current ? <View style={[styles.loading, { backgroundColor: cityLoading ? theme.backgroundElement : 'transparent' }]}>{!cityLoading && <GlingLoader color={theme.accent} accessibilityLabel={tr("행사 불러오는 중")} />}</View>
        : current.error ? <Pressable analyticsId="today.events.retry" accessibilityRole="button" onPress={() => { play('selection'); setAttempt(value => value + 1); }} style={[styles.message, { borderColor: theme.line, backgroundColor: theme.card }]}><ThemedText type="small" themeColor="textSecondary">{current.error}{" " + tr("눌러서 다시 시도해 주세요.")}</ThemedText></Pressable>
          : <ScrollView analyticsId="today.events.carousel" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
              {current.events.map(event => <EventRowCard key={event.id} event={event} cityId={cityId} />)}
            </ScrollView>}
    <ThemedText type="caption" themeColor="textSecondary">{tr("행사 정보: Ticketmaster · 일정과 판매 상태는 변경될 수 있어요")}</ThemedText>
  </View>;
}

function EventRowCard({ event, cityId }: { event: TicketmasterEvent; cityId: string }) {
  const { locale } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const when = eventTime(event, locale), place = event.venue || event.city;
  // shortcut: Ticketmaster gives only the original title; show a Korean title here once the event data carries one.
  return <Link href={{ pathname: '/events/[id]', params: { id: event.id, cityId } }} asChild><Link.AppleZoom>
  <Pressable analyticsId="today.events.open" accessibilityRole="button" accessibilityLabel={[event.name, when, place, event.price && eventPriceLabel(event, locale)].filter(Boolean).join(', ')}
    onPress={() => play('selection')} style={({ pressed }) => [styles.card, { opacity: pressed ? ControlMotion.pressedOpacity : 1 }]}>
    {event.image ? <Image source={{ uri: event.image }} transition={ControlMotion.settleMs} style={styles.photo} contentFit="cover" accessible={false} />
      : <View style={[styles.photo, styles.fallback, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'calendar', android: 'event', web: 'event' }} size={22} tintColor={theme.textSecondary} /></View>}
    <ThemedText type="label" numberOfLines={2}>{event.name}</ThemedText>
    <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>{when}</ThemedText>
    <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>{place}</ThemedText>
    {event.price && <ThemedText type="caption" themeColor="accent" numberOfLines={1}>{eventPriceLabel(event, locale)}</ThemedText>}
  </Pressable></Link.AppleZoom></Link>;
}

const styles = StyleSheet.create({
  section: { marginTop: Spacing.four, gap: Spacing.two },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1, minWidth: 0 },
  browse: { minHeight: 44, justifyContent: 'center', paddingLeft: Spacing.two },
  cards: { gap: Spacing.two, paddingRight: Spacing.three },
  card: { width: MiniCard.width, gap: 2 },
  photo: { width: '100%', height: MiniCard.photoHeight, borderRadius: MiniCard.radius, marginBottom: Spacing.one },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  loading: { minHeight: MiniCard.photoHeight + 72, borderRadius: MiniCard.radius, justifyContent: 'center' },
  message: { minHeight: 88, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 16, justifyContent: 'center' },
});
