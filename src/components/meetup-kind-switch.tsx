import { Pressable } from '@/components/analytics-controls';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/glass-surface';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { ChillingKind } from '@/lib/chilling';

export function MeetupKindSwitch({ value, onChange, disabled = false, analyticsId }: {
  value: ChillingKind;
  onChange: (kind: ChillingKind) => void;
  disabled?: boolean;
  analyticsId: string;
}) {
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [position] = useState(() => new Animated.Value(value === 'group' ? 1 : 0));

  useEffect(() => {
    if (reducedMotion) position.setValue(value === 'group' ? 1 : 0);
    else Animated.spring(position, { toValue: value === 'group' ? 1 : 0, damping: 16, stiffness: 260, mass: 0.8, useNativeDriver: true }).start();
  }, [position, reducedMotion, value]);

  return <GlassSurface tone="control" interactive style={styles.glass}><View accessibilityRole="tablist" onLayout={event => setWidth(event.nativeEvent.layout.width)}
    style={styles.row}>
    {width > 0 && <Animated.View pointerEvents="none" style={[styles.selection, {
      width: (width - 12) / 2,
      backgroundColor: theme.accent,
      shadowColor: '#000',
      shadowOpacity: 0.32,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, (width - 12) / 2 + 4] }) }],
    }]} />}
    {(['once', 'group'] as const).map(kind => <Pressable analyticsId={analyticsId} key={kind}
      accessibilityRole="tab" accessibilityState={{ selected: value === kind, disabled }} disabled={disabled}
      onPress={() => { play('reaction'); if (kind !== value) onChange(kind); }}
      style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.8 : 1, transform: [{ translateY: pressed ? 2 : 0 }, { scale: pressed ? 0.97 : 1 }] }]}>
      <ThemedText type="smallBold" style={{ color: value === kind ? theme.accentInk : theme.text }}>
        {kind === 'once' ? '칠링 (일회성)' : '모임 (정기모임)'}
      </ThemedText>
    </Pressable>)}
  </View></GlassSurface>;
}

const styles = StyleSheet.create({
  glass: { flex: 1, borderRadius: 12 },
  row: { flex: 1, flexDirection: 'row', padding: 4, gap: 4, borderRadius: 12 },
  selection: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 9 },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 4 },
});
