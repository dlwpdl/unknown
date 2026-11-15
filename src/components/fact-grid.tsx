import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { ClayBoxFill, useClayBox } from '@/components/clay';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Fact = { label: string; value: string | null; note?: string | null; extra?: ReactNode };

// The two-column summary card under a detail title (모임 언제·어디·인원·나이, 글 급여·근무지·근무 시간·하는 일).
// Empty cells drop out; an odd last cell takes the full row; large text stacks the cells in one column.
export function FactGrid({ facts }: { facts: Fact[] }) {
  const theme = useTheme(), clayBox = useClayBox();
  const stacked = useWindowDimensions().fontScale >= 1.3;
  const shown = facts.filter((fact): fact is Fact & { value: string } => !!fact.value);
  if (!shown.length) return null;
  const columns = stacked ? 1 : 2;
  return (
    <View style={[styles.facts, clayBox ? styles.clayCard : { borderColor: theme.line }]}>
      {clayBox && <ClayBoxFill kind="tile" />}
      {shown.map(({ label, value, note, extra }, index) => {
        const top = index >= columns, left = columns === 2 && index % 2 === 1;
        const full = columns === 1 || (index === shown.length - 1 && index % 2 === 0);
        return <View key={label} accessible={!extra} accessibilityLabel={extra ? undefined : [label, value, note].filter(Boolean).join(', ')}
          style={[styles.fact, { width: full ? '100%' : '50%', backgroundColor: clayBox ? 'transparent' : theme.card, borderColor: theme.line },
            !clayBox && top && styles.factTop, !clayBox && left && styles.factLeft]}>
          {/* Inset on clay, so a line never cuts through the card's raised edge. */}
          {clayBox && top && <View style={[styles.lineTop, { backgroundColor: theme.line }]} />}
          {clayBox && left && <View style={[styles.lineLeft, { backgroundColor: theme.line }]} />}
          <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
          <ThemedText style={styles.value}>{value}</ThemedText>
          {!!note && <ThemedText type="small" themeColor="textSecondary">{note}</ThemedText>}
          {extra}
        </View>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  facts: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  clayCard: { backgroundColor: 'transparent', borderColor: 'transparent', overflow: 'visible' },
  fact: { padding: Spacing.three, gap: 2 },
  factTop: { borderTopWidth: 1 },
  factLeft: { borderLeftWidth: 1 },
  lineTop: { position: 'absolute', top: 0, left: Spacing.three, right: Spacing.three, height: StyleSheet.hairlineWidth },
  lineLeft: { position: 'absolute', left: 0, top: Spacing.three, bottom: Spacing.three, width: StyleSheet.hairlineWidth },
  value: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
});
