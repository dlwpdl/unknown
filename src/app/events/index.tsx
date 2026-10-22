import { GlingLoader } from '@/components/gling-loader';
import { useEffect, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { Animated, Easing, Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { FlatList, Pressable, ScrollView } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { StateCard } from '@/components/state-card';
import { useTheme } from '@/hooks/use-theme';
import { useCommunityCity } from '@/lib/community-city';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { EVENT_CITIES, EVENT_CATEGORY_LABELS, eventMatchesPriceFilter, eventPriceLabel, eventTime, eventNotice, loadTicketmasterEventDays, loadTicketmasterEvents, type EventCategory, type EventCity, type EventDays, type EventList, type EventPriceFilter } from '@/lib/ticketmaster';

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const DAY_SIZE = 48;
const PRICE_FILTERS: { key: EventPriceFilter; label: string }[] = [{ key: 'all', label: '전체 가격' }, { key: 'free', label: '무료 표시' }, { key: 'under50', label: 'CA$50 이하' }, { key: 'under100', label: 'CA$100 이하' }, { key: 'unknown', label: '가격 미확인' }];

export default function EventsScreen() {
  const { city } = useCommunityCity();
  return <EventListScreen key={city.id} />;
}
function EventListScreen() {
  const theme = useTheme(), router = useRouter();
  const reducedMotion = useReducedMotion(), { height: screenHeight } = useWindowDimensions();
  const { city } = useCommunityCity();
  const { play } = useInteractionFeedback();
  const pressScale = (pressed: boolean, scale = 0.96) => ({ transform: [{ scale: reducedMotion || !pressed ? 1 : scale }] });
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
  const [sheetOffset] = useState(() => new Animated.Value(screenHeight));
  const [pageReveal] = useState(() => new Animated.Value(0));
  const [calendarResult, setCalendarResult] = useState<{ key: string; data: EventDays | null; error: boolean } | null>(null);
  const [page, setPage] = useState(0), [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; data: EventList | null; error: string } | null>(null);
  const supported = Object.hasOwn(EVENT_CITIES, city.id);
  const requestKey = `${city.id}:${category}:${date}:${page}:${attempt}`;
  const current = result?.key === requestKey ? result : null;
  const data = current?.data, error = current?.error ?? '';
  const visibleEvents = (data?.events ?? []).filter(event => eventMatchesPriceFilter(event, priceFilter));
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
    loadTicketmasterEvents({ cityId: city.id as EventCity, category, page, ...(date ? { date } : {}) }).then(data => { if (active) setResult({ key: requestKey, data, error: '' }); })
      .catch(cause => { if (active) setResult({ key: requestKey, data: null, error: cause.message }); });
    return () => { active = false; };
  }, [supported, city.id, category, date, page, requestKey]);
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
  const closeFilter = () => {
    if (reducedMotion) { setFilterOpen(false); return; }
    Animated.timing(sheetOffset, { toValue: screenHeight, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true })
      .start(({ finished }) => { if (finished) setFilterOpen(false); });
  };
  return <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
    <View style={[styles.header, { backgroundColor: theme.background }]}>
      <Pressable analyticsId="ticketmaster.back" accessibilityRole="button" accessibilityLabel="뒤로가기" onPress={() => { play('selection'); router.back(); }} style={({ pressed }) => [styles.back, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable>
      <View style={styles.headerCopy}>
        <ThemedText style={styles.headerTitle} accessibilityRole="header" numberOfLines={2}>함께 가고 싶은 페스티벌</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{city.name} · Ticketmaster{date ? ` · ${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일` : ''}</ThemedText>
      </View>
    </View>
    <Animated.View style={{ flex: 1, opacity: pageReveal, transform: [{ translateY: pageReveal.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
    <FlatList analyticsId="ticketmaster.events" data={visibleEvents} keyExtractor={item => item.id} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.listHeader}>
        <View style={styles.calendarHeader}><SymbolView name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }} size={20} tintColor={theme.accent} /><ThemedText type="smallBold">날짜별 행사</ThemedText><Pressable analyticsId="ticketmaster.date.open" accessibilityRole="button" accessibilityLabel={calendarExpanded ? '달력 접기' : '한 달 달력 펼치기'} accessibilityState={{ expanded: calendarExpanded }} onPress={() => { play('selection'); setCalendarOpen(!calendarExpanded); }} style={({ pressed }) => [styles.calendarToggle, { opacity: pressed ? 0.65 : 1 }, pressScale(pressed)]}><ThemedText type="smallBold" themeColor="accent">{calendarExpanded ? '접기 ⌃' : '한 달 보기 ⌄'}</ThemedText></Pressable></View>
        <View style={styles.monthHeader}>
          <Pressable analyticsId="ticketmaster.date.month" accessibilityRole="button" accessibilityLabel="이전 달" disabled={calendarMonth <= dateKey(minimumDate).slice(0, 7)} onPress={() => changeMonth(-1)} style={({ pressed }) => [styles.monthArrow, pressScale(pressed, 0.88)]}><ThemedText type="subtitle" themeColor={calendarMonth <= dateKey(minimumDate).slice(0, 7) ? 'textSecondary' : 'accent'}>‹</ThemedText></Pressable>
          <ThemedText type="smallBold">{calendarYear}년 {calendarMonthNumber}월</ThemedText>
          <Pressable analyticsId="ticketmaster.date.month" accessibilityRole="button" accessibilityLabel="다음 달" disabled={calendarMonth >= dateKey(maximumDate).slice(0, 7)} onPress={() => changeMonth(1)} style={({ pressed }) => [styles.monthArrow, pressScale(pressed, 0.88)]}><ThemedText type="subtitle" themeColor={calendarMonth >= dateKey(maximumDate).slice(0, 7) ? 'textSecondary' : 'accent'}>›</ThemedText></Pressable>
        </View>
        <View style={styles.weekRow}>{['일', '월', '화', '수', '목', '금', '토'].map(weekday => <ThemedText key={weekday} type="small" themeColor="textSecondary" style={styles.weekday}>{weekday}</ThemedText>)}</View>
        <Animated.View style={{ height: calendarHeight, overflow: 'hidden' }}>
        <Animated.View style={[styles.daysGrid, { transform: [{ translateY: calendarOffset }] }]}>
          {Array.from({ length: calendarRows * 7 }, (_, index) => {
            const day = 1 - firstWeekday + index;
            const visible = calendarExpanded || Math.floor(index / 7) === focusWeek;
            if (day < 1 || day > daysInMonth) return <View key={`pad-${index}`} style={styles.daySlot} />;
            const key = `${calendarMonth}-${String(day).padStart(2, '0')}`;
            const unavailable = key < dateKey(minimumDate) || key > dateKey(maximumDate), selected = date === key;
            return <View key={key} style={styles.daySlot} pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}><Pressable analyticsId="ticketmaster.date.day" accessibilityRole="button" accessibilityLabel={`${calendarMonthNumber}월 ${day}일${markedDays.has(key) ? ', 행사 확인됨' : ''}`} accessibilityState={{ selected, disabled: unavailable }} disabled={unavailable} onPress={() => { play('selection'); setDate(key); setPage(0); if (calendarExpanded) setCalendarOpen(false); }} style={({ pressed }) => [styles.dayButton, { backgroundColor: selected ? theme.accent : 'transparent', opacity: unavailable ? 0.35 : pressed ? 0.6 : 1 }, pressScale(pressed, 0.88)]}><ThemedText type="smallBold" style={{ color: selected ? theme.accentInk : theme.text }}>{day}</ThemedText>{markedDays.has(key) ? <View style={[styles.dayDot, { backgroundColor: selected ? theme.accentInk : theme.accent }]} /> : null}</Pressable></View>;
          })}
        </Animated.View>
        </Animated.View>
        {(calendarExpanded || calendar?.error || (calendar?.data && !calendar.data.complete)) ? <View style={styles.calendarNote}>{calendar && !calendar.error ? <View style={[styles.legendDot, { backgroundColor: theme.accent }]} /> : null}<ThemedText type="small" themeColor="textSecondary" style={styles.legendText}>{!calendar ? '행사 날짜를 확인하고 있어요.' : calendar.error ? '현재 목록에서 확인된 날짜만 표시했어요. 다른 날도 검색할 수 있어요.' : calendar.data?.complete ? '표시된 날에는 이 도시의 행사가 확인됐어요.' : '확인된 일부 행사 날짜예요. 점이 없어도 날짜를 눌러 검색할 수 있어요.'}</ThemedText></View> : null}
        <View style={styles.resultHeader}><ThemedText type="subtitle" style={styles.resultTitle}>{date ? `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일 행사` : '다가오는 행사'}</ThemedText><View style={styles.resultActions}>{date ? <Pressable analyticsId="ticketmaster.date.clear" accessibilityRole="button" accessibilityLabel="날짜 선택 해제하고 다가오는 행사 보기" onPress={() => { play('selection'); setDate(''); setPage(0); }} style={({ pressed }) => [styles.clearDate, { opacity: pressed ? 0.65 : 1 }, pressScale(pressed)]}><ThemedText type="smallBold" themeColor="accent">전체 날짜</ThemedText></Pressable> : null}<Pressable analyticsId="ticketmaster.price.filters" accessibilityRole="button" accessibilityLabel={`필터, 행사 종류 ${EVENT_CATEGORY_LABELS[category]}, ${PRICE_FILTERS.find(filter => filter.key === priceFilter)?.label}`} onPress={() => { play('selection'); setDraftCategory(category); setDraftPriceFilter(priceFilter); setFilterOpen(true); }} style={({ pressed }) => [styles.filterButton, { borderColor: filterCount ? theme.accent : theme.line, backgroundColor: theme.card, opacity: pressed ? 0.7 : 1 }]}><SymbolView name={{ ios: 'line.3.horizontal.decrease', android: 'tune', web: 'tune' }} size={16} tintColor={filterCount ? theme.accent : theme.text} /><ThemedText type="smallBold" themeColor={filterCount ? 'accent' : 'text'}>필터{filterCount ? ` ${filterCount}` : ''}</ThemedText></Pressable></View></View>
      </View>}
      ListEmptyComponent={loading ? <View style={styles.loading}><GlingLoader color={theme.accent} /><ThemedText type="small">행사를 불러오고 있어요</ThemedText></View>
        : !supported ? <StateCard title="이 지역 행사는 준비 중이에요" body="모임 화면에서 지원하는 캐나다 도시를 선택해 주세요." />
            : error ? <StateCard kind="error" title="행사를 불러오지 못했어요" body={error} actionLabel="다시 시도" onAction={() => { play('selection'); setAttempt(n => n + 1); }} />
              : <StateCard title={priceFilter !== 'all' && !!data?.events.length ? '이 페이지에 해당 가격의 행사가 없어요' : date ? '이 날짜의 행사가 없어요' : '예정된 행사가 아직 없어요'} body={data?.hasMore && priceFilter !== 'all' ? '다음 페이지에도 행사가 있어요. 다른 페이지를 확인해 주세요.' : '다른 날짜나 가격·카테고리를 선택해 주세요.'} />}
      renderItem={({ item }) => <Link href={{ pathname: '/events/[id]', params: { id: item.id, cityId: city.id } }} asChild><Link.AppleZoom><Pressable analyticsId="ticketmaster.event.open" accessibilityRole="button" accessibilityLabel={`${item.name}, ${eventTime(item)}, ${item.venue}`} onPress={() => play('selection')} style={StyleSheet.flatten([styles.card, { backgroundColor: theme.card }])}>
        {item.image ? <Image source={{ uri: item.image }} style={styles.image} contentFit="cover" accessibilityLabel="행사 이미지" /> : <View style={[styles.image, { backgroundColor: theme.backgroundElement }]} />}
        <View style={styles.cardBody}>
          <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={1}>{eventTime(item)}</ThemedText>
          <ThemedText type="smallBold" style={styles.cardTitle} numberOfLines={2}>{item.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{item.venue || item.city}</ThemedText>
          <ThemedText type="smallBold" themeColor={item.price ? 'accent' : 'textSecondary'} numberOfLines={1}>{eventNotice(item) || eventPriceLabel(item)}</ThemedText>
        </View>
      </Pressable></Link.AppleZoom></Link>}
      ListFooterComponent={<View style={styles.footer}>{!!data && <View style={styles.paging}>
        <Pressable analyticsId="ticketmaster.previous" accessibilityRole="button" disabled={!page || loading} accessibilityState={{ disabled: !page || loading }} onPress={() => { play('selection'); setPage(n => n - 1); }} style={({ pressed }) => [styles.chip, { borderColor: theme.line, backgroundColor: theme.card, opacity: !page || loading ? 0.35 : pressed ? 0.7 : 1 }]}><ThemedText>이전</ThemedText></Pressable>
        <ThemedText type="small">{page + 1} 페이지</ThemedText>
        <Pressable analyticsId="ticketmaster.next" accessibilityRole="button" disabled={!data.hasMore || loading} accessibilityState={{ disabled: !data.hasMore || loading }} onPress={() => { play('selection'); setPage(n => n + 1); }} style={({ pressed }) => [styles.chip, { borderColor: theme.line, backgroundColor: theme.card, opacity: !data.hasMore || loading ? 0.35 : pressed ? 0.7 : 1 }]}><ThemedText>다음</ThemedText></Pressable>
      </View>}<ThemedText type="small" themeColor="textSecondary">행사 정보 제공: Ticketmaster. 일정·판매 상태는 변경될 수 있어요. 구매 전 판매처에서 최신 정보를 확인해 주세요.</ThemedText></View>} />
    </Animated.View>
    <Modal visible={filterOpen} transparent animationType="none" onRequestClose={closeFilter}
      onShow={() => { sheetOffset.setValue(screenHeight); if (reducedMotion) sheetOffset.setValue(0); else Animated.timing(sheetOffset, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }}>
      <View style={styles.sheetWrap}>
        <Pressable analyticsId="ticketmaster.price.filters" accessibilityRole="button" accessibilityLabel="필터 닫기" onPress={() => { play('selection'); closeFilter(); }} style={styles.scrim} />
        <Animated.View style={{ transform: [{ translateY: sheetOffset }] }}><SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: theme.background, maxHeight: screenHeight * 0.85 }]}>
          <View style={styles.sheetHeader}><ThemedText type="subtitle">필터</ThemedText><Pressable analyticsId="ticketmaster.price.filters" accessibilityRole="button" accessibilityLabel="필터 닫기" onPress={() => { play('selection'); closeFilter(); }} style={({ pressed }) => [styles.sheetClose, { backgroundColor: theme.backgroundElement, borderRadius: 22, opacity: pressed ? 0.7 : 1 }]}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={18} tintColor={theme.text} /></Pressable></View>
          <ScrollView analyticsId="ticketmaster.filter.options" style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
          <ThemedText type="smallBold">행사 종류</ThemedText>
          <View style={styles.categoryOptions}>{(Object.keys(EVENT_CATEGORY_LABELS) as EventCategory[]).map(key => <Pressable key={key} analyticsId={`ticketmaster.category.${key}`} accessibilityRole="radio" accessibilityState={{ selected: draftCategory === key }} onPress={() => { play('selection'); setDraftCategory(key); }} style={({ pressed }) => [styles.categoryChip, { borderColor: draftCategory === key ? theme.accent : theme.line, backgroundColor: draftCategory === key ? theme.accent : theme.card, opacity: pressed ? 0.7 : 1 }]}><ThemedText type="smallBold" style={{ color: draftCategory === key ? theme.accentInk : theme.text }}>{EVENT_CATEGORY_LABELS[key]}</ThemedText></Pressable>)}</View>
          <ThemedText type="smallBold" style={styles.priceTitle}>가격</ThemedText>
          {PRICE_FILTERS.map(filter => <Pressable key={filter.key} analyticsId="ticketmaster.price.select" accessibilityRole="radio" accessibilityState={{ selected: draftPriceFilter === filter.key }} onPress={() => { play('selection'); setDraftPriceFilter(filter.key); }} style={({ pressed }) => [styles.filterOption, { borderBottomColor: theme.line, opacity: pressed ? 0.65 : 1, transform: [{ translateX: pressed && !reducedMotion ? 3 : 0 }] }]}><ThemedText type="smallBold" themeColor={draftPriceFilter === filter.key ? 'accent' : 'text'}>{filter.label}</ThemedText>{draftPriceFilter === filter.key ? <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={18} tintColor={theme.accent} /> : null}</Pressable>)}
          <ThemedText type="small" themeColor="textSecondary" style={styles.filterNote}>Ticketmaster가 제공한 최저 표시가로 현재 페이지에서만 비교해요. 실제 결제 가격과 수수료는 판매처에서 확인해 주세요.</ThemedText>
          </ScrollView>
          <View style={styles.sheetActions}><Pressable analyticsId="ticketmaster.price.filters" accessibilityRole="button" accessibilityLabel="필터 초기화" onPress={() => { play('selection'); setDraftCategory('all'); setDraftPriceFilter('all'); }} style={({ pressed }) => [styles.resetButton, { borderColor: theme.line, backgroundColor: theme.card, opacity: pressed ? 0.7 : 1 }]}><ThemedText type="smallBold">초기화</ThemedText></Pressable><Pressable analyticsId="ticketmaster.price.filters" accessibilityRole="button" accessibilityLabel="필터 적용하고 행사 보기" onPress={() => { play('selection'); setCategory(draftCategory); setPriceFilter(draftPriceFilter); setPage(0); closeFilter(); }} style={({ pressed }) => [styles.applyButton, { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>행사 보기</ThemedText></Pressable></View>
        </SafeAreaView></Animated.View>
      </View>
    </Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1 }, header: { width: '100%', maxWidth: 640, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }, back: { width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, minWidth: 0 }, headerTitle: { fontSize: 20, lineHeight: 27, fontWeight: '700', letterSpacing: -0.5 },
  chip: { borderWidth: 1, borderRadius: 24, paddingHorizontal: 18, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  listHeader: { gap: 8, marginBottom: 8 }, calendarHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, calendarToggle: { marginLeft: 'auto', minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  monthHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, monthArrow: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  weekRow: { flexDirection: 'row' }, weekday: { width: '14.2857%', textAlign: 'center' }, daysGrid: { flexDirection: 'row', flexWrap: 'wrap' }, daySlot: { width: '14.2857%', height: DAY_SIZE, alignItems: 'center', justifyContent: 'center' }, dayButton: { width: '100%', maxWidth: DAY_SIZE, height: DAY_SIZE, borderRadius: DAY_SIZE / 2, alignItems: 'center', justifyContent: 'center' }, dayDot: { position: 'absolute', bottom: 3, width: 5, height: 5, borderRadius: 3 }, calendarNote: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 7 }, legendDot: { width: 5, height: 5, borderRadius: 3 }, legendText: { flex: 1 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }, resultTitle: { flex: 1 }, resultActions: { flexDirection: 'row', alignItems: 'center', gap: 4 }, clearDate: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }, filterButton: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' }, scrim: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.28)' }, sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, gap: 2 }, sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }, sheetClose: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, filterScroll: { flexShrink: 1 }, filterContent: { gap: 2 }, categoryOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 10 }, categoryChip: { minHeight: 42, borderWidth: 1, borderRadius: 21, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }, priceTitle: { paddingTop: 10 }, filterOption: { minHeight: 50, borderBottomWidth: 1, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, filterNote: { paddingTop: 12, paddingBottom: 8, lineHeight: 20 }, sheetActions: { flexDirection: 'row', gap: 8, marginTop: 8 }, resetButton: { flex: 1, minHeight: 50, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, applyButton: { flex: 2, minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 30, gap: 14 }, loading: { padding: 32, gap: 16, alignItems: 'center' },
  card: { borderRadius: 16, overflow: 'hidden', flexDirection: 'row', height: 124 }, image: { width: 112, height: 124 }, cardBody: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 9, justifyContent: 'space-between' }, cardTitle: { fontSize: 15, lineHeight: 19 },
  footer: { gap: 24, paddingVertical: 14 }, paging: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
