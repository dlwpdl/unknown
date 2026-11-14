import { Stack, useRouter, type Href } from 'expo-router';
import { SymbolView } from '@/components/symbol-view';
import type { ReactNode } from 'react';

import { Pressable } from '@/components/analytics-controls';
import { ControlMotion } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// Owner 2026-11-04 "위쪽: 동그란 뒤로 + 가운데 제목": a pushed screen wears the same native bar as the profile stack
// (src/app/profile/_layout.tsx), so iOS draws the round back button and centers the title.
// backLabel/disabled: a screen whose back first closes an open item, and that can't leave mid-save.
export function PageHeader({ title, analyticsId, fallback = '/', onBack, right, backLabel, disabled = false }: {
  title: string; analyticsId: string; fallback?: Href; onBack?: () => void; right?: ReactNode; backLabel?: string; disabled?: boolean;
}) {
  const { tr } = useLanguage(), theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  return <Stack.Screen options={{
    headerShown: true, title,
    headerStyle: { backgroundColor: theme.background }, headerTintColor: theme.text, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal',
    headerLeft: () => <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={backLabel ?? tr('뒤로가기')} disabled={disabled} accessibilityState={{ disabled }}
      onPress={() => { play('selection'); if (onBack) onBack(); else if (router.canGoBack()) router.back(); else router.replace(fallback); }}
      style={({ pressed }) => ({ minWidth: 44, minHeight: 44, justifyContent: 'center', opacity: disabled ? ControlMotion.disabledOpacity : pressed ? 0.6 : 1 })}>
      <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} />
    </Pressable>,
    headerRight: right ? () => right : undefined,
  }} />;
}
