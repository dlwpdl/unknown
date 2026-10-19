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

// Top-right entry to "나" on every tab: the member's photo when signed in, the person symbol otherwise.
export function ProfileAvatarButton() {
  const { t } = useLanguage();
  const theme = useTheme();
  const router = useRouter();
  const { isAuthed, me } = useAuth();
  const { play } = useInteractionFeedback();
  if (Platform.OS === 'web') return null;
  return (
    <View style={styles.glass}>
    <Pressable analyticsId="components_profile-avatar-button.pressable.1" onPress={() => { play('selection'); router.push('/profile'); }} accessibilityRole="button" accessibilityLabel={t.tabs.profile}
      style={({ pressed }) => [styles.button, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
      {isAuthed && me.photoUri
        ? <Image source={{ uri: me.photoUri }} style={styles.avatar} contentFit="cover" accessible={false} />
        : isAuthed
          ? <View style={[styles.avatar, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{me.nickname[0]}</ThemedText></View>
          : <SymbolView name={{ ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }} size={24} tintColor={theme.text} />}
    </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  glass: { borderRadius: ControlStyles.icon.borderRadius },
  button: ControlStyles.icon,
  avatar: { width: IconSize.avatar, height: IconSize.avatar, borderRadius: IconSize.avatar / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
