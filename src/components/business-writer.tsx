import * as ImagePicker from 'expo-image-picker';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { PostPhotoEditor, type EditablePostImage } from '@/components/post-photo-editor';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { Typography } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import type { BusinessChatIdentity } from '@/lib/chat-identity';
import { MAX_POST_IMAGES } from '@/lib/image-upload';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { saveMerchantDraftImages } from '@/lib/merchant-posts';
import { merchantEventId } from '@/lib/merchant-source';
import { approveMerchantDrafts, loadMerchantWorkspace, publishMerchantDraft } from '@/lib/merchant-workspace';
import { isSupportedImage, preparePostImage, type PreparedImage } from '@/lib/post-image-picker';
import { supabase } from '@/lib/supabase';

type Kind = 'news' | 'hire' | 'menu';
const KINDS: { key: Kind; label: string; icon: SymbolViewProps['name'] }[] = [
  { key: 'news', label: '소식·이벤트', icon: { ios: 'megaphone', android: 'campaign', web: 'campaign' } },
  { key: 'hire', label: '직원 구해요', icon: { ios: 'person.badge.plus', android: 'person_add', web: 'person_add' } },
  { key: 'menu', label: '메뉴·상품', icon: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' } },
];
const ERRORS: Record<string, string> = {
  MERCHANT_OWNER_VERIFICATION_REQUIRED: '비즈니스 소유 확인이 끝나면 글을 올릴 수 있어요.',
  MERCHANT_OPERATIONS_PAUSED: '운영이 멈춘 비즈니스는 새 글을 올릴 수 없어요.',
  MERCHANT_ACCESS_REQUIRED: '이 비즈니스로 글을 올릴 권한이 없어요.',
  CONTENT_REJECTED: '게시 기준에 맞지 않는 내용이 있어요. 글을 다시 확인해 주세요.',
  RATE_LIMITED: '요청이 많아요. 잠시 후 다시 올려 주세요.',
  IMAGE_UNSUPPORTED: 'JPEG, PNG, WebP 사진만 올릴 수 있어요.',
};

// Business posts go through the merchant draft → approve → publish path so the server stamps business authorship.
export function BusinessWriter({ business, visible, onClose, onPublished }: { business: BusinessChatIdentity; visible: boolean; onClose: () => void; onPublished: () => void }) {
  const { tr } = useLanguage(), theme = useTheme(), { me } = useAuth(), { play } = useInteractionFeedback();
  const [kind, setKind] = useState<Kind>('news');
  const [form, setForm] = useState({ title: '', body: '', wage: '', hours: '', place: '' });
  const [photos, setPhotos] = useState<EditablePostImage[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const draftId = useRef(merchantEventId());
  const hire = kind === 'hire';
  const set = (key: keyof typeof form) => (value: string) => setForm(current => ({ ...current, [key]: value }));
  const body = hire
    ? [form.wage.trim() && `시급: ${form.wage.trim()}`, form.hours.trim() && `근무: ${form.hours.trim()}`, form.place.trim() && `📍 ${form.place.trim()}`].filter(Boolean).join('\n') + (form.body.trim() ? `\n\n${form.body.trim()}` : '')
    : form.body.trim();
  const ready = !!form.title.trim() && !!body.trim() && (!hire || (!!form.wage.trim() && !!form.hours.trim()));
  const dirty = !!(form.title || form.body || form.wage || form.hours || form.place || photos.length);

  function reset() {
    setKind('news'); setForm({ title: '', body: '', wage: '', hours: '', place: '' }); setPhotos([]); setError('');
    draftId.current = merchantEventId();
  }
  function close() {
    if (busy) return;
    if (!dirty) { play('selection'); onClose(); return; }
    Alert.alert(tr('쓰던 글을 지울까요?'), tr('지금 닫으면 입력한 내용이 사라져요.'), [
      { text: tr('계속 쓰기'), style: 'cancel' },
      { text: tr('지우고 닫기'), style: 'destructive', onPress: () => { reset(); onClose(); } },
    ]);
  }
  async function pickPhotos() {
    const remaining = MAX_POST_IMAGES - photos.length;
    if (busy || remaining <= 0) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: true, orderedSelection: true, selectionLimit: remaining,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (result.canceled) return;
      const assets = (result.assets ?? []).slice(0, remaining);
      if (assets.some(asset => !asset.uri || !isSupportedImage(asset.mimeType ?? 'image/jpeg'))) throw new Error('IMAGE_UNSUPPORTED');
      const prepared: PreparedImage[] = [];
      for (const asset of assets) prepared.push(await preparePostImage(asset, { withThumb: true }));
      setPhotos(current => [...current, ...prepared].slice(0, MAX_POST_IMAGES));
    } catch (failure) { play('warning'); setError(ERRORS[failure instanceof Error ? failure.message : ''] ?? '사진을 불러오지 못했어요.'); }
  }
  async function publish() {
    const tag_slug = hire ? 'jobs' : 'business';
    const draft = { id: draftId.current, channel: 'gling' as const, title: form.title.trim(), body, original_url: null, tag_slug, kind: hire ? 'listing' as const : 'story' as const, image_paths: [] };
    setBusy(true); setError('');
    try {
      const paths = await saveMerchantDraftImages(supabase, business.id, me.id, draft, photos);
      setPhotos(current => current.map((photo, index) => ({ path: paths[index], uri: photo.uri })));
      const latest = async () => (await loadMerchantWorkspace(supabase, business.id)).drafts.find(row => row.id === draft.id);
      const saved = await latest();
      if (!saved) throw new Error('MERCHANT_DRAFT_CHANGED');
      await approveMerchantDrafts(supabase, business.id, [saved.id], true, { [saved.id]: saved.updated_at });
      const approved = await latest();
      if (!approved?.approved_at) throw new Error('MERCHANT_DRAFT_CHANGED');
      await publishMerchantDraft(supabase, business.id, approved.id, approved.updated_at);
      play('success'); reset(); onPublished(); onClose();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : '';
      // A retry after a lost response finds the draft already published: that is a success.
      if (code === 'MERCHANT_DRAFT_PUBLISHED') { play('success'); reset(); onPublished(); onClose(); return; }
      play('warning'); setError(ERRORS[code] ?? '올리지 못했어요. 쓴 내용은 그대로 있어요. 잠시 후 다시 올려 주세요.');
    } finally { setBusy(false); }
  }
  function confirm() {
    if (!ready || busy) return;
    play('selection');
    Alert.alert(tr('지금 올릴까요?'), tr('{0} 이름으로 바로 공개돼요.', business.name), [
      { text: tr('취소'), style: 'cancel' },
      { text: tr('올리기'), onPress: () => { void publish(); } },
    ]);
  }

  const input = (label: string, key: keyof typeof form, placeholder: string, multiline = false) => <View style={styles.field}>
    <ThemedText type="small" themeColor="textSecondary">{tr(label)}</ThemedText>
    <TextInput accessibilityLabel={tr(label)} value={form[key]} onChangeText={set(key)} placeholder={tr(placeholder)} placeholderTextColor={theme.textSecondary} editable={!busy}
      multiline={multiline} maxLength={multiline ? 1000 : 100} style={[styles.input, multiline && styles.multiline, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
  </View>;

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
    <SafeAreaView edges={['top', 'bottom']} style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable analyticsId="business.writer.close" accessibilityRole="button" accessibilityLabel={tr('닫기')} onPress={close} style={[styles.circle, { backgroundColor: theme.backgroundElement }]}>
          <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={16} tintColor={theme.text} />
        </Pressable>
        <ThemedText accessibilityRole="header" numberOfLines={1} style={[Typography.menu, styles.title]}>{tr('{0} 글쓰기', business.name)}</ThemedText>
        <View style={styles.circle} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <ScrollView analyticsId="business.writer.scroll" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View accessibilityRole="radiogroup" style={styles.kinds}>{KINDS.map(item => {
            const selected = kind === item.key;
            return <Pressable key={item.key} analyticsId={`business.writer.kind.${item.key}`} accessibilityRole="radio" accessibilityState={{ selected, disabled: busy }} disabled={busy}
              onPress={() => { play('selection'); setKind(item.key); }}
              style={[styles.kind, { borderColor: selected ? theme.accent : theme.line, backgroundColor: selected ? theme.backgroundSelected : theme.card }]}>
              <SymbolView name={item.icon} size={22} tintColor={selected ? theme.accent : theme.textSecondary} />
              <ThemedText type="smallBold" style={{ color: selected ? theme.accent : theme.text, textAlign: 'center' }}>{tr(item.label)}</ThemedText>
            </Pressable>;
          })}</View>
          {hire ? <>
            {input('어떤 일인가요', 'title', '예: 주말 홀 서빙')}
            <View style={styles.row}><View style={styles.half}>{input('시급', 'wage', '예: CAD 18.50')}</View><View style={styles.half}>{input('근무 시간', 'hours', '예: 토·일 11시–7시')}</View></View>
            {input('일하는 곳', 'place', '주소나 동네')}
            {input('더 알려줄 것', 'body', '필요한 경험, 쓰는 언어, 지원 방법', true)}
          </> : <>
            {input('제목', 'title', kind === 'menu' ? '예: 가을 한정 단호박 라떼' : '예: 이번 주말 1+1 이벤트')}
            {input('내용', 'body', kind === 'menu' ? '가격, 맛, 언제부터 파는지' : '언제, 무엇을, 어떻게 하는지', true)}
          </>}
          <View style={styles.photoHead}><ThemedText type="smallBold">{tr('사진')} {photos.length}/{MAX_POST_IMAGES}</ThemedText>
            {photos.length < MAX_POST_IMAGES && <Pressable analyticsId="business.writer.photos" accessibilityRole="button" accessibilityLabel={tr('사진 추가')} disabled={busy} onPress={() => { play('selection'); void pickPhotos(); }} style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">{tr('＋ 사진')}</ThemedText>
            </Pressable>}
          </View>
          {photos.length > 0 && <PostPhotoEditor images={photos} disabled={busy} onChange={setPhotos} />}
          <View style={styles.where}>
            <SymbolView name={{ ios: 'arrow.turn.down.right', android: 'subdirectory_arrow_right', web: 'subdirectory_arrow_right' }} size={14} tintColor={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>{tr(hire ? "‘구인구직’과 가게 프로필에 올라가요. 지원은 비즈니스 대화로 받아요." : "‘비즈니스’ 새 소식과 가게 프로필에 올라가요.")}</ThemedText>
          </View>
          {!!error && <ThemedText accessibilityRole="alert" type="small" style={{ color: theme.danger }}>{tr(error)}</ThemedText>}
          <RaisedActionButton analyticsId="business.writer.publish" label={tr(busy ? '올리는 중…' : '올리기')} disabled={!ready} busy={busy} onPress={confirm} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  title: { flex: 1, textAlign: 'center' },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  kinds: { flexDirection: 'row', gap: 8 },
  kind: { flex: 1, minHeight: 76, borderWidth: 1, borderRadius: 16, padding: 10, alignItems: 'center', justifyContent: 'center', gap: 6 },
  field: { gap: 6 },
  input: { minHeight: 48, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, lineHeight: 22 },
  multiline: { minHeight: 140, textAlignVertical: 'top' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  half: { flexGrow: 1, flexBasis: 140 },
  photoHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  chip: { minHeight: 44, borderRadius: 22, paddingHorizontal: 14, justifyContent: 'center' },
  where: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
