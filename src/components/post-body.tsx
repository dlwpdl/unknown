import { useLanguage } from '@/hooks/use-language';
import { Alert, Clipboard, Linking, Platform, StyleSheet, View } from 'react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { ThemedText, type ThemedTextProps } from '@/components/themed-text';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { PostAttachmentLink } from '@/components/post-attachment-link';
import { localizeBusinessDisclosure } from '@/lib/translation-source';
import { splitKakaoIds } from '@/lib/kakao-id';
import { instagramPostLink, splitPostAttachments, splitPostLinks } from '../../supabase/functions/_shared/post-links';

// A 카톡 id has no official link that opens a chat: copy it, say where to paste it, then open the app on request.
// The notice comes first so it is read before 카톡 takes the screen. No canOpenURL on purpose (iOS would need an Info.plist entry and a native build).
export function openKakaoId(id: string, tr: (text: string) => string, play: (kind: 'selection' | 'warning') => void) {
  try { Clipboard.setString(id); } catch { /* the notice below still names the id */ }
  const title = tr('카톡 아이디를 복사했어요'), message = tr('카톡 앱에서 친구 추가 → ID로 추가에 붙여 넣어 주세요.');
  if (Platform.OS === 'web') { window.alert(`${title}\n${message}`); return; }
  Alert.alert(title, message, [
    { text: tr('닫기'), style: 'cancel', onPress: () => play('selection') },
    { text: tr('카톡 열기'), onPress: () => { play('selection'); void Linking.openURL('kakaotalk://').catch(() => { play('warning'); Alert.alert(tr('이 기기에서 카톡을 열지 못했어요.')); }); } },
  ]);
}

// `paragraphs` renders pre-split lines with breathing room; the caller then shows attachments itself.
// `lead` starts the same text run in bold (the Today feed's title), so a line limit covers both.
export function PostBody({ body, paragraphs, lead, linksEnabled = true, ...props }: Omit<ThemedTextProps, 'children'> & { body: string; paragraphs?: string[]; lead?: string; linksEnabled?: boolean }) {
  const { tr } = useLanguage();
  const { play } = useInteractionFeedback();
  const attached = splitPostAttachments(body);
  const kakao = (text: string, key: number) => splitKakaoIds(text).map((piece, index) => !piece.kakaoId || !linksEnabled ? piece.text
    : <ThemedText key={`${key}-${index}`} themeColor="accent" style={styles.link} accessibilityRole="link"
        accessibilityLabel={tr('카톡 아이디 {0} 복사', piece.kakaoId)} onPress={event => { event.stopPropagation(); play('selection'); openKakaoId(piece.kakaoId!, tr, play); }}>{piece.text}</ThemedText>);
  const linked = (text: string) => splitPostLinks(text).map((part, index) => !part.url || !linksEnabled ? kakao(part.text, index)
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
  if (paragraphs) return <View style={styles.paragraphs}>{paragraphs.map((text, index) => <ThemedText key={index} selectable={linksEnabled} {...props}>{linked(text)}</ThemedText>)}</View>;
  // Long-press copy only where the text is not a tap target (feed cards open the post instead).
  return <View><ThemedText selectable={linksEnabled} {...props}>{!!lead && <ThemedText style={styles.lead}>{`${lead} `}</ThemedText>}{linked(localizeBusinessDisclosure(attached.body, tr))}</ThemedText>
    {attached.urls.map((url, index) => <PostAttachmentLink key={`${url}-${index}`} url={url} enabled={linksEnabled} />)}
  </View>;
}
const styles = StyleSheet.create({ link: { textDecorationLine: 'underline' }, lead: { fontWeight: '700' }, paragraphs: { gap: 12 } });
