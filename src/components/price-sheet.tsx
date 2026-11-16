import { StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { DragSheet } from '@/components/drag-sheet';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { PRICE_LEVELS, priceSymbol } from '@/lib/discovery';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

/** The map's and search's price picker: several levels at once, applied together. `draft` null keeps it closed. */
export function PriceSheet({ draft, onDraft, onApply, analyticsId }: { draft: number[] | null; onDraft: (draft: number[] | null) => void; onApply: (levels: number[]) => void; analyticsId: string }) {
  const theme = useTheme(), { tr } = useLanguage(), { play } = useInteractionFeedback();
  return <DragSheet visible={draft !== null} onClose={() => onDraft(null)} title={tr('가격')}>
    <View style={styles.options}>{PRICE_LEVELS.map(level => {
      const on = !!draft?.includes(level);
      return <SelectionChip key={level} selected={on} baseColor={theme.backgroundElement} analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={tr('가격대 {0}단계', level)} accessibilityState={{ selected: on }}
        onPress={() => { play('selection'); onDraft(draft && (draft.includes(level) ? draft.filter(other => other !== level) : [...draft, level])); }} style={[styles.option, { borderColor: on ? theme.accent : theme.line }]}>
        <ThemedText type="smallBold" style={{ color: on ? theme.accentInk : theme.text }}>{priceSymbol(level)}</ThemedText>
      </SelectionChip>;
    })}</View>
    <ThemedText type="caption" themeColor="textSecondary">{tr('여러 개 같이 고를 수 있어요. 가격 정보가 있는 곳만 남아요.')}</ThemedText>
    <View style={[styles.actions, { borderColor: theme.line }]}>
      <Pressable analyticsId={analyticsId} accessibilityRole="button" onPress={() => { play('selection'); onDraft([]); }} style={styles.reset}><ThemedText>{tr("초기화")}</ThemedText></Pressable>
      <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={tr('가격 적용')} onPress={() => { play('selection'); onApply(draft ?? []); }} style={[styles.apply, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr("적용")}</ThemedText></Pressable>
    </View>
  </DragSheet>;
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', gap: 8, paddingVertical: 8 }, option: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  reset: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  apply: { flex: 1, minHeight: 44, minWidth: 90, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
