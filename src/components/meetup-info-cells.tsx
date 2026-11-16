import { StyleSheet, TextInput, View } from 'react-native';

import { FactGrid } from '@/components/fact-grid';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { meetupInfoCells } from '@/lib/meetup-ai';
import type { MeetupInfoCell } from '@/lib/meetup-info-cells';
import type { MeetupTopic } from '@/lib/meetup-topics';

/** The host's info cells, right under the fact card on a meetup. Nothing shows when the host left them empty. */
export function MeetupInfoCells({ body }: { body: string }) {
  const { tr } = useLanguage();
  const cells = meetupInfoCells(body);
  return cells.length ? <FactGrid facts={cells.map(cell => ({ label: tr(cell.label), value: tr(cell.value) }))} /> : null;
}

/** Three cells the host can fill or leave empty. Choice cells come from the topic; everything else is a short text. */
export function MeetupInfoCellsEditor({ cells, topic, onChange, disabled = false }: { cells: MeetupInfoCell[]; topic?: MeetupTopic | null; onChange: (cells: MeetupInfoCell[]) => void; disabled?: boolean }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const set = (index: number, value: string) => onChange(cells.map((cell, at) => at === index ? { ...cell, value } : cell));
  return <View style={styles.group}>
    {cells.map((cell, index) => {
      const spec = topic?.cells.find(item => item.label === cell.label);
      return <View key={cell.label} style={styles.field}>
        <ThemedText type="smallBold" style={styles.label}>{tr(cell.label)}</ThemedText>
        {spec?.options
          ? <View accessibilityRole="radiogroup" accessibilityLabel={tr(cell.label)} style={styles.chips}>{spec.options.map(option => {
            const selected = cell.value === option;
            return <SelectionChip key={option} analyticsId="meetup.create.info_cell" selected={selected} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }}
              label={tr(option)} onPress={() => { play('selection'); set(index, selected ? '' : option); }} />;
          })}</View>
          : <TextInput accessibilityLabel={tr(cell.label)} value={cell.value} onChangeText={value => set(index, value)} editable={!disabled} maxLength={80} placeholder={spec?.hint ? tr(spec.hint) : tr('비워 둘 수 있어요')} placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  group: { gap: Spacing.three }, field: { gap: Spacing.two }, label: { ...Typography.menu }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 48, padding: 12, fontSize: 16, lineHeight: 24 },
});
