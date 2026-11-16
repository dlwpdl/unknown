import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ZoomLink } from '@/components/post-zoom-link';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { SymbolView } from '@/components/symbol-view';
import type { SymbolViewProps } from 'expo-symbols';
import { Spacing } from '@/constants/theme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { FlatList, Pressable, ScrollView } from '@/components/analytics-controls';
import { ClayPillFill, useClay } from '@/components/clay';
import { ThemedText } from '@/components/themed-text';
import { StateCard } from '@/components/state-card';
import { DragSheet } from '@/components/drag-sheet';
import { SectionLabel } from '@/components/list-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { SelectionChip } from '@/components/selection-chip';
import { ControlMotion, Typography } from '@/constants/design-system';
import { eventPhoto } from '@/lib/event-videos';
import { FeedAd } from '@/components/feed-ad';
import { adsSupported } from '@/lib/ads';
import { contentAdPosition } from '@/lib/content-ad-placement';
import { sortEventList } from '@/lib/discovery-sort';
import { useTheme } from '@/hooks/use-theme';
import { useCommunityCity } from '@/lib/community-city';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { EVENT_CITIES, EVENT_CATEGORY_LABELS, eventMatchesPriceFilter, eventPriceLabel, eventTime, eventNotice, loadTicketmasterEventDays, loadTicketmasterEvents, type EventCategory, type EventCity, type EventDays, type EventList, type EventPriceFilter } from '@/lib/ticketmaster';

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const DAY_SIZE = 48;
// A plain tile with the kind of event when Ticketmaster has no art of its own (its stand-ins repeated one photo for every show or game).
const EVENT_ART: Record<string, SymbolViewProps['name']> = {
  Sports: { ios: 'sportscourt', android: 'stadium', web: 'stadium' }, Music: { ios: 'music.note', android: 'music_note', web: 'music_note' },
  'Arts & Theatre': { ios: 'theatermasks', android: 'theater_comedy', web: 'theater_comedy' }, other: { ios: 'ticket', android: 'confirmation_number', web: 'confirmation_number' },
};


