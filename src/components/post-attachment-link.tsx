import { useLanguage } from '@/hooks/use-language';
import { Image } from 'expo-image';
import { openBrowserAsync } from 'expo-web-browser';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { postLinkLabel } from '@/lib/post-info';
import { SymbolView } from 'expo-symbols';
import { INSTAGRAM_LINK_SVG, instagramPostLink, safePostLink } from '../../supabase/functions/_shared/post-links';

// `row` is the post-detail info card form: short name, kind, and the same safety confirm.
export function PostAttachmentLink({ url: input, enabled = true, row = false }: { url: string; enabled?: boolean; row?: boolean }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const safe = safePostLink(input);
  if (!safe) return null;
  const profile = instagramPostLink(safe);
  const url = profile?.url ?? safe;
  const label = profile ? `@${profile.handle}` : url;
  const accessibilityLabel = tr("{0} · {1} 외부 페이지 열기", label, new URL(url).hostname);
  const content = row ? <>
    <View style={[styles.rowIcon, { backgroundColor: theme.backgroundElement }]}>
      {profile ? <Image source={{ uri: `data:image/svg+xml,${encodeURIComponent(INSTAGRAM_LINK_SVG.replaceAll('currentColor', theme.accent))}` }} style={styles.icon} accessibilityLabel="Instagram" />
        : <SymbolView name={{ ios: 'link', android: 'link', web: 'link' }} size={16} tintColor={theme.accent} />}
    </View>
    <View style={styles.rowText}>
      <ThemedText type="smallBold" numberOfLines={1}>{postLinkLabel(url)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{profile ? tr("인스타그램") : tr("웹사이트 · 악성 여부 미확인")}</ThemedText>
    </View>
    <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={13} tintColor={theme.textSecondary} />
  </> : <>
    {profile && <Image source={{ uri: `data:image/svg+xml,${encodeURIComponent(INSTAGRAM_LINK_SVG.replaceAll('currentColor', theme.accent))}` }} style={styles.icon} accessibilityLabel="Instagram" />}
    <ThemedText themeColor="accent" numberOfLines={profile ? 1 : 2} style={styles.label}>{label}</ThemedText>
  </>;
  const open = () => {
    void openBrowserAsync(url).catch(() => { play('warning'); Alert.alert(tr("링크를 열지 못했어요."), tr("잠시 후 다시 눌러주세요.")); });
  };
  const linkStyle = row ? styles.row : styles.link;
  return <View style={row ? undefined : styles.container}>
    {!enabled ? <View style={linkStyle}>{content}</View> : Platform.OS === 'web'
      ? <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={accessibilityLabel}
          style={{ display: 'flex', alignItems: 'center', gap: row ? 12 : 7, minHeight: row ? 56 : 44, minWidth: 44, maxWidth: '100%', color: row ? theme.text : theme.accent, textDecoration: 'none' }}
          onClick={event => {
            event.stopPropagation(); play('selection');
            if (!profile && !window.confirm(tr("{0}\n\n악성 여부를 아직 확인하지 못한 외부 링크예요. 이동할까요?", url))) event.preventDefault();
          }}>{content}</a>
      : <Pressable analyticsId="post.attachment.open" accessibilityRole="link" accessibilityLabel={accessibilityLabel} style={linkStyle}
          onPress={event => {
            event.stopPropagation(); play('selection');
            if (profile) open();
            else Alert.alert(tr("외부 링크 열기"), tr("{0}\n\n악성 여부를 아직 확인하지 못했어요.", (url)), [
              { text: tr("취소"), style: 'cancel', onPress: () => play('selection') },
              { text: tr("이동"), onPress: () => { play('selection'); open(); } },
            ]);
          }}>{content}</Pressable>}
    {!profile && !row && <ThemedText type="small" themeColor="textSecondary">{tr("악성 여부 미확인")}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  container: { alignSelf: 'flex-start', maxWidth: '100%', flexShrink: 1 },
  link: { minWidth: 44, minHeight: 44, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 7 },
  icon: { width: 18, height: 18, flexShrink: 0 },
  label: { fontSize: 14, fontWeight: '500', flexShrink: 1 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: 1 },
});
