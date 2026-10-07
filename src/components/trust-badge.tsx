import { SymbolView } from 'expo-symbols';

import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { trustLevelOf } from '@/lib/trust';

export function TrustBadge({ verified, trustLevel }: { verified?: boolean; trustLevel?: 2 | 3 }) {
  const theme = useTheme();
  const level = trustLevelOf({ verified, trustLevel });

  if (level === 1) return null;

  return (
    <SymbolView
      accessible
      accessibilityRole="image"
      accessibilityLabel={t.trust.accessibilityLabel(level)}
      name={level === 3 ? { ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' } : { ios: 'checkmark', android: 'check', web: 'check' }}
      size={18}
      weight="bold"
      tintColor={theme.accent}
    />
  );
}
