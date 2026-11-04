import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { Pressable } from '@/components/analytics-controls';
import { animateLayout } from '@/components/disclosure';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { cityClock, formatRanges, isOpenAt, parseOpeningHours } from '@/lib/opening-hours';

// 2026-11-02 is a Monday, so index 0 lines up with WeekHours.
const weekday = (locale: string, day: number) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2026, 10, 2 + day));

/** Today's hours in the city's own time zone; tap to see the whole week. An unreadable catalog value shows `fallback` instead. */
export function PlaceHours({ openingHours, cityId, now, fallback = null }: { openingHours?: string; cityId: string; now?: number; fallback?: ReactNode }) {
  const { tr, locale } = useLanguage(), { play } = useInteractionFeedback(), reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false), [openedAt] = useState(() => Date.now());
  const hours = parseOpeningHours(openingHours), clock = cityClock(cityId, now ?? openedAt);
  if (!hours || !clock) return fallback;
  const open = isOpenAt(hours, clock), state = open ? tr('영업 중') : tr('영업 종료');
  const day = (index: number) => hours[index].length ? formatRanges(hours[index]) : tr('휴무');
  const today = tr('오늘 {0}', day(clock.day));
  return <View>
    <Pressable analyticsId="discovery.hours" accessibilityRole="button" accessibilityLabel={`${state}, ${today}`} accessibilityHint={tr('요일별 영업시간 보기')} accessibilityState={{ expanded }}
      onPress={() => { play('selection'); animateLayout(reduced); setExpanded(value => !value); }} style={styles.row}>
      <ThemedText type="smallBold" themeColor={open ? 'accent' : 'textSecondary'}>{state}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.today}>· {today} {expanded ? '⌃' : '⌄'}</ThemedText>
    </Pressable>
    {expanded && <View style={styles.week}>{hours.map((_, index) => <View key={index} style={styles.day}>
      <ThemedText type={index === clock.day ? 'smallBold' : 'small'} style={styles.dayName}>{weekday(locale, index)}</ThemedText>
      <ThemedText type={index === clock.day ? 'smallBold' : 'small'} themeColor={index === clock.day ? 'text' : 'textSecondary'}>{day(index)}</ThemedText>
    </View>)}</View>}
  </View>;
}

const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }, today: { flexShrink: 1 },
  week: { gap: 2, paddingBottom: 4 }, day: { flexDirection: 'row', gap: 12 }, dayName: { width: 36 },
});
