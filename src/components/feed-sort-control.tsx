import { useLanguage } from '@/hooks/use-language';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import type { FeedSort } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// byArea adds 동네별, 중고거래 only (owner 2026-11-13).
export function FeedSortControl({ sort, title, onChange, action, children, style, byArea = false }: { sort: FeedSort; title: string; onChange: (sort: FeedSort) => void; action?: ReactNode; children?: ReactNode; style?: StyleProp<ViewStyle>; byArea?: boolean }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  // 바깥은 배경(부르는 쪽이 넓히거나 바꿀 수 있음), 안쪽은 글 폭 그대로의 밑줄.
  return <View style={[{ backgroundColor: theme.background }, style]}><View style={[styles.container, { borderBottomColor: theme.line }]}>
    <View style={styles.row}>
      <ThemedText accessibilityRole="header" style={styles.title}>{title}</ThemedText>
      <View style={styles.options}>
        {(byArea ? ['latest', 'popular', 'area'] as const : ['latest', 'popular'] as const).map(option => {
          const selected = sort === option;
          const label = tr(option === 'latest' ? '최신순' : option === 'popular' ? '인기순' : '동네별');
          return <SelectionChip key={option} selected={selected} analyticsId="components_feed-sort-control.order"
            accessibilityRole="button" accessibilityLabel={option === 'area' ? tr('동네별로 묶어 보기') : tr("{0}으로 정렬", (label))} accessibilityState={{ selected }} aria-pressed={selected}
            onPress={() => { play('selection'); onChange(option); }}
            style={styles.option}>
            <ThemedText type="smallBold" style={{ color: selected ? theme.accentInk : theme.textSecondary }}>{label}</ThemedText>
          </SelectionChip>;
        })}
      </View>
    </View>
    <View style={styles.descriptionRow}><ThemedText type="small" themeColor="textSecondary" style={styles.description}>
      {sort === 'latest' ? tr("새로 올라온 글부터") : sort === 'popular' ? tr("최근 7일 · 반응이 많은 글부터") : tr('글이 많은 동네부터')}
    </ThemedText>{action}</View>
    {children ? <View style={styles.extra}>{children}</View> : null}
  </View></View>;
}

const styles = StyleSheet.create({
  container: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 16, lineHeight: 24, fontWeight: '700' },
  options: { flexDirection: 'row', gap: 8 },
  option: { ...ControlStyles.pill, minWidth: 44, paddingVertical: 8 },
  descriptionRow: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  description: { flexShrink: 1 },
  extra: { marginTop: 12 },
});
