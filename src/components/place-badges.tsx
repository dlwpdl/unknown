import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TOP25_GOLD } from '@/lib/discovery';

// The map card's list marks. The place screen shows the same ones so a place looks the same in both.
export function Top50Badge({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.top50, style]}><ThemedText style={styles.top50Text}>✦ TOP 50</ThemedText></View>;
}

export function GlingVisitedBadge({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View accessible={false} style={[styles.visited, style]}>
    <Image source={require('@/assets/brand/gling-night-wordmark-light.png')} contentFit="contain" style={styles.visitedLogo} accessible={false} />
    <ThemedText style={styles.visitedText}>Visited</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  top50: { borderRadius: 5, borderWidth: 1, borderColor: '#68543A', backgroundColor: '#2A2319', paddingHorizontal: 5, paddingVertical: 2 },
  top50Text: { color: TOP25_GOLD, fontSize: 10, lineHeight: 14, fontWeight: '800' },
  visited: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#CBB9FF', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 },
  visitedLogo: { width: 35, height: 16 },
  visitedText: { color: '#171123', fontSize: 9, lineHeight: 14, fontWeight: '800', letterSpacing: 0.8 },
});
