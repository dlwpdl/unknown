import { Image } from 'expo-image';
import { SymbolView } from '@/components/symbol-view';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ClayControlFill, ClayPillFill, useClay } from '@/components/clay';
import { Pressable } from '@/components/analytics-controls';
import { UberOrderNotice } from '@/components/business-webshop';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { DragSheet } from '@/components/drag-sheet';
import { MeetupManageSheet } from '@/components/meetup-manage-sheet';
import { PostZoomLink } from '@/components/post-zoom-link';
import { ThemedText } from '@/components/themed-text';
import { ControlMotion, ControlStyles, controlPresentation, IconSize } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { getCityPlaces } from '@/lib/city-places';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { SavedFolder, SavedItem } from '@/lib/saved-items';

const KIND_SYMBOL = { merchant: ['building.2', 'storefront'], place: ['mappin.and.ellipse', 'place'], post: ['doc.text', 'article'], user: ['person', 'person'] } as const;
function savedPlace(item: SavedItem) {
  if (item.target.kind !== 'place' || !item.target.cityId) return undefined;
  try { return getCityPlaces(item.target.cityId).find(place => place.id === item.target.id); } catch { return undefined; }
}

export function SavedLibraryButton({ analyticsId: id, testID, label, onPress, disabled = false, selected = false, primary = false }: {
  analyticsId: string; testID?: string; label: string; onPress: () => void; disabled?: boolean; selected?: boolean; primary?: boolean;
}) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const clay = useClay();
  return <Pressable analyticsId={id} testID={testID} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled, selected }} disabled={disabled}
    onPress={() => { play('selection'); onPress(); }}
    style={({ pressed }) => [ControlStyles.pill, styles.action, clay && styles.clayPad, controlPresentation(theme, { tone: primary ? 'primary' : 'secondary', pressed, selected, disabled, clay }).container]}>
    {clay && <ClayPillFill kind={primary || selected ? 'cta' : 'white'} />}
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
  const [menuOpen, setMenuOpen] = useState(false), place = savedPlace(item), symbol = KIND_SYMBOL[item.target.kind];
  // Owner 2026-11-04 "저장함: 사진 넣고 버튼은 ···": every card leads with a picture, and folder/unsave live behind ··· like the feed card menu.
  const thumb = place ? <CityPlacePhoto place={place} style={styles.image} />
    : item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.image} contentFit="cover" transition={ControlMotion.settleMs} accessible={false} />
      : <View style={[styles.image, styles.empty, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: symbol[0], android: symbol[1], web: symbol[1] }} size={22} tintColor={theme.textSecondary} /></View>;
  // A saved post grows out of this row (owner 2026-11-02): PostZoomLink navigates after onOpen. Object style for the link's Slot.
  const open = <Pressable analyticsId={{ merchant: 'saved.open.merchant', place: 'saved.open.place', post: 'saved.open.post', user: 'saved.open.user' }[item.target.kind]} testID={`saved.open.${item.key}`} accessibilityRole="button" accessibilityLabel={`${item.title} · ${ko ? '열기' : 'Open'}`}
      onPress={() => { play('selection'); onOpen(); }} style={styles.open}>
      {thumb}
      <View style={styles.grow}>
        <View style={styles.meta}><ThemedText type="label" themeColor="accent">{kind}</ThemedText>
          {item.closed && <ThemedText type="label" themeColor="textSecondary">{ko ? '마감' : 'Closed'}</ThemedText>}</View>
        <ThemedText type="menu" numberOfLines={3}>{item.title}</ThemedText>
        {!!item.subtitle && <ThemedText type="supporting" themeColor="textSecondary" numberOfLines={2}>{item.subtitle}</ThemedText>}
        {!!item.address && item.address !== item.subtitle && <ThemedText type="supporting" themeColor="textSecondary" numberOfLines={2}>{item.address}</ThemedText>}
        {!!names.length && <ThemedText type="supporting" themeColor="textSecondary" numberOfLines={1}>{names.join(' · ')}</ThemedText>}
      </View>
    </Pressable>;
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <View style={styles.row}>
      <View style={styles.grow}>{item.target.kind === 'post' ? <PostZoomLink id={item.target.id}>{open}</PostZoomLink> : open}</View>
      <Pressable analyticsId="saved.menu" testID={`saved.menu.${item.key}`} accessibilityRole="button" accessibilityLabel={`${item.title} · ${ko ? '메뉴' : 'Menu'}`}
        accessibilityState={{ disabled }} disabled={disabled} onPress={() => { play('selection'); setMenuOpen(true); }} style={[ControlStyles.icon, { opacity: disabled ? 0.5 : 1 }]}>
        <SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={IconSize.toolbar} tintColor={theme.textSecondary} accessible={false} />
      </Pressable>
    </View>
    {item.target.kind === 'user' && <ThemedText type="supporting" themeColor="textSecondary">{ko ? '저장해도 상대에게 알림이 가지 않아요.' : 'They won’t be notified when you save them.'}</ThemedText>}
    {menuOpen && <MeetupManageSheet visible title={item.title} onClose={() => setMenuOpen(false)} actions={[
      { key: 'organize', analyticsId: 'saved.organize', label: ko ? '폴더 정리' : 'Organize', onPress: onOrganize, icon: { ios: 'folder', android: 'folder', web: 'folder' } },
      { key: 'remove', analyticsId: 'saved.remove', label: ko ? '저장 해제' : 'Unsave', danger: true, onPress: onRemove, icon: { ios: 'bookmark.slash', android: 'bookmark_remove', web: 'bookmark_remove' } },
    ]} />}
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
  const clay = useClay();
  const [name, setName] = useState(editor.kind === 'rename' ? editor.folder.name : '');
  const [ids, setIds] = useState(editor.kind === 'item' ? editor.item.folderIds : []);
  // Closing slides the sheet down first; the parent unmounts it once DragSheet reports it is gone.
  const [open, setOpen] = useState(true);
  const invalid = !name.trim() || name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(name);
  const title = editor.kind === 'item' ? ko ? '폴더에 정리' : 'Organize in folders'
    : editor.kind === 'create' ? ko ? '새 폴더' : 'New folder' : editor.kind === 'rename' ? ko ? '폴더 관리' : 'Manage folder' : ko ? '폴더를 삭제할까요?' : 'Delete this folder?';
  // The shared sheet slides up and closes by drag, backdrop or back (owner 2026-11-02: no popping in). It plays the close feedback itself.
  return <DragSheet visible={open} onClose={() => setOpen(false)} onDismissed={onClose} dismissible={!busy}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
          <View style={styles.heading}><ThemedText type="sheetTitle" style={styles.grow}>{title}</ThemedText>
            <SavedLibraryButton analyticsId="saved.editor.close" label={ko ? '닫기' : 'Close'} onPress={() => setOpen(false)} disabled={busy} /></View>
          <ThemedText type="supporting" themeColor="textSecondary">{ko ? '폴더는 나만 볼 수 있어요. 폴더를 삭제해도 저장한 항목은 남아요.' : 'Folders are private. Deleting a folder keeps your saved items.'}</ThemedText>
          {(editor.kind === 'create' || editor.kind === 'rename') && <TextInput value={name} onChangeText={setName} maxLength={80} editable={!busy} autoFocus
            accessibilityLabel={ko ? '폴더 이름' : 'Folder name'} placeholder={ko ? '폴더 이름' : 'Folder name'} placeholderTextColor={theme.textSecondary}
            style={[ControlStyles.field, { color: theme.text, backgroundColor: theme.card, borderColor: theme.line }]}
            returnKeyType="done" onSubmitEditing={() => { if (!busy && !invalid) { play('selection'); if (editor.kind === 'create') onCreate(name.trim()); else onRename(name.trim()); } }} />}
          {editor.kind === 'delete' && <ThemedText type="menu">{editor.folder.name}</ThemedText>}
          {editor.kind === 'item' && <>
            <ThemedText type="menu">{editor.item.title}</ThemedText>
            {!folders.length && <ThemedText themeColor="textSecondary">{ko ? '폴더 없이도 저장돼요. 필요할 때 만들어 보세요.' : 'It’s saved even without a folder. Make one whenever you like.'}</ThemedText>}
            {folders.map(folder => <Pressable key={folder.id} analyticsId="saved.editor.select" testID={`saved.editor.folder.${folder.id}`} accessibilityRole="checkbox" accessibilityLabel={folder.name}
              accessibilityState={{ checked: ids.includes(folder.id), disabled: busy }} disabled={busy}
              onPress={() => { play('selection'); setIds(previous => previous.includes(folder.id) ? previous.filter(id => id !== folder.id) : [...previous, folder.id]); }}
              style={({ pressed }) => [styles.check, clay && styles.clayPad, controlPresentation(theme, { pressed, selected: ids.includes(folder.id), disabled: busy, clay }).container]}>
              <ClayControlFill selected={ids.includes(folder.id)} />
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
  </DragSheet>;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 }, card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  open: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 44 }, image: { width: 64, height: 64, borderRadius: 12 }, empty: { alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: Spacing.one },
  clayPad: { overflow: 'visible', paddingHorizontal: 18 },
  action: { borderWidth: 1, maxWidth: '100%', paddingVertical: Spacing.two },
  offer: { borderTopWidth: 1, paddingTop: Spacing.two, gap: Spacing.two },
  sheetContent: { padding: Spacing.three, gap: Spacing.three }, heading: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: Spacing.two },
  check: { minHeight: 48, borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
