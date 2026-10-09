import { useEffect, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { useReducedMotion } from 'react-native-reanimated';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { PostAttachmentLink } from '@/components/post-attachment-link';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { instagramPostLink, postLinkChecks, safePostLink, splitPostAttachments, withPostAttachments } from '../../supabase/functions/_shared/post-links';

export function PostBodyEditor({ value = '', onChangeText, editable = true, maxLength = 4000, onFocus, ...props }: TextInputProps) {
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [stage, setStage] = useState<'choices' | 'sns' | 'instagram' | 'url' | null>(null);
  const [input, setInput] = useState('');
  const inputRef = useRef<TextInput>(null);
  const attached = splitPostAttachments(value);
  const candidate = stage === 'instagram' ? instagramPostLink(input)?.url : stage === 'url' ? safePostLink(input) : null;
  const duplicate = !!candidate && attached.urls.some(url => (instagramPostLink(url)?.url ?? url) === candidate);
  const next = candidate ? withPostAttachments(value, [...attached.urls, candidate]) : null;
  const error = input.trim() && !candidate ? stage === 'instagram' ? 'Instagram 프로필 주소를 확인해 주세요.' : 'HTTPS 주소를 확인해 주세요.'
    : duplicate ? '이미 첨부한 링크예요.' : next && next.length > maxLength ? '본문과 첨부 링크가 너무 길어요.' : '';
  const checks = postLinkChecks(attached.body);
  const blocked = checks.filter(item => item.verdict === 'blocked').length;
  const close = () => { play('selection'); setStage(null); setInput(''); };
  const choose = (nextStage: typeof stage) => { play('selection'); setInput(''); setStage(nextStage); };
  useEffect(() => {
    if (stage !== 'url' && stage !== 'instagram') return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [stage]);
  return <>
    <TextInput {...props} value={attached.body} editable={editable}
      maxLength={Math.max(0, maxLength - (value.length - attached.body.length))}
      onFocus={event => { play('selection'); onFocus?.(event); }}
      onChangeText={text => {
        const pasted = splitPostAttachments(text);
        onChangeText?.(withPostAttachments(pasted.body, [...attached.urls, ...pasted.urls]));
      }} />
    <View style={styles.attachments}>
      <Pressable analyticsId="post.attachment.add" accessibilityRole="button" accessibilityLabel="링크 첨부" disabled={!editable}
        onPress={() => { Keyboard.dismiss(); choose('choices'); }} style={[styles.attachButton, { borderColor: theme.line, opacity: editable ? 1 : 0.5 }]}>
        <SymbolView name={{ ios: 'paperclip', android: 'attach_file', web: 'attach_file' }} size={18} tintColor={theme.text} />
        <ThemedText type="smallBold">첨부</ThemedText>
      </Pressable>
      {attached.urls.map((url, index) => <View key={`${url}-${index}`} style={styles.row}>
        <PostAttachmentLink url={url} />
        <Pressable analyticsId="post.attachment.remove" accessibilityRole="button" accessibilityLabel={`${instagramPostLink(url)?.handle ?? url} 첨부 삭제`} disabled={!editable}
          onPress={() => { play('selection'); onChangeText?.(withPostAttachments(value, attached.urls.filter((_, position) => position !== index))); }} style={styles.iconButton}>
          <ThemedText themeColor="textSecondary">×</ThemedText>
        </Pressable>
      </View>)}
      {blocked > 0 && <ThemedText type="small" accessibilityRole="alert">활성화할 수 없는 본문 링크 {blocked}개가 있어요. 주소를 확인해 주세요.</ThemedText>}
      {checks.length > blocked && <ThemedText type="small" themeColor="textSecondary">본문 외부 링크의 악성 여부는 아직 확인하지 못했어요.</ThemedText>}
    </View>
    <Modal visible={stage !== null && editable} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <Pressable analyticsId="post.attachment.backdrop" accessibilityRole="button" accessibilityLabel="첨부 취소" onPress={close} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={styles.header}>
            {stage === 'choices' ? <View style={styles.iconButton} /> : <Pressable analyticsId="post.attachment.back" accessibilityRole="button" accessibilityLabel="이전 단계"
              onPress={() => choose(stage === 'instagram' ? 'sns' : 'choices')} style={styles.iconButton}><ThemedText>‹</ThemedText></Pressable>}
            <ThemedText type="smallBold">{stage === 'instagram' ? 'Instagram 프로필' : stage === 'url' ? 'URL 링크' : stage === 'sns' ? 'SNS' : '첨부'}</ThemedText>
            <Pressable analyticsId="post.attachment.close" accessibilityRole="button" accessibilityLabel="첨부 창 닫기" onPress={close} style={styles.iconButton}><ThemedText>×</ThemedText></Pressable>
          </View>
          <ScrollView analyticsId="post.attachment.sheet" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {stage === 'choices' && <>
              <Pressable analyticsId="post.attachment.url" accessibilityRole="button" accessibilityLabel="URL 링크" onPress={() => choose('url')} style={styles.choice}><ThemedText>URL 링크</ThemedText><ThemedText themeColor="textSecondary">›</ThemedText></Pressable>
              <Pressable analyticsId="post.attachment.sns" accessibilityRole="button" accessibilityLabel="SNS" onPress={() => choose('sns')} style={styles.choice}><ThemedText>SNS</ThemedText><ThemedText themeColor="textSecondary">›</ThemedText></Pressable>
            </>}
            {stage === 'sns' && <Pressable analyticsId="post.attachment.instagram" accessibilityRole="button" accessibilityLabel="Instagram" onPress={() => choose('instagram')} style={styles.choice}><ThemedText>Instagram</ThemedText><ThemedText themeColor="textSecondary">›</ThemedText></Pressable>}
            {(stage === 'url' || stage === 'instagram') && <>
              <ThemedText type="small" themeColor="textSecondary">{stage === 'instagram' ? 'Instagram 프로필 주소를 넣어주세요.' : '첨부할 HTTPS 주소를 넣어주세요.'}</ThemedText>
              <TextInput ref={inputRef} value={input} onChangeText={setInput} onFocus={() => play('selection')}
                accessibilityLabel={stage === 'instagram' ? 'Instagram 프로필 URL' : '첨부할 URL'}
                placeholder={stage === 'instagram' ? 'https://www.instagram.com/아이디/' : 'https://example.com/'} placeholderTextColor={theme.textSecondary}
                keyboardType="url" autoCapitalize="none" autoCorrect={false} maxLength={2048}
                style={[styles.urlInput, { color: theme.text, borderColor: theme.line }]} />
              {!!candidate && <PostAttachmentLink url={candidate} />}
              {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
              <Pressable analyticsId="post.attachment.confirm" accessibilityRole="button" disabled={!next || !!error}
                onPress={() => { if (!next || error) return; play('selection'); onChangeText?.(next); setStage(null); setInput(''); }}
                style={[styles.confirm, { backgroundColor: theme.accent, opacity: !next || error ? 0.5 : 1 }]}>
                <ThemedText type="smallBold" style={{ color: theme.accentInk }}>첨부하기</ThemedText>
              </Pressable>
            </>}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  attachments: { gap: 8, marginVertical: 12 },
  attachButton: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
  iconButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '85%', alignSelf: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 8 },
  content: { paddingHorizontal: 20, gap: 12 },
  choice: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  urlInput: { minHeight: 48, padding: 12, borderWidth: 1, borderRadius: 12 },
  confirm: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
});
