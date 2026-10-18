import { useLanguage } from '@/hooks/use-language';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SymbolView } from 'expo-symbols';
import { useReducedMotion } from 'react-native-reanimated';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { PostAttachmentLink } from '@/components/post-attachment-link';
import { PostMapLink } from '@/components/post-map-link';
import { PostLocationPicker } from '@/components/post-location-picker';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { googleMapsPin, googlePinUrl, postMapBody, withPostMap } from '@/lib/post-maps';
import { instagramPostLink, postLinkChecks, safePostLink, splitPostAttachments, withPostAttachments } from '../../supabase/functions/_shared/post-links';

export function PostBodyEditor({ value = '', onChangeText, editable = true, maxLength = 4000, onFocus, cityName = '', allowLocation = true, renderLayout, ...props }: TextInputProps & { cityName?: string; allowLocation?: boolean; renderLayout?: (parts: { input: ReactNode; actions: ReactNode; attachments: ReactNode }) => ReactNode }) {
  const { tr, t } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [stage, setStage] = useState<'choices' | 'sns' | 'instagram' | 'url' | 'location' | null>(null);
  const [input, setInput] = useState('');
  const inputRef = useRef<TextInput>(null);
  const mapped = postMapBody(value);
  const initialPin = useMemo(() => googleMapsPin(mapped.url ?? ''), [mapped.url]);
  const attached = splitPostAttachments(mapped.body);
  const bodyLimit = mapped.url ? Math.min(maxLength, 4000) : maxLength;
  const candidate = stage === 'instagram' ? instagramPostLink(input)?.url : stage === 'url' ? safePostLink(input) : null;
  const duplicate = !!candidate && attached.urls.some(url => (instagramPostLink(url)?.url ?? url) === candidate);
  let next: string | null = null;
  let tooLong = false;
  try { if (candidate) next = withPostAttachments(value, [...attached.urls, candidate]); }
  catch { tooLong = true; }
  const error = input.trim() && !candidate ? stage === 'instagram' ? 'Instagram 프로필 주소를 확인해 주세요.' : 'HTTPS 주소를 확인해 주세요.'
    : duplicate ? '이미 첨부한 링크예요.' : tooLong || (next && [...next].length > maxLength) ? '본문과 첨부 정보가 너무 길어요.' : '';
  const checks = postLinkChecks(attached.body);
  const blocked = checks.filter(item => item.verdict === 'blocked').length;
  const close = () => { play('selection'); setStage(null); setInput(''); };
  const choose = (nextStage: typeof stage) => { play('selection'); setInput(''); setStage(nextStage); };
  useEffect(() => {
    if (stage !== 'url' && stage !== 'instagram') return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [stage]);
  const field = <TextInput {...props} value={attached.body} editable={editable}
      maxLength={Math.max(0, bodyLimit - (value.length - attached.body.length))}
      onFocus={event => { play('selection'); onFocus?.(event); }}
      onChangeText={text => {
        const pasted = splitPostAttachments(text);
        const changed = withPostAttachments(pasted.body, [...attached.urls, ...pasted.urls]);
        onChangeText?.(mapped.url ? withPostMap(changed, mapped.url, mapped.label) : changed);
      }} />;
  const actions = <View style={renderLayout ? styles.toolbarActions : styles.actions}>
      <Pressable analyticsId="post.attachment.add" accessibilityRole="button" accessibilityLabel={tr("링크 첨부")} disabled={!editable}
        onPress={() => { Keyboard.dismiss(); choose('choices'); }} style={[renderLayout ? styles.toolbarButton : styles.attachButton, { borderColor: theme.line, opacity: editable ? 1 : 0.5 }]}>
        <SymbolView name={{ ios: 'paperclip', android: 'attach_file', web: 'attach_file' }} size={18} tintColor={theme.text} />
        <ThemedText type="smallBold" style={renderLayout && styles.toolbarLabel}>{tr(renderLayout ? "링크" : "첨부")}</ThemedText>
      </Pressable>
      {allowLocation && <Pressable analyticsId="post.location.add" accessibilityRole="button" accessibilityLabel={mapped.url ? t.write.placeChange : t.write.placeAdd} disabled={!editable}
        onPress={() => { Keyboard.dismiss(); choose('location'); }} style={[renderLayout ? styles.toolbarButton : styles.attachButton, { borderColor: theme.line, opacity: editable ? 1 : 0.5 }]}>
        <SymbolView name={{ ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' }} size={18} tintColor={theme.accent} />
        <ThemedText type="smallBold" style={renderLayout && styles.toolbarLabel}>{renderLayout ? tr("장소") : mapped.url ? t.write.placeChange : t.write.placeAdd}</ThemedText>
      </Pressable>}
      </View>;
  const attachments = <>
      {mapped.url && <View style={styles.row}>
        <PostMapLink url={mapped.url} label={mapped.label} />
        {allowLocation && <Pressable analyticsId="post.location.remove" accessibilityRole="button" accessibilityLabel={t.write.placeRemove} disabled={!editable}
          onPress={() => { play('selection'); onChangeText?.(mapped.body); }} style={styles.iconButton}>
          <ThemedText themeColor="textSecondary">×</ThemedText>
        </Pressable>}
      </View>}
      {attached.urls.map((url, index) => <View key={`${url}-${index}`} style={styles.row}>
        <PostAttachmentLink url={url} />
        <Pressable analyticsId="post.attachment.remove" accessibilityRole="button" accessibilityLabel={tr("{0} 첨부 삭제", (instagramPostLink(url)?.handle ?? url))} disabled={!editable}
          onPress={() => { play('selection'); onChangeText?.(withPostAttachments(value, attached.urls.filter((_, position) => position !== index))); }} style={styles.iconButton}>
          <ThemedText themeColor="textSecondary">×</ThemedText>
        </Pressable>
      </View>)}
      {blocked > 0 && <ThemedText type="small" accessibilityRole="alert">{tr("활성화할 수 없는 본문 링크") + " "}{blocked}{tr("개가 있어요. 주소를 확인해 주세요.")}</ThemedText>}
      {checks.length > blocked && <ThemedText type="small" themeColor="textSecondary">{tr("본문 외부 링크의 악성 여부는 아직 확인하지 못했어요.")}</ThemedText>}
    </>;
  return <>
    {renderLayout ? renderLayout({ input: field, actions, attachments: mapped.url || attached.urls.length > 0 || checks.length > 0 ? <View style={styles.attachments}>{attachments}</View> : null }) : <>{field}<View style={styles.attachments}>{actions}{attachments}</View></>}
    {stage === 'location' && editable && <PostLocationPicker visible initialPin={initialPin} initialLabel={mapped.label} cityName={cityName} onClose={close}
      onConfirm={(pin, label) => {
        try {
          const changed = withPostMap(value, googlePinUrl(pin), label);
          if ([...changed].length > maxLength) throw new Error('POST_BODY_TOO_LONG');
          play('success'); onChangeText?.(changed); setStage(null); setInput('');
        } catch { play('warning'); Alert.alert(t.write.validationTitle, t.write.bodyTooLong); }
      }} />}
    <Modal visible={stage !== null && editable && stage !== 'location'} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <Pressable analyticsId="post.attachment.backdrop" accessibilityRole="button" accessibilityLabel={tr("첨부 취소")} onPress={close} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={styles.header}>
            {stage === 'choices' ? <View style={styles.iconButton} /> : <Pressable analyticsId="post.attachment.back" accessibilityRole="button" accessibilityLabel={tr("이전 단계")}
              onPress={() => choose(stage === 'instagram' ? 'sns' : 'choices')} style={styles.iconButton}><ThemedText>‹</ThemedText></Pressable>}
            <ThemedText type="smallBold">{stage === 'instagram' ? tr("Instagram 프로필") : stage === 'url' ? tr("URL 링크") : stage === 'sns' ? 'SNS' : tr("첨부")}</ThemedText>
            <Pressable analyticsId="post.attachment.close" accessibilityRole="button" accessibilityLabel={tr("첨부 창 닫기")} onPress={close} style={styles.iconButton}><ThemedText>×</ThemedText></Pressable>
          </View>
          <ScrollView analyticsId="post.attachment.sheet" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {stage === 'choices' && <>
              <Pressable analyticsId="post.attachment.url" accessibilityRole="button" accessibilityLabel={tr("URL 링크")} onPress={() => choose('url')} style={styles.choice}><ThemedText>{tr("URL 링크")}</ThemedText><ThemedText themeColor="textSecondary">›</ThemedText></Pressable>
              <Pressable analyticsId="post.attachment.sns" accessibilityRole="button" accessibilityLabel="SNS" onPress={() => choose('sns')} style={styles.choice}><ThemedText>SNS</ThemedText><ThemedText themeColor="textSecondary">›</ThemedText></Pressable>
            </>}
            {stage === 'sns' && <Pressable analyticsId="post.attachment.instagram" accessibilityRole="button" accessibilityLabel="Instagram" onPress={() => choose('instagram')} style={styles.choice}><ThemedText>Instagram</ThemedText><ThemedText themeColor="textSecondary">›</ThemedText></Pressable>}
            {(stage === 'url' || stage === 'instagram') && <>
              <ThemedText type="small" themeColor="textSecondary">{stage === 'instagram' ? tr("Instagram 프로필 주소를 넣어주세요.") : tr("첨부할 HTTPS 주소를 넣어주세요.")}</ThemedText>
              <TextInput ref={inputRef} value={input} onChangeText={setInput} onFocus={() => play('selection')}
                accessibilityLabel={stage === 'instagram' ? tr("Instagram 프로필 URL") : tr("첨부할 URL")}
                placeholder={stage === 'instagram' ? tr("https://www.instagram.com/아이디/") : 'https://example.com/'} placeholderTextColor={theme.textSecondary}
                keyboardType="url" autoCapitalize="none" autoCorrect={false} maxLength={2048}
                style={[styles.urlInput, { color: theme.text, borderColor: theme.line }]} />
              {!!candidate && <PostAttachmentLink url={candidate} />}
              {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
              <Pressable analyticsId="post.attachment.confirm" accessibilityRole="button" disabled={!next || !!error}
                onPress={() => { if (!next || error) return; play('selection'); onChangeText?.(next); setStage(null); setInput(''); }}
                style={[styles.confirm, { backgroundColor: theme.accent, opacity: !next || error ? 0.5 : 1 }]}>
                <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr("첨부하기")}</ThemedText>
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toolbarActions: { flex: 2, flexDirection: 'row', gap: 8 },
  toolbarButton: { flex: 1, minWidth: 0, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 4 },
  toolbarLabel: { fontSize: 11, lineHeight: 16 },
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
