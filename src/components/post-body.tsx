import { useLanguage } from '@/hooks/use-language';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { ThemedText, type ThemedTextProps } from '@/components/themed-text';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { PostAttachmentLink } from '@/components/post-attachment-link';
import { localizeBusinessDisclosure } from '@/lib/translation-source';
import { instagramPostLink, splitPostAttachments, splitPostLinks } from '../../supabase/functions/_shared/post-links';

// `paragraphs` renders pre-split lines with breathing room; the caller then shows attachments itself.
export function PostBody({ body, paragraphs, linksEnabled = true, ...props }: Omit<ThemedTextProps, 'children'> & { body: string; paragraphs?: string[]; linksEnabled?: boolean }) {
  const { tr } = useLanguage();
  const { play } = useInteractionFeedback();
  const attached = splitPostAttachments(body);
  const linked = (text: string) => splitPostLinks(text).map((part, index) => !part.url || !linksEnabled ? part.text
    : Platform.OS === 'web'
      ? <a key={index} href={part.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
          style={{ color: 'inherit', textDecoration: 'underline', overflowWrap: 'anywhere' }}
          onClick={event => {
            event.stopPropagation(); play('selection');
            if (!instagramPostLink(part.url!) && !window.confirm(tr('{0}\n\n악성 여부를 아직 확인하지 못한 외부 링크예요. 이동할까요?', part.url))) event.preventDefault();
          }}>{part.text}</a>
      : <ThemedText key={index} themeColor="accent" style={styles.link} accessibilityRole="link"
          accessibilityLabel={tr("{0} 외부 페이지 열기", (part.text))} onPress={event => {
            event.stopPropagation(); play('selection');
            const open = () => { void openBrowserAsync(part.url!).catch(() => { play('warning'); Alert.alert(tr("링크를 열지 못했어요."), tr("잠시 후 다시 눌러주세요.")); }); };
            if (instagramPostLink(part.url!)) open();
            else Alert.alert(tr("외부 링크 열기"), tr("{0}\n\n악성 여부를 아직 확인하지 못했어요.", (part.url)), [
              { text: tr("취소"), style: 'cancel', onPress: () => play('selection') },
              { text: tr('이동하기'), onPress: () => { play('selection'); open(); } },
            ]);
          }}>{part.text}</ThemedText>);
  if (paragraphs) return <View style={styles.paragraphs}>{paragraphs.map((text, index) => <ThemedText key={index} {...props}>{linked(text)}</ThemedText>)}</View>;
  return <View><ThemedText {...props}>{linked(localizeBusinessDisclosure(attached.body, tr))}</ThemedText>
    {attached.urls.map((url, index) => <PostAttachmentLink key={`${url}-${index}`} url={url} enabled={linksEnabled} />)}
  </View>;
}
const styles = StyleSheet.create({ link: { textDecorationLine: 'underline' }, paragraphs: { gap: 12 } });
