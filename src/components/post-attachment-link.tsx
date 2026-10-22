import { Image } from 'expo-image';
import { openBrowserAsync } from 'expo-web-browser';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { INSTAGRAM_LINK_SVG, instagramPostLink, safePostLink } from '../../supabase/functions/_shared/post-links';

export function PostAttachmentLink({ url: input, enabled = true }: { url: string; enabled?: boolean }) {
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const safe = safePostLink(input);
  if (!safe) return null;
  const profile = instagramPostLink(safe);
  const url = profile?.url ?? safe;
  const label = profile ? `@${profile.handle}` : url;
  const accessibilityLabel = `${label} · ${new URL(url).hostname} 외부 페이지 열기`;
  const content = <>
    {profile && <Image source={{ uri: `data:image/svg+xml,${encodeURIComponent(INSTAGRAM_LINK_SVG.replaceAll('currentColor', theme.accent))}` }} style={styles.icon} accessibilityLabel="Instagram" />}
    <ThemedText themeColor="accent" numberOfLines={profile ? 1 : 2} style={styles.label}>{label}</ThemedText>
  </>;
  const open = () => {
    void openBrowserAsync(url).catch(() => { play('warning'); Alert.alert('링크를 열지 못했어요.', '잠시 후 다시 눌러주세요.'); });
  };
  return <View style={styles.container}>
    {!enabled ? <View style={styles.link}>{content}</View> : Platform.OS === 'web'
      ? <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={accessibilityLabel}
          style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 44, minWidth: 44, maxWidth: '100%', color: theme.accent, textDecoration: 'none' }}
          onClick={event => {
            event.stopPropagation(); play('selection');
            if (!profile && !window.confirm(`${url}\n\n악성 여부를 아직 확인하지 못한 외부 링크예요. 이동할까요?`)) event.preventDefault();
          }}>{content}</a>
      : <Pressable analyticsId="post.attachment.open" accessibilityRole="link" accessibilityLabel={accessibilityLabel} style={styles.link}
          onPress={event => {
            event.stopPropagation(); play('selection');
            if (profile) open();
            else Alert.alert('외부 링크 열기', `${url}\n\n악성 여부를 아직 확인하지 못했어요.`, [
              { text: '취소', style: 'cancel', onPress: () => play('selection') },
              { text: '이동', onPress: () => { play('selection'); open(); } },
            ]);
          }}>{content}</Pressable>}
    {!profile && <ThemedText type="small" themeColor="textSecondary">악성 여부 미확인</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  container: { alignSelf: 'flex-start', maxWidth: '100%', flexShrink: 1 },
  link: { minWidth: 44, minHeight: 44, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 7 },
  icon: { width: 18, height: 18, flexShrink: 0 },
  label: { fontSize: 14, fontWeight: '500', flexShrink: 1 },
});
