import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// Top-right entry to "나" on every tab: the member's photo when signed in, the person symbol otherwise.
export function ProfileAvatarButton() {
  const theme = useTheme();
  const router = useRouter();
  const { isAuthed, me } = useAuth();
  const { play } = useInteractionFeedback();
  return (
    <Pressable onPress={() => { play('selection'); router.push('/profile'); }} accessibilityRole="button" accessibilityLabel={t.tabs.profile}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.65 }]}>
      {isAuthed && me.photoUri
        ? <Image source={{ uri: me.photoUri }} style={styles.avatar} contentFit="cover" accessible={false} />
        : isAuthed
          ? <View style={[styles.avatar, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{me.nickname[0]}</ThemedText></View>
          : <SymbolView name={{ ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }} size={24} tintColor={theme.text} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
