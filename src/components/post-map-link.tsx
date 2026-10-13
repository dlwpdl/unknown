import { Alert, Linking, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { googleMapsPin, googleMapsUrl } from '@/lib/post-maps';
import { PostPinMap } from '@/components/post-pin-map';

export function PostMapLink({ url, label }: { url: string; label?: string }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const target = googleMapsUrl(url);
  if (!target) return null;
  const pin = googleMapsPin(target);
  return <Pressable analyticsId="components_post-map-link.pressable.1"
    accessibilityRole="link" accessibilityLabel={`${label ? `${label} · ` : ''}${t.map.openLabel}`}
    style={({ pressed }) => [styles.link, { borderColor: theme.line, opacity: pressed ? 0.6 : 1 }]}
    onPress={() => {
      play('selection');
      void Linking.openURL(target).catch(() => { play('warning'); Alert.alert(t.map.errorTitle, t.map.errorBody); });
    }}>
    <View style={styles.row}>{pin ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.preview}><PostPinMap key={target} pin={pin} label={label} preview /></View>
      : <SymbolView name={{ ios: 'map', android: 'map', web: 'map' }} size={24} tintColor={theme.accent} />}
    <View style={styles.caption}>
    {label && <ThemedText type="smallBold" style={[styles.label, styles.name]}>{label}</ThemedText>}
    <View style={styles.action}><ThemedText type="smallBold" themeColor="accent" style={styles.label}>{t.map.open}</ThemedText>
    <SymbolView name={{ ios: 'arrow.up.right', android: 'north_east', web: 'north_east' }} size={14} tintColor={theme.accent} />
    </View>
    </View>
    </View>{pin && <ThemedText type="small" themeColor="textSecondary" style={styles.credits}>OpenFreeMap © OpenMapTiles · © OpenStreetMap</ThemedText>}
  </Pressable>;
}

const styles = StyleSheet.create({
  link: { marginTop: 12, width: '100%', flexShrink: 1, overflow: 'hidden', borderWidth: 1, borderRadius: 12 },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  caption: { flex: 1, minWidth: 0, gap: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  preview: { width: 64, height: 64, overflow: 'hidden', borderRadius: 8 },
  label: { flexShrink: 1 },
  name: { fontSize: 15, lineHeight: 21 },
  credits: { fontSize: 12, lineHeight: 18, paddingHorizontal: 12, paddingBottom: 6 },
});
