import { useLanguage } from '@/hooks/use-language';
import { Pressable } from '@/components/analytics-controls';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { ControlStyles, IconSize, controlPresentation } from '@/constants/design-system';
import { ChatIdentitySwitcher } from '@/components/chat-identity-switcher';
import { useChatIdentity } from '@/hooks/use-chat-identity';

// Top-right entry to "나" on every tab: the member's photo when signed in, the person symbol otherwise.
export function ProfileAvatarButton({ enableBusinessSwitch = true, onBusinessSwitchAvailabilityChange }: { enableBusinessSwitch?: boolean; onBusinessSwitchAvailabilityChange?: (available: boolean) => void }) {
  const { t, tr } = useLanguage();
  const theme = useTheme();
  const router = useRouter();
  const { isAuthed, me } = useAuth();
  const { play } = useInteractionFeedback();
  const business = useChatIdentity();
  if (Platform.OS === 'web') return null;
  return (
    <View style={styles.row}>{business ? <Pressable analyticsId="components_profile-avatar-button.pressable.1" onPress={() => { play('selection'); router.push('/profile'); }} accessibilityRole="button" accessibilityLabel={tr('{0} 이름으로 쓰는 중', business.name)} accessibilityHint={t.tabs.profile}
      style={({ pressed }) => [styles.business, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}>
      <SymbolView name={{ ios: 'storefront', android: 'storefront', web: 'storefront' }} size={16} tintColor={theme.accent} />
      <ThemedText type="smallBold" numberOfLines={1} style={styles.businessName}>{business.name}</ThemedText>
    </Pressable> : <View style={styles.glass}>
    <Pressable analyticsId="components_profile-avatar-button.pressable.1" onPress={() => { play('selection'); router.push('/profile'); }} accessibilityRole="button" accessibilityLabel={t.tabs.profile}
      style={({ pressed }) => [styles.button, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
      {isAuthed && me.photoUri
        ? <Image source={{ uri: me.photoUri }} style={styles.avatar} contentFit="cover" accessible={false} />
        : isAuthed
          ? <View style={[styles.avatar, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{me.nickname[0]}</ThemedText></View>
          : <SymbolView name={{ ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }} size={24} tintColor={theme.text} />}
    </Pressable>
    </View>}{enableBusinessSwitch && <ChatIdentitySwitcher target="business" onAvailabilityChange={onBusinessSwitchAvailabilityChange} />}</View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  glass: { borderRadius: ControlStyles.icon.borderRadius },
  button: ControlStyles.icon,
  business: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, maxWidth: 150, borderRadius: 18, paddingHorizontal: 12 },
  businessName: { flexShrink: 1 },
  avatar: { width: IconSize.avatar, height: IconSize.avatar, borderRadius: IconSize.avatar / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
