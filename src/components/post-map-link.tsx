import { Alert, Linking, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { googleMapsUrl } from '@/lib/post-maps';

export function PostMapLink({ url }: { url: string }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const target = googleMapsUrl(url);
  if (!target) return null;
  return <Pressable analyticsId="components_post-map-link.pressable.1"
    accessibilityRole="link" accessibilityLabel={t.map.openLabel}
    style={({ pressed }) => [styles.link, { borderColor: theme.line, opacity: pressed ? 0.6 : 1 }]}
    onPress={() => {
      play('selection');
      void Linking.openURL(target).catch(() => { play('warning'); Alert.alert(t.map.errorTitle, t.map.errorBody); });
    }}>
    <SymbolView name={{ ios: 'map', android: 'map', web: 'map' }} size={18} tintColor={theme.accent} />
    <ThemedText type="smallBold" themeColor="accent" style={styles.label}>{t.map.open}</ThemedText>
    <SymbolView name={{ ios: 'arrow.up.right', android: 'north_east', web: 'north_east' }} size={14} tintColor={theme.accent} />
  </Pressable>;
}

const styles = StyleSheet.create({
  link: { marginTop: 12, minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderRadius: 12 },
  label: { flexShrink: 1 },
});
