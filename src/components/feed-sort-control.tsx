import { useLanguage } from '@/hooks/use-language';
import type { ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useRevealChip } from '@/hooks/use-reveal-chip';
import { useTheme } from '@/hooks/use-theme';
import type { FeedSort } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// byArea adds 동네별, 중고거래 only (owner 2026-11-13).
// compact folds the title and description into one row of order chips + action, for short screens (owner 2026-11-13 "작은 화면에서만 위쪽 줄이기", QA B12-1).
export function FeedSortControl({ sort, title, onChange, action, children, style, byArea = false, compact = false }: { sort: FeedSort; title: string; onChange: (sort: FeedSort) => void; action?: ReactNode; children?: ReactNode; style?: StyleProp<ViewStyle>; byArea?: boolean; compact?: boolean }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const row = useRevealChip(sort, !useReducedMotion(), Platform.OS === 'android');
  const options = <View style={styles.options}>
    {(byArea ? ['latest', 'popular', 'area'] as const : ['latest', 'popular'] as const).map(option => {
      const selected = sort === option;
      const label = tr(option === 'latest' ? '최신순' : option === 'popular' ? '인기순' : '동네별');
      return <SelectionChip key={option} selected={selected} analyticsId="components_feed-sort-control.order"
        accessibilityRole="button" accessibilityLabel={option === 'area' ? tr('동네별로 묶어 보기') : tr("{0}으로 정렬", (label))} accessibilityState={{ selected }} aria-pressed={selected}
        onPress={() => { play('selection'); onChange(option); }} onLayout={compact ? row.chip(option) : undefined}
        style={styles.option}>
        <ThemedText type="smallBold" style={{ color: selected ? theme.accentInk : theme.textSecondary }}>{label}</ThemedText>
      </SelectionChip>;
    })}
  </View>;
  // 바깥은 배경(부르는 쪽이 넓히거나 바꿀 수 있음), 안쪽은 글 폭 그대로의 밑줄.
  // 접은 줄은 줄바꿈 대신 옆으로 넘긴다: 중고거래의 세 정렬 + 네 모양 버튼은 좁은 폭에서 두 줄이 되어 접어도 줄지 않는다(QA B12-1).
  // Only the order chips scroll; the view switch stays pinned at the right, as scrolling it too started the chosen view and 지도 cut off screen (QA N-sort-row).
  return <View style={[{ backgroundColor: theme.background }, style]}><View style={[styles.container, { borderBottomColor: theme.line }]}>
    {compact ? <View style={styles.compactRow}><ScrollView {...row.scroll} horizontal showsHorizontalScrollIndicator={false} style={styles.compactScroll} contentContainerStyle={styles.compactOptions}>{options}</ScrollView>{action}</View> : <><View style={styles.row}>
      <ThemedText accessibilityRole="header" style={styles.title}>{title}</ThemedText>
      {options}
    </View>
    <View style={styles.descriptionRow}><ThemedText type="small" themeColor="textSecondary" style={styles.description}>
      {sort === 'latest' ? tr("새로 올라온 글부터") : sort === 'popular' ? tr("최근 7일 · 반응이 많은 글부터") : tr('글이 많은 동네부터')}
    </ThemedText>{action}</View></>}
    {children ? <View style={styles.extra}>{children}</View> : null}
  </View></View>;
}

const styles = StyleSheet.create({
  container: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // The scroll frame reaches into the container padding so a 3D pill's shadow below it is not clipped, without making the row taller.
  compactScroll: { flex: 1, marginVertical: -Spacing.two },
  compactOptions: { paddingVertical: Spacing.two },
  title: { fontSize: 16, lineHeight: 24, fontWeight: '700' },
  options: { flexDirection: 'row', gap: 8 },
  option: { ...ControlStyles.pill, minWidth: 44, paddingVertical: 8 },
  descriptionRow: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  description: { flexShrink: 1 },
  extra: { marginTop: 12 },
});
