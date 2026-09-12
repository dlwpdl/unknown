import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { trustLevelOf } from '@/lib/trust';

export function TrustBadge({ verified, trustLevel }: { verified?: boolean; trustLevel?: 2 | 3 }) {
  const theme = useTheme();
  const level = trustLevelOf({ verified, trustLevel });

  if (level === 1) return null;

  if (level === 3) {
    return (
      <Image
        accessible
        accessibilityRole="image"
        accessibilityLabel={t.trust.accessibilityLabel(level)}
        source={require('../../assets/brand/gling-app-icon.png')}
        style={styles.logo}
      />
    );
  }

  return (
    <SymbolView
      accessible
      accessibilityRole="image"
      accessibilityLabel={t.trust.accessibilityLabel(level)}
      name={{ ios: 'checkmark', android: 'check', web: 'check' }}
      size={18}
      weight="bold"
      tintColor={theme.accent}
    />
  );
}

const styles = StyleSheet.create({
  logo: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
});
