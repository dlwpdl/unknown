import { useLanguage } from '@/hooks/use-language';
import { StyleSheet, View } from 'react-native';

import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import type { FeedSort } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export function FeedSortControl({ sort, title, onChange }: { sort: FeedSort; title: string; onChange: (sort: FeedSort) => void }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  return <View style={[styles.container, { backgroundColor: theme.background, borderBottomColor: theme.line }]}>
    <View style={styles.row}>
      <ThemedText accessibilityRole="header" style={styles.title}>{title}</ThemedText>
      <View style={styles.options}>
        {(['latest', 'popular'] as const).map(option => {
          const selected = sort === option;
          const label = tr(option === 'latest' ? '최신순' : '인기순');
          return <SelectionChip key={option} selected={selected} analyticsId="components_feed-sort-control.order"
            accessibilityRole="button" accessibilityLabel={tr("{0}으로 정렬", (label))} accessibilityState={{ selected }} aria-pressed={selected}
            onPress={() => { play('selection'); onChange(option); }}
            style={styles.option}>
            <ThemedText type="smallBold" style={{ color: selected ? theme.accentInk : theme.textSecondary }}>{label}</ThemedText>
          </SelectionChip>;
        })}
      </View>
    </View>
    <ThemedText type="small" themeColor="textSecondary" style={styles.description}>
      {sort === 'latest' ? tr("새로 올라온 글부터") : tr("최근 7일 · 반응이 많은 글부터")}
    </ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  container: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 16, lineHeight: 24, fontWeight: '700' },
  options: { flexDirection: 'row', gap: 8 },
  option: { ...ControlStyles.pill, minWidth: 44, paddingVertical: 8 },
  description: { marginTop: 8 },
});