export default function EventsScreen() {

  const { city } = useCommunityCity();
  return <EventListScreen key={city.id} />;
}
function EventListScreen() {
  const { locale, tr } = useLanguage();
  const PRICE_FILTERS: { key: EventPriceFilter; label: string }[] = [{ key: 'all', get label() { return tr("전체 가격"); } }, { key: 'free', get label() { return tr("무료"); } }, { key: 'under50', get label() { return tr("CA$50 이하"); } }, { key: 'under100', get label() { return tr("CA$100 이하"); } }, { key: 'unknown', get label() { return tr("가격 미확인"); } }];
  const theme = useTheme(), clay = useClay(), router = useRouter();
  const reducedMotion = useReducedMotion();
  const { city } = useCommunityCity();
  const { play } = useInteractionFeedback();
  const today = new Date(), minimumDate = new Date(today.getFullYear(), today.getMonth(), today.getDate()), maximumDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 365);
  const [category, setCategory] = useState<EventCategory>('all');
  const [date, setDate] = useState('');
  const [priceFilter, setPriceFilter] = useState<EventPriceFilter>('all');
  const [draftCategory, setDraftCategory] = useState<EventCategory>('all');
  const [draftPriceFilter, setDraftPriceFilter] = useState<EventPriceFilter>('all');
  const [calendarMonth, setCalendarMonth] = useState(dateKey(today).slice(0, 7));
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [calendarProgress] = useState(() => new Animated.Value(0));
  const [filterOpen, setFilterOpen] = useState(false);
  const [pageReveal] = useState(() => new Animated.Value(0));
  const [calendarResult, setCalendarResult] = useState<{ key: string; data: EventDays | null; error: boolean } | null>(null);
  // 더 보기 appends the next page to the same list; a new city, category or day starts over at page 0.
  const [page, setPage] = useState(0), [attempt, setAttempt] = useState(0), [moreAttempt, setMoreAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; page: number; data: EventList | null; error: string } | null>(null);
  const [moreFailure, setMoreFailure] = useState<{ key: string; message: string } | null>(null);
  const supported = Object.hasOwn(EVENT_CITIES, city.id);
  const requestKey = `${city.id}:${category}:${date}:${attempt}`, moreKey = `${requestKey}:${page}:${moreAttempt}`;
  const current = result?.key === requestKey ? result : null;
  const data = current?.data, error = current?.error ?? '';
  const moreError = moreFailure?.key === moreKey ? moreFailure.message : '';
  const loadingMore = !!current && current.page < page && !moreError;
  const visibleEvents = sortEventList((data?.events ?? []).filter(event => eventMatchesPriceFilter(event, priceFilter)));
  const filterCount = Number(category !== 'all') + Number(priceFilter !== 'all');
  const loading = supported && !current;
  const calendarKey = `${city.id}:${category}:${calendarMonth}`;
  const calendar = calendarResult?.key === calendarKey ? calendarResult : null;
  const markedDays = new Set([...(calendar?.data?.days ?? []), ...(data?.events ?? []).map(event => event.localDate).filter((day): day is string => !!day && day.startsWith(calendarMonth))]);
  const [calendarYear, calendarMonthNumber] = calendarMonth.split('-').map(Number);
  const firstWeekday = new Date(calendarYear, calendarMonthNumber - 1, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonthNumber, 0).getDate();
  const focusDay = date.startsWith(calendarMonth) ? Number(date.slice(8)) : calendarMonth === dateKey(today).slice(0, 7) ? today.getDate() : 1;
  const focusWeek = Math.floor((firstWeekday + focusDay - 1) / 7);
  const calendarRows = Math.ceil((firstWeekday + daysInMonth) / 7);
  const calendarHeight = calendarProgress.interpolate({ inputRange: [0, 1], outputRange: [DAY_SIZE, calendarRows * DAY_SIZE] });
  const calendarOffset = calendarProgress.interpolate({ inputRange: [0, 1], outputRange: [-focusWeek * DAY_SIZE, 0] });
  useEffect(() => {
    if (!supported) return;
    let active = true;
    loadTicketmasterEvents({ cityId: city.id as EventCity, category, page, ...(date ? { date } : {}) })
      // sortEventList drops an event that shows up again on the next page.
      .then(next => { if (active) setResult(previous => ({ key: requestKey, page, error: '', data: page && previous?.key === requestKey && previous.data ? { ...next, events: [...previous.data.events, ...next.events] } : next })); })
      .catch(cause => { if (!active) return; if (page) setMoreFailure({ key: moreKey, message: cause.message }); else setResult({ key: requestKey, page, data: null, error: cause.message }); });
    return () => { active = false; };
  }, [supported, city.id, category, date, page, requestKey, moreKey]);
  useEffect(() => {
    if (!supported) return;
    let active = true;
    loadTicketmasterEventDays(city.id as EventCity, category, calendarMonth)
      .then(data => { if (active) setCalendarResult({ key: calendarKey, data, error: false }); })
      .catch(() => { if (active) setCalendarResult({ key: calendarKey, data: null, error: true }); });
    return () => { active = false; };
  }, [supported, city.id, category, calendarMonth, calendarKey]);
  useEffect(() => {
    if (reducedMotion) { pageReveal.setValue(1); return; }
    const motion = Animated.timing(pageReveal, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    motion.start();
    return () => motion.stop();
  }, [pageReveal, reducedMotion]);
  const setCalendarOpen = (open: boolean) => {
    calendarProgress.stopAnimation();
    setCalendarExpanded(open);
    if (reducedMotion) calendarProgress.setValue(open ? 1 : 0);
    else Animated.timing(calendarProgress, { toValue: open ? 1 : 0, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  };
  const changeMonth = (step: number) => { play('selection'); setCalendarMonth(dateKey(new Date(calendarYear, calendarMonthNumber - 1 + step, 1)).slice(0, 7)); setDate(''); setPage(0); };
  return <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
    <View style={[styles.header, { backgroundColor: theme.background }]}>
      <Pressable analyticsId="ticketmaster.back" accessibilityRole="button" accessibilityLabel={tr("뒤로가기")} onPress={() => { play('selection'); if (router.canGoBack()) router.back(); else router.replace('/'); }} style={({ pressed }) => [styles.back, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable>
      <View style={styles.headerCopy}>
        <ThemedText style={styles.headerTitle} accessibilityRole="header" numberOfLines={2}>{tr("공연·행사")}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{tr(city.name)} · Ticketmaster{tr(date ? tr(" · {0}월 {1}일", (Number(date.slice(5, 7))), (Number(date.slice(8)))) : '')}</ThemedText>
      </View>
    </View>
    <Animated.View style={{ flex: 1, opacity: pageReveal, transform: [{ translateY: pageReveal.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
    <FlatList analyticsId="ticketmaster.events" data={visibleEvents} keyExtractor={item => item.id} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.listHeader}>
        <View style={styles.calendarHeader}><SymbolView name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }} size={20} tintColor={theme.accent} /><ThemedText type="smallBold">{tr("날짜별 행사")}</ThemedText><Pressable analyticsId="ticketmaster.date.open" accessibilityRole="button" accessibilityLabel={tr(calendarExpanded ? tr("달력 접기") : tr("한 달 달력 펼치기"))} accessibilityState={{ expanded: calendarExpanded }} onPress={() => { play('selection'); setCalendarOpen(!calendarExpanded); }} style={({ pressed }) => [styles.calendarToggle, clay && styles.clayPad, { opacity: pressed ? 0.65 : 1 }]}>{clay && <ClayPillFill kind="white" />}<ThemedText type="smallBold" themeColor="accent">{tr(calendarExpanded ? tr("접기 ⌃") : tr("한 달 보기 ⌄"))}</ThemedText></Pressable></View>
        <View style={styles.monthHeader}>
          <Pressable analyticsId="ticketmaster.date.month" accessibilityRole="button" accessibilityLabel={tr("이전 달")} disabled={calendarMonth <= dateKey(minimumDate).slice(0, 7)} onPress={() => changeMonth(-1)} style={({ pressed }) => [styles.monthArrow]}><ThemedText type="subtitle" themeColor={calendarMonth <= dateKey(minimumDate).slice(0, 7) ? 'textSecondary' : 'accent'}>‹</ThemedText></Pressable>
          {/* This title and the weekday row stay in UTC: in B.C. a local Date can read an hour early, which turned 11월 into 10월 on iPhones. */}
          <ThemedText type="smallBold">{new Date(Date.UTC(calendarYear, calendarMonthNumber - 1, 1)).toLocaleDateString(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' })}</ThemedText>
          <Pressable analyticsId="ticketmaster.date.month" accessibilityRole="button" accessibilityLabel={tr("다음 달")} disabled={calendarMonth >= dateKey(maximumDate).slice(0, 7)} onPress={() => changeMonth(1)} style={({ pressed }) => [styles.monthArrow]}><ThemedText type="subtitle" themeColor={calendarMonth >= dateKey(maximumDate).slice(0, 7) ? 'textSecondary' : 'accent'}>›</ThemedText></Pressable>
        </View>
        <View style={styles.weekRow}>{Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(2024, 0, 7 + index)).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })).map(weekday => <ThemedText key={weekday} type="small" themeColor="textSecondary" style={styles.weekday}>{weekday}</ThemedText>)}</View>
        <Animated.View style={{ height: calendarHeight, overflow: 'hidden' }}>
        <Animated.View style={[styles.daysGrid, { transform: [{ translateY: calendarOffset }] }]}>
          {Array.from({ length: calendarRows * 7 }, (_, index) => {
            const day = 1 - firstWeekday + index;
            const visible = calendarExpanded || Math.floor(index / 7) === focusWeek;
            if (day < 1 || day > daysInMonth) return <View key={`pad-${index}`} style={styles.daySlot} />;
            const key = `${calendarMonth}-${String(day).padStart(2, '0')}`;
            const unavailable = key < dateKey(minimumDate) || key > dateKey(maximumDate), selected = date === key;
            return <View key={key} style={styles.daySlot} pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}><Pressable analyticsId="ticketmaster.date.day" accessibilityRole="button" accessibilityLabel={tr("{0}월 {1}일{2}", (calendarMonthNumber), (day), (markedDays.has(key) ? tr(', 행사 확인됨') : ''))} accessibilityState={{ selected, disabled: unavailable }} disabled={unavailable} onPress={() => { play('selection'); setDate(key); setPage(0); if (calendarExpanded) setCalendarOpen(false); }} style={({ pressed }) => [styles.dayButton, { backgroundColor: selected ? theme.accent : 'transparent', opacity: unavailable ? 0.35 : pressed ? 0.6 : 1 }]}><ThemedText type="smallBold" style={{ color: selected ? theme.accentInk : theme.text }}>{day}</ThemedText>{markedDays.has(key) ? <View style={[styles.dayDot, { backgroundColor: selected ? theme.accentInk : theme.accent }]} /> : null}</Pressable></View>;
          })}
        </Animated.View>
        </Animated.View>
        {(calendarExpanded || calendar?.error || (calendar?.data && !calendar.data.complete)) ? <View style={styles.calendarNote}>{calendar && !calendar.error ? <View style={[styles.legendDot, { backgroundColor: theme.accent }]} /> : null}<ThemedText type="small" themeColor="textSecondary" style={styles.legendText}>{tr(!calendar ? tr("행사 날짜를 확인하고 있어요.") : calendar.error ? tr("현재 목록에서 확인된 날짜만 표시했어요. 다른 날도 검색할 수 있어요.") : calendar.data?.complete ? tr("표시된 날에는 이 도시의 행사가 확인됐어요.") : tr("확인된 일부 행사 날짜예요. 점이 없어도 날짜를 눌러 검색할 수 있어요."))}</ThemedText></View> : null}
        <View style={styles.resultHeader}><ThemedText type="subtitle" style={styles.resultTitle}>{tr(date ? tr("{0}월 {1}일 행사", (Number(date.slice(5, 7))), (Number(date.slice(8)))) : tr("다가오는 행사"))}</ThemedText><View style={styles.resultActions}>{date ? <Pressable analyticsId="ticketmaster.date.clear" accessibilityRole="button" accessibilityLabel={tr("날짜 선택 해제하고 다가오는 행사 보기")} onPress={() => { play('selection'); setDate(''); setPage(0); }} style={({ pressed }) => [styles.clearDate, clay && styles.clayPad, { opacity: pressed ? 0.65 : 1 }]}>{clay && <ClayPillFill kind="white" />}<ThemedText type="smallBold" themeColor="accent">{tr("전체 날짜")}</ThemedText></Pressable> : null}<Pressable analyticsId="ticketmaster.price.filters" accessibilityRole="button" accessibilityLabel={tr("필터, 행사 종류 {0}, {1}", (tr(EVENT_CATEGORY_LABELS[category])), (PRICE_FILTERS.find(filter => filter.key === priceFilter)?.label))} onPress={() => { play('selection'); setDraftCategory(category); setDraftPriceFilter(priceFilter); setFilterOpen(true); }} style={({ pressed }) => [styles.filterButton, clay ? styles.clayPad : { borderColor: filterCount ? theme.accent : theme.line, backgroundColor: theme.card }, { opacity: pressed ? 0.7 : 1 }]}>{clay && <ClayPillFill kind="white" />}<SymbolView name={{ ios: 'line.3.horizontal.decrease', android: 'tune', web: 'tune' }} size={16} tintColor={filterCount ? theme.accent : theme.text} /><ThemedText type="smallBold" themeColor={filterCount ? 'accent' : 'text'}>{tr("필터")}{filterCount ? ` ${filterCount}` : ''}</ThemedText></Pressable></View></View>
      </View>}
      ListEmptyComponent={loading ? <View style={styles.loading}><GlingLoader color={theme.accent} /><ThemedText type="small">{tr("행사를 불러오고 있어요")}</ThemedText></View>
        : !supported ? <StateCard title={tr("이 지역 행사는 준비 중이에요")} body={tr("모임 화면에서 지원하는 캐나다 도시를 선택해 주세요.")} />
            : error ? <StateCard kind="error" title={tr("행사를 불러오지 못했어요")} body={error} actionLabel={tr("다시 시도")} onAction={() => { play('selection'); setAttempt(n => n + 1); }} />
              : <StateCard title={tr(priceFilter !== 'all' && !!data?.events.length ? tr("불러온 행사 중에는 이 가격대가 없어요") : date ? tr("이 날짜의 행사가 없어요") : tr("예정된 행사가 아직 없어요"))} body={tr(data?.hasMore && priceFilter !== 'all' ? '아래에서 행사를 더 불러올 수 있어요.' : '다른 날짜나 가격·카테고리를 선택해 주세요.')} />}
      renderItem={({ item, index }) => <><ZoomLink href={{ pathname: '/events/[id]', params: { id: item.id, cityId: city.id } }} anchor><Pressable analyticsId="ticketmaster.event.open" accessibilityRole="button" accessibilityLabel={`${item.name}, ${eventTime(item, locale)}, ${item.venue}`} onPress={() => play('selection')} style={StyleSheet.flatten([styles.card, { backgroundColor: theme.card }])}>
        {eventPhoto(item) ? <Image source={{ uri: eventPhoto(item)! }} style={styles.image} contentFit="cover" transition={ControlMotion.settleMs} accessibilityLabel={tr("행사 이미지")} />
          : <View style={[styles.image, styles.imageEmpty, { backgroundColor: theme.backgroundElement }]}><SymbolView name={EVENT_ART[item.segment ?? ''] ?? EVENT_ART.other} size={30} tintColor={theme.textSecondary} /></View>}
        <View style={styles.cardBody}>
          <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={1}>{eventTime(item, locale)}</ThemedText>
          <ThemedText type="smallBold" style={styles.cardTitle} numberOfLines={2}>{item.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{item.venue || item.city}</ThemedText>
          {/* No price, no line (design rule: unknown values drop their line). */}
          {(!!eventNotice(item, locale) || !!item.price) && <ThemedText type="smallBold" themeColor={item.price ? 'accent' : 'textSecondary'} numberOfLines={1}>{eventNotice(item, locale) || eventPriceLabel(item, locale)}</ThemedText>}
        </View>
      </Pressable></ZoomLink>{adsSupported && !loading && !error && contentAdPosition(index, visibleEvents.length) && <FeedAd key={`ad-after-${item.id}`} surface="events" />}</>}
      ListFooterComponent={<View style={styles.footer}>{!!data?.hasMore && (loadingMore ? <GlingLoader color={theme.accent} accessibilityLabel={tr("행사 더 불러오는 중")} /> : <View style={styles.moreArea}>
        {!!moreError && <ThemedText type="small" accessibilityRole="alert" themeColor="textSecondary" style={styles.moreError}>{moreError}</ThemedText>}
        <Pressable analyticsId="ticketmaster.next" accessibilityRole="button" onPress={() => { play('selection'); if (moreError) setMoreAttempt(n => n + 1); else setPage(n => n + 1); }} style={styles.more}><ThemedText style={Typography.menu} themeColor="accent">{moreError ? tr("다시 시도") : tr("행사 더 보기")}</ThemedText></Pressable>
      </View>)}<ThemedText type="small" themeColor="textSecondary">{tr("행사 정보 제공: Ticketmaster. 일정·판매 상태는 변경될 수 있어요. 구매 전 판매처에서 최신 정보를 확인해 주세요.")}</ThemedText></View>} />
    </Animated.View>
    {/* Same sheet as the meetup filter: chips per section, reset and show at the bottom. Choices apply on 행사 보기. */}
    <DragSheet visible={filterOpen} onClose={() => setFilterOpen(false)} title={tr("필터")}>
      <ScrollView analyticsId="ticketmaster.filter.options" style={styles.filterScroll}>
        <SectionLabel>{tr("행사 종류")}</SectionLabel>
        <View accessibilityRole="radiogroup" accessibilityLabel={tr("행사 종류")} style={styles.sheetChips}>{(Object.keys(EVENT_CATEGORY_LABELS) as EventCategory[]).map(key => <SelectionChip key={key} analyticsId={`ticketmaster.category.${key}`} label={tr(EVENT_CATEGORY_LABELS[key])} selected={draftCategory === key} accessibilityRole="radio" aria-checked={draftCategory === key} accessibilityState={{ selected: draftCategory === key }} onPress={() => { play('selection'); setDraftCategory(key); }} />)}</View>
        <SectionLabel>{tr("가격")}</SectionLabel>
        <View accessibilityRole="radiogroup" accessibilityLabel={tr("가격")} style={styles.sheetChips}>{PRICE_FILTERS.map(filter => <SelectionChip key={filter.key} analyticsId="ticketmaster.price.select" label={filter.label} selected={draftPriceFilter === filter.key} accessibilityRole="radio" aria-checked={draftPriceFilter === filter.key} accessibilityState={{ selected: draftPriceFilter === filter.key }} onPress={() => { play('selection'); setDraftPriceFilter(filter.key); }} />)}</View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.filterNote}>{tr("판매처에 올라온 최저가 기준이에요. 결제할 때 수수료가 붙을 수 있어요.")}</ThemedText>
      </ScrollView>
      <View style={styles.sheetActions}>
        <View style={styles.sheetAction}><RaisedActionButton analyticsId="ticketmaster.price.filters" tone="secondary" label={tr("필터 초기화")} onPress={() => { play('selection'); setDraftCategory('all'); setDraftPriceFilter('all'); }} /></View>
        <View style={styles.sheetAction}><RaisedActionButton analyticsId="ticketmaster.price.filters" label={tr("행사 보기")} onPress={() => { play('selection'); setCategory(draftCategory); setPriceFilter(draftPriceFilter); setPage(0); setFilterOpen(false); }} /></View>
      </View>
    </DragSheet>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  clayPad: { overflow: 'visible', paddingHorizontal: 18, borderWidth: 0 },
  root: { flex: 1 }, header: { width: '100%', maxWidth: 640, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }, back: { width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, minWidth: 0 }, headerTitle: { fontSize: 20, lineHeight: 27, fontWeight: '700', letterSpacing: -0.5 },
  listHeader: { gap: 8, marginBottom: 8 }, calendarHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, calendarToggle: { marginLeft: 'auto', minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  monthHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, monthArrow: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  weekRow: { flexDirection: 'row' }, weekday: { width: '14.2857%', textAlign: 'center' }, daysGrid: { flexDirection: 'row', flexWrap: 'wrap' }, daySlot: { width: '14.2857%', height: DAY_SIZE, alignItems: 'center', justifyContent: 'center' }, dayButton: { width: '100%', maxWidth: DAY_SIZE, height: DAY_SIZE, borderRadius: DAY_SIZE / 2, alignItems: 'center', justifyContent: 'center' }, dayDot: { position: 'absolute', bottom: 3, width: 5, height: 5, borderRadius: 3 }, calendarNote: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 7 }, legendDot: { width: 5, height: 5, borderRadius: 3 }, legendText: { flex: 1 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }, resultTitle: { flex: 1 }, resultActions: { flexDirection: 'row', alignItems: 'center', gap: 4 }, clearDate: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }, filterButton: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterScroll: { flexShrink: 1 }, sheetChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.one }, filterNote: { paddingTop: Spacing.three, lineHeight: 20 }, sheetActions: { flexDirection: 'row', gap: 8, marginTop: Spacing.two }, sheetAction: { flex: 1, minWidth: 0 },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 30, gap: 14 }, loading: { padding: 32, gap: 16, alignItems: 'center' },
  card: { borderRadius: 16, overflow: 'hidden', flexDirection: 'row', height: 124 }, image: { width: 112, height: 124 }, imageEmpty: { alignItems: 'center', justifyContent: 'center' }, cardBody: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 9, justifyContent: 'space-between' }, cardTitle: { fontSize: 15, lineHeight: 19 },
  footer: { gap: 24, paddingVertical: 14 }, moreArea: { alignItems: 'center' }, moreError: { textAlign: 'center' }, more: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
});
