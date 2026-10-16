import { StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  analyticsId: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
};

export function RaisedActionButton({ analyticsId, label, onPress, disabled = false, busy = false, compact = false }: Props) {
  const theme = useTheme();

  return <View style={[styles.base, compact ? styles.compact : styles.wide, { backgroundColor: 'transparent', opacity: disabled ? 0.62 : 1 }]}>
    <View style={[compact ? styles.compact : styles.wide, { backgroundColor: theme.accent }]}>
      <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [styles.touch, compact ? styles.compactTouch : styles.wideTouch, { opacity: pressed ? 0.82 : 1 }]}>
        <ThemedText type="smallBold" style={[styles.label, !compact && styles.wideLabel, { color: theme.accentInk }]}>{label}</ThemedText>
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  base: { paddingBottom: 2 },
  compact: { borderRadius: 14 },
  wide: { width: '100%', maxWidth: 596, alignSelf: 'center', borderRadius: 14 },
  touch: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  compactTouch: { minHeight: 44, paddingHorizontal: 16, borderRadius: 14 },
  wideTouch: { minHeight: 52, paddingHorizontal: 20, borderRadius: 14 },
  label: { textAlign: 'center' },
  wideLabel: { fontSize: 16 },
});
