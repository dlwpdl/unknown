import { Alert, Platform, StyleSheet, View } from 'react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { ThemedText, type ThemedTextProps } from '@/components/themed-text';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { PostAttachmentLink } from '@/components/post-attachment-link';
import { instagramPostLink, splitPostAttachments, splitPostLinks } from '../../supabase/functions/_shared/post-links';

export function PostBody({ body, linksEnabled = true, ...props }: Omit<ThemedTextProps, 'children'> & { body: string; linksEnabled?: boolean }) {
  const { play } = useInteractionFeedback();
  const attached = splitPostAttachments(body);
  return <View><ThemedText {...props}>{splitPostLinks(attached.body).map((part, index) => !part.url || !linksEnabled ? part.text
    : Platform.OS === 'web'
      ? <a key={index} href={part.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
          style={{ color: 'inherit', textDecoration: 'underline', overflowWrap: 'anywhere' }}
          onClick={event => {
            event.stopPropagation(); play('selection');
            if (!instagramPostLink(part.url!) && !window.confirm(`${part.url}\n\n악성 여부를 아직 확인하지 못한 외부 링크예요. 이동할까요?`)) event.preventDefault();
          }}>{part.text}</a>
      : <ThemedText key={index} themeColor="accent" style={styles.link} accessibilityRole="link"
          accessibilityLabel={`${part.text} 외부 페이지 열기`} onPress={event => {
            event.stopPropagation(); play('selection');
            const open = () => { void openBrowserAsync(part.url!).catch(() => { play('warning'); Alert.alert('링크를 열지 못했어요.', '잠시 후 다시 눌러주세요.'); }); };
            if (instagramPostLink(part.url!)) open();
            else Alert.alert('외부 링크 열기', `${part.url}\n\n악성 여부를 아직 확인하지 못했어요.`, [
              { text: '취소', style: 'cancel', onPress: () => play('selection') },
              { text: '이동', onPress: () => { play('selection'); open(); } },
            ]);
          }}>{part.text}</ThemedText>)}</ThemedText>
    {attached.urls.map((url, index) => <PostAttachmentLink key={`${url}-${index}`} url={url} enabled={linksEnabled} />)}
  </View>;
}
const styles = StyleSheet.create({ link: { textDecorationLine: 'underline' } });
