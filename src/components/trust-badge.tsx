import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

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
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t.trust.accessibilityLabel(level)}
      style={[styles.badge, { backgroundColor: theme.card, borderColor: theme.accent }]}>
      <View style={[styles.gap, { backgroundColor: theme.card }]} />
      <View style={[styles.dot, { backgroundColor: theme.textSecondary }]} />
      <Text style={[styles.label, { color: theme.accent }]}>L2</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  badge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2.25,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  gap: {
    position: 'absolute',
    width: 7,
    height: 5,
    right: -2,
    top: -1,
    transform: [{ rotate: '35deg' }],
  },
  dot: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    right: -1,
    top: -1,
  },
  label: {
    fontSize: 7.5,
    lineHeight: 9,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
});
