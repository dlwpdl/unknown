import { StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { ClayPillFill, useClay } from '@/components/clay';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { ControlMetrics, ControlStyles, controlPresentation } from '@/constants/design-system';

type Props = {
  analyticsId: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
  tone?: 'primary' | 'secondary';
};

export function RaisedActionButton({ analyticsId, label, onPress, disabled = false, busy = false, compact = false, tone = 'primary' }: Props) {
  const theme = useTheme();
  const clay = useClay();
  const blocked = disabled || busy;

  return <View style={[styles.base, compact ? styles.compact : styles.wide, { backgroundColor: 'transparent' }]}>
    <View style={compact ? styles.compact : styles.wide}>
      <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: blocked, busy }} disabled={blocked}
        onPress={() => { if (!blocked) onPress(); }}
        style={({ pressed }) => [styles.touch, compact ? styles.compactTouch : styles.wideTouch, clay && compact && styles.compactClay, controlPresentation(theme, { tone, clay, pressed, disabled, busy }).container, tone === 'secondary' && { backgroundColor: 'transparent' }]}>
        {clay && <ClayPillFill kind={tone === 'primary' ? 'cta' : 'white'} />}
        <ThemedText type="smallBold" style={[styles.label, !compact && styles.wideLabel, { color: tone === 'primary' ? theme.accentInk : theme.text }]}>{label}</ThemedText>
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  base: { paddingBottom: 2 },
  compact: { borderRadius: ControlMetrics.radius.action },
  wide: { width: '100%', maxWidth: 596, alignSelf: 'center', borderRadius: ControlMetrics.radius.action },
  touch: {  alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  compactTouch: { ...ControlStyles.action, minHeight: ControlMetrics.touch, paddingHorizontal: 16 },
  compactClay: { paddingHorizontal: 18 },
  wideTouch: { ...ControlStyles.action, minHeight: ControlMetrics.actionWide },
  label: { textAlign: 'center' },
  wideLabel: { fontSize: 16 },
});
