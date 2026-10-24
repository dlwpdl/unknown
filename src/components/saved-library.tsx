import { Image } from 'expo-image';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable } from '@/components/analytics-controls';
import { UberOrderNotice } from '@/components/business-webshop';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, controlPresentation } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { SavedFolder, SavedItem } from '@/lib/saved-items';

export function SavedLibraryButton({ analyticsId: id, testID, label, onPress, disabled = false, selected = false, primary = false }: {
  analyticsId: string; testID?: string; label: string; onPress: () => void; disabled?: boolean; selected?: boolean; primary?: boolean;
}) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <Pressable analyticsId={id} testID={testID} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled, selected }} disabled={disabled}
    onPress={() => { play('selection'); onPress(); }}
    style={({ pressed }) => [ControlStyles.pill, styles.action, controlPresentation(theme, { tone: primary ? 'primary' : 'secondary', pressed, selected, disabled }).container]}>
    <ThemedText type="label" style={controlPresentation(theme, { tone: primary ? 'primary' : 'secondary', selected }).text}>{label}</ThemedText>
  </Pressable>;
}

export function SavedItemCard({ item, folders, disabled = false, compareBusy = false, onOpen, onRemove, onOrganize, onCompare }: {
  item: SavedItem; folders: SavedFolder[]; disabled?: boolean; compareBusy?: boolean;
  onOpen: () => void; onRemove: () => void; onOrganize: () => void; onCompare?: () => void;
}) {
  const theme = useTheme(), { language } = useLanguage(), { play } = useInteractionFeedback(), ko = language === 'ko';
  const kind = item.target.kind === 'merchant' ? ko ? '비즈니스' : 'Business'
    : item.target.kind === 'place' ? ko ? '장소' : 'Place' : item.target.kind === 'user' ? ko ? '사람' : 'Person'
      : item.postType === 'job' ? ko ? '채용' : 'Job' : item.postType === 'meetup' ? ko ? '모임' : 'Meetup' : ko ? '글' : 'Post';
  const names = folders.filter(folder => item.folderIds.includes(folder.id)).map(folder => folder.name);
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <Pressable analyticsId={{ merchant: 'saved.open.merchant', place: 'saved.open.place', post: 'saved.open.post', user: 'saved.open.user' }[item.target.kind]} testID={`saved.open.${item.key}`} accessibilityRole="button" accessibilityLabel={`${item.title} · ${ko ? '열기' : 'Open'}`}
      onPress={() => { play('selection'); onOpen(); }} style={({ pressed }) => [styles.open, { opacity: pressed ? 0.82 : 1 }]}>
      {!!item.imageUrl && <Image source={{ uri: item.imageUrl }} style={styles.image} contentFit="cover" accessible={false} />}
      <View style={styles.grow}>
        <View style={styles.meta}><ThemedText type="label" themeColor="accent">{kind}</ThemedText>
          {item.closed && <ThemedText type="label" themeColor="textSecondary">{ko ? '마감' : 'Closed'}</ThemedText>}</View>
        <ThemedText type="menu" numberOfLines={3}>{item.title}</ThemedText>
        {!!item.subtitle && <ThemedText type="supporting" themeColor="textSecondary" numberOfLines={2}>{item.subtitle}</ThemedText>}
        {!!item.address && item.address !== item.subtitle && <ThemedText type="supporting" themeColor="textSecondary" numberOfLines={2}>{item.address}</ThemedText>}
      </View>
    </Pressable>
    {item.target.kind === 'user' && <ThemedText type="supporting" themeColor="textSecondary">{ko ? '저장해도 상대에게 알림이 가지 않아요.' : 'Saving someone does not notify them.'}</ThemedText>}
    {!!names.length && <ThemedText type="supporting" themeColor="textSecondary">{names.join(' · ')}</ThemedText>}
    <View style={styles.actions}>
      <SavedLibraryButton analyticsId="saved.organize" testID={`saved.organize.${item.key}`} label={ko ? '폴더 정리' : 'Organize'} onPress={onOrganize} disabled={disabled} />
      <SavedLibraryButton analyticsId="saved.remove" testID={`saved.remove.${item.key}`} label={ko ? '저장 해제' : 'Unsave'} onPress={onRemove} disabled={disabled} />
    </View>
    {item.hasWebshop && onCompare && <View style={[styles.offer, { borderTopColor: theme.line }]}>
      <SavedLibraryButton analyticsId="saved.compare" testID={`saved.compare.${item.key}`} label={compareBusy ? ko ? '현재 가격 확인 중…' : 'Checking current prices…' : ko ? '웹샵 가격 비교' : 'Compare webshop prices'} onPress={onCompare} disabled={disabled || compareBusy} primary />
      <UberOrderNotice />
    </View>}
  </View>;
}

export type SavedFolderEditor = { kind: 'create'; returnItem?: SavedItem }
  | { kind: 'rename' | 'delete'; folder: SavedFolder }
  | { kind: 'item'; item: SavedItem };

