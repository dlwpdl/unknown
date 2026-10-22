import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export function AdminFilterBar({ applied, children }: { applied: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { play } = useInteractionFeedback();
  return <View style={{ gap: Spacing.two }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
      onPress={() => { play('selection'); setOpen((value) => !value); }}
      style={{ minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: Spacing.three,
        borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.card }}>
      <ThemedText type="smallBold">필터 · {applied ? `${applied}개 적용` : '전체'} {open ? '▴' : '▾'}</ThemedText>
    </Pressable>
    {open && children}
  </View>;
}
