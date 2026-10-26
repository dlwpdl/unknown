import { useLanguage } from '@/hooks/use-language';
import { Pressable } from '@/components/analytics-controls';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/glass-surface';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { ChillingKind } from '@/lib/chilling';
import { Typography } from '@/constants/design-system';

export function MeetupKindSwitch({ value, onChange, onAll, disabled = false, analyticsId }: {
  value?: ChillingKind | null;
  onChange: (kind: ChillingKind) => void;
  onAll?: () => void;
  disabled?: boolean;
  analyticsId: string;
}) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const choices: ('all' | ChillingKind)[] = onAll ? ['all', 'once', 'group'] : ['once', 'group'];
  const selectedIndex = onAll ? value == null ? 0 : value === 'once' ? 1 : 2 : value === 'group' ? 1 : 0;
  const [width, setWidth] = useState(0);
  const [position] = useState(() => new Animated.Value(selectedIndex));
  const tabWidth = (width - 4 * (choices.length + 1)) / choices.length;

  useEffect(() => {
    if (reducedMotion) position.setValue(selectedIndex);
    else Animated.spring(position, { toValue: selectedIndex, damping: 16, stiffness: 260, mass: 0.8, useNativeDriver: true }).start();
  }, [position, reducedMotion, selectedIndex]);

  return <GlassSurface tone="control" interactive style={styles.glass}><View accessibilityRole="tablist" onLayout={event => setWidth(event.nativeEvent.layout.width)}
    style={styles.row}>
    {width > 0 && (value != null || !!onAll) && <Animated.View pointerEvents="none" style={[styles.selection, {
      width: tabWidth,
      backgroundColor: theme.accent,
      transform: [{ translateX: position.interpolate({ inputRange: [0, choices.length - 1], outputRange: [0, (tabWidth + 4) * (choices.length - 1)] }) }],
    }]} />}
    {choices.map(kind => <Pressable lens analyticsId={analyticsId} key={kind}
      accessibilityRole="tab" accessibilityState={{ selected: kind === 'all' ? value == null : value === kind, disabled }} disabled={disabled}
      onPress={() => { play('reaction'); if (kind === 'all') onAll?.(); else if (kind !== value) onChange(kind); }}
      style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <ThemedText type="smallBold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[Typography.menu, { color: (kind === 'all' ? value == null : value === kind) ? theme.accentInk : theme.text, textAlign: 'center' }]}>
        {kind === 'all' ? tr('전체') : kind === 'once' ? tr('칠링') : tr('정기모임')}
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