export function SavedFolderSheet({ editor, folders, busy, error, onClose, onCreate, onRename, onDelete, onAssign, onCreateForItem, onRequestDelete }: {
  editor: SavedFolderEditor; folders: SavedFolder[]; busy: boolean; error: string | null;
  onClose: () => void; onCreate: (name: string) => void; onRename: (name: string) => void; onDelete: () => void;
  onAssign: (ids: string[]) => void; onCreateForItem: (ids: string[]) => void; onRequestDelete: () => void;
}) {
  const theme = useTheme(), { language } = useLanguage(), { play } = useInteractionFeedback(), ko = language === 'ko';
  const [name, setName] = useState(editor.kind === 'rename' ? editor.folder.name : '');
  const [ids, setIds] = useState(editor.kind === 'item' ? editor.item.folderIds : []);
  const invalid = !name.trim() || name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(name);
  const title = editor.kind === 'item' ? ko ? '폴더에 정리' : 'Organize in folders'
    : editor.kind === 'create' ? ko ? '새 폴더' : 'New folder' : editor.kind === 'rename' ? ko ? '폴더 관리' : 'Manage folder' : ko ? '폴더를 삭제할까요?' : 'Delete this folder?';
  const close = () => { if (!busy) { play('selection'); onClose(); } };
  return <Modal transparent visible animationType="none" onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
      <Pressable analyticsId="saved.editor.backdrop" accessibilityRole="button" accessibilityLabel={ko ? '닫기' : 'Close'} onPress={close} disabled={busy} style={StyleSheet.absoluteFill} />
      <SafeAreaView edges={['bottom']} accessibilityViewIsModal onAccessibilityEscape={close} style={[styles.sheet, { backgroundColor: theme.background }]}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
          <View style={styles.heading}><ThemedText type="sheetTitle" style={styles.grow}>{title}</ThemedText>
            <SavedLibraryButton analyticsId="saved.editor.close" label={ko ? '닫기' : 'Close'} onPress={onClose} disabled={busy} /></View>
          <ThemedText type="supporting" themeColor="textSecondary">{ko ? '폴더는 나만 볼 수 있어요. 폴더를 삭제해도 저장한 항목은 남아요.' : 'Folders are private. Deleting a folder keeps your saved items.'}</ThemedText>
          {(editor.kind === 'create' || editor.kind === 'rename') && <TextInput value={name} onChangeText={setName} maxLength={80} editable={!busy} autoFocus
            accessibilityLabel={ko ? '폴더 이름' : 'Folder name'} placeholder={ko ? '폴더 이름' : 'Folder name'} placeholderTextColor={theme.textSecondary}
            style={[ControlStyles.field, { color: theme.text, backgroundColor: theme.card, borderColor: theme.line }]}
            returnKeyType="done" onSubmitEditing={() => { if (!busy && !invalid) { play('selection'); if (editor.kind === 'create') onCreate(name.trim()); else onRename(name.trim()); } }} />}
          {editor.kind === 'delete' && <ThemedText type="menu">{editor.folder.name}</ThemedText>}
          {editor.kind === 'item' && <>
            <ThemedText type="menu">{editor.item.title}</ThemedText>
            {!folders.length && <ThemedText themeColor="textSecondary">{ko ? '폴더 없이도 저장돼요. 필요할 때 만들어 보세요.' : 'Your item is saved without a folder. Create one whenever you need it.'}</ThemedText>}
            {folders.map(folder => <Pressable key={folder.id} analyticsId="saved.editor.select" testID={`saved.editor.folder.${folder.id}`} accessibilityRole="checkbox" accessibilityLabel={folder.name}
              accessibilityState={{ checked: ids.includes(folder.id), disabled: busy }} disabled={busy}
              onPress={() => { play('selection'); setIds(previous => previous.includes(folder.id) ? previous.filter(id => id !== folder.id) : [...previous, folder.id]); }}
              style={({ pressed }) => [styles.check, controlPresentation(theme, { pressed, selected: ids.includes(folder.id), disabled: busy }).container]}>
              <ThemedText style={[styles.grow, controlPresentation(theme, { selected: ids.includes(folder.id) }).text]}>{folder.name}</ThemedText>
              <ThemedText accessible={false} style={controlPresentation(theme, { selected: ids.includes(folder.id) }).text}>{ids.includes(folder.id) ? '✓' : '○'}</ThemedText>
            </Pressable>)}
            <SavedLibraryButton analyticsId="saved.editor.new" label={ko ? '새 폴더 만들기' : 'Create a folder'} disabled={busy} onPress={() => onCreateForItem(ids)} />
          </>}
          {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
          <SavedLibraryButton analyticsId="saved.editor.submit" primary disabled={busy || ((editor.kind === 'create' || editor.kind === 'rename') && invalid)}
            label={busy ? ko ? '저장 중…' : 'Saving…' : editor.kind === 'delete' ? ko ? '폴더 삭제' : 'Delete folder' : ko ? '완료' : 'Done'}
            onPress={() => { if (editor.kind === 'item') onAssign(ids); else if (editor.kind === 'create') onCreate(name.trim()); else if (editor.kind === 'rename') onRename(name.trim()); else onDelete(); }} />
          {editor.kind === 'rename' && <SavedLibraryButton analyticsId="saved.editor.delete" label={ko ? '폴더 삭제' : 'Delete folder'} disabled={busy} onPress={onRequestDelete} />}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 }, card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  open: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, minHeight: 44 }, image: { width: 56, height: 56, borderRadius: 12 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: Spacing.one },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }, action: { borderWidth: 1, maxWidth: '100%', paddingVertical: Spacing.two },
  offer: { borderTopWidth: 1, paddingTop: Spacing.two, gap: Spacing.two },
  backdrop: { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 600, alignSelf: 'center', maxHeight: '90%', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  sheetContent: { padding: Spacing.three, gap: Spacing.three }, heading: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: Spacing.two },
  check: { minHeight: 48, borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
