import { useLanguage } from '@/hooks/use-language';
import { Pressable } from '@/components/analytics-controls';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ClayPillFill, useClay } from '@/components/clay';
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
  const choices = [...(onAll ? [{ value: 'all' as const, label: tr('전체') }] : []), { value: 'once' as const, label: tr('칠링') }, { value: 'group' as const, label: tr('정기모임') }];
  return <SegmentSwitch choices={choices} value={value ?? (onAll ? 'all' : null)} disabled={disabled} analyticsId={analyticsId}
    onSelect={kind => { if (kind === 'all') onAll?.(); else if (kind !== value) onChange(kind); }} />;
}

/** The meetup tab-style switch for any short list of choices; null value shows no selection. */
export function SegmentSwitch<T extends string>({ choices, value, onSelect, disabled = false, analyticsId, accessibilityLabel }: {
  choices: { value: T; label: string }[];
  value: T | null;
  onSelect: (value: T) => void;
  disabled?: boolean;
  analyticsId: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const clay = useClay();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const selectedIndex = Math.max(0, choices.findIndex(choice => choice.value === value));
  const [width, setWidth] = useState(0);
  const [position] = useState(() => new Animated.Value(selectedIndex));
  const tabWidth = (width - 4 * (choices.length + 1)) / choices.length;

  useEffect(() => {
    if (reducedMotion) position.setValue(selectedIndex);
    else Animated.spring(position, { toValue: selectedIndex, damping: 16, stiffness: 260, mass: 0.8, useNativeDriver: true }).start();
  }, [position, reducedMotion, selectedIndex]);

  return <GlassSurface tone="control" clay="tray" interactive style={styles.glass}><View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} onLayout={event => setWidth(event.nativeEvent.layout.width)}
    style={styles.row}>
    {width > 0 && value != null && <Animated.View pointerEvents="none" style={[styles.selection, {
      width: tabWidth,
      backgroundColor: clay ? 'transparent' : theme.accent,
      transform: [{ translateX: position.interpolate({ inputRange: [0, choices.length - 1], outputRange: [0, (tabWidth + 4) * (choices.length - 1)] }) }],
    }]}>{clay && <ClayPillFill kind="on" />}</Animated.View>}
    {choices.map(choice => <Pressable lens analyticsId={analyticsId} key={choice.value}
      accessibilityRole="tab" accessibilityState={{ selected: choice.value === value, disabled }} disabled={disabled}
      onPress={() => { play('reaction'); onSelect(choice.value); }}
      style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.8 : 1 }]}>
      <ThemedText type="smallBold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[Typography.menu, { color: choice.value === value ? theme.accentInk : theme.text, textAlign: 'center' }]}>
        {choice.label}
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
