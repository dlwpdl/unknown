import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { DragSheet } from '@/components/drag-sheet';
import { InitialAvatar, ListCard, ListLoading, ListRow } from '@/components/list-card';
import { SavedLibraryButton } from '@/components/saved-library';
import { SymbolView } from '@/components/symbol-view';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, IconSize } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMyFriends, type FriendPerson } from '@/lib/profile-friends';
import {
  acceptFolderInvite, inviteFolderMember, loadSavedItems, loadSharedFolders, removeFolderMember, setFolderPlace,
  type FolderDetail, type FolderInvite, type PlaceFolder, type SavedItem,
} from '@/lib/saved-items';
import { supabase } from '@/lib/supabase';

/** A small × that takes one thing out; the label names what it takes out. */
export function RemoveButton({ analyticsId, label, disabled = false, onPress }: { analyticsId: string; label: string; disabled?: boolean; onPress: () => void }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [ControlStyles.icon, { opacity: disabled ? 0.45 : pressed ? 0.6 : 1 }]}>
    <SymbolView name={{ ios: 'xmark.circle', android: 'cancel', web: 'cancel' }} size={IconSize.toolbar} tintColor={theme.textSecondary} accessible={false} />
  </Pressable>;
}

// In the saved list: invites waiting for an answer, then folders this member makes with a friend. Quiet when empty
// and on a failed read.
export function SharedFolders({ disabled = false }: { disabled?: boolean }) {
  const { tr } = useLanguage(), router = useRouter(), hidden = useContentVisibility(), { play } = useInteractionFeedback();
  const { isAuthed, isAuthLoading, me } = useAuth();
  const [revision, setRevision] = useState(0);
  const account = isAuthed ? me.id : '';
  const [state, setState] = useState<{ account: string; invites: FolderInvite[]; folders: PlaceFolder[] } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    if (!account || isAuthLoading) return;
    let active = true;
    void loadSharedFolders(supabase).then(value => { if (active) setState({ account, ...value }); }).catch(() => {});
    return () => { active = false; };
  // revision re-reads the list after an answer; the disable line also keeps the compiler from dropping it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, isAuthLoading, revision]));
  const current = state?.account === account ? state : null;
  const invites = (current?.invites ?? []).filter(invite => !hidden('user', invite.owner.id));
  const folders = (current?.folders ?? []).filter(folder => !hidden('user', folder.owner.id));
  const answer = async (invite: FolderInvite, accept: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (accept) await acceptFolderInvite(supabase, invite.id); else await removeFolderMember(supabase, invite.id, me.id);
      play('success'); setRevision(value => value + 1);
      if (accept) router.push({ pathname: '/profile/folder', params: { id: invite.id } });
    } catch { play('warning'); setError(tr('답하지 못했어요. 다시 시도해 주세요.')); }
    finally { setBusy(false); }
  };
  if (!invites.length && !folders.length) return null;
  return <View style={styles.section}>
    {invites.length > 0 && <>
      <ThemedText type="label" themeColor="textSecondary">{tr('받은 초대')}</ThemedText>
      <ListCard>{invites.map(invite => <View key={invite.id} style={styles.invite}>
        <ThemedText type="menu">{tr('{0}님이 「{1}」 폴더를 같이 만들자고 했어요.', invite.owner.nickname, invite.name)}</ThemedText>
        <View style={styles.actions}>
          <SavedLibraryButton analyticsId="saved.invite.accept" primary label={tr('같이 만들기')} disabled={disabled || busy} onPress={() => void answer(invite, true)} />
          <SavedLibraryButton analyticsId="saved.invite.decline" label={tr('거절')} disabled={disabled || busy} onPress={() => void answer(invite, false)} />
        </View>
      </View>)}</ListCard>
      <ThemedText type="supporting" themeColor="textSecondary">{tr('수락하면 장소를 넣고 뺄 수 있어요. 폴더 이름과 공개 범위는 초대한 친구가 정해요.')}</ThemedText>
    </>}
    {!!error && <ThemedText type="supporting" accessibilityRole="alert">{error}</ThemedText>}
    {folders.length > 0 && <>
      <ThemedText type="label" themeColor="textSecondary">{tr('같이 만드는 폴더')}</ThemedText>
      <View style={styles.actions}>{folders.map(folder => <SavedLibraryButton key={folder.id} analyticsId="saved.shared.open" label={tr('{0} · {1}님', folder.name, folder.owner.nickname)}
        disabled={disabled} onPress={() => router.push({ pathname: '/profile/folder', params: { id: folder.id } })} />)}</View>
    </>}
  </View>;
}

// The owner's card on the folder screen: who makes it together, and inviting another friend.
export function FolderMembers({ folder, onChanged }: { folder: FolderDetail; onChanged: () => void }) {
  const { tr } = useLanguage(), { play } = useInteractionFeedback(), hidden = useContentVisibility();
  const members = (folder.members ?? []).filter(member => !hidden('user', member.id));
  const [inviting, setInviting] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [friends, setFriends] = useState<FriendPerson[] | null | 'failed'>(null);
  useEffect(() => {
    if (!inviting) return;
    let active = true;
    void loadMyFriends(supabase).then(value => { if (active) setFriends(value.friends); }).catch(() => { if (active) setFriends('failed'); });
    return () => { active = false; };
  }, [inviting]);
  const act = async (work: () => Promise<unknown>, failure: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); play('success'); onChanged(); }
    catch (cause) {
      play('warning');
      setError(cause instanceof Error && cause.message.includes('FOLDER_MEMBER_LIMIT') ? tr('한 폴더에 10명까지 초대할 수 있어요.')
        : cause instanceof Error && cause.message.includes('RATE_LIMITED') ? tr('오늘은 더 초대할 수 없어요. 내일 다시 해 주세요.') : failure);
    } finally { setBusy(false); }
  };
  const choices = Array.isArray(friends) ? friends.filter(friend => !hidden('user', friend.id) && !members.some(member => member.id === friend.id)) : [];
  return <View style={styles.section}>
    <ThemedText type="smallBold">{tr('같이 만드는 친구')}</ThemedText>
    {members.length ? <ListCard>{members.map(member => <ListRow key={member.id} title={member.nickname} leading={<InitialAvatar name={member.nickname} />}
      detail={member.accepted ? tr('같이 만드는 중') : tr('수락을 기다리는 중')}
      trailing={<RemoveButton analyticsId="folder.member.remove" label={tr('{0}님 빼기', member.nickname)} disabled={busy}
        onPress={() => void act(() => removeFolderMember(supabase, folder.id, member.id), tr('빼지 못했어요. 다시 시도해 주세요.'))} />} />)}</ListCard>
      : <ThemedText type="supporting" themeColor="textSecondary">{tr('친구를 초대하면 이 폴더에 장소를 같이 모을 수 있어요. 이름과 공개 범위는 나만 바꿔요.')}</ThemedText>}
    {!!error && !inviting && <ThemedText type="supporting" accessibilityRole="alert">{error}</ThemedText>}
    <View style={styles.actions}><SavedLibraryButton analyticsId="folder.member.open" label={tr('친구 초대')} disabled={busy || members.length >= 10}
      onPress={() => { setError(''); setFriends(null); setInviting(true); }} /></View>
    <DragSheet visible={inviting} onClose={() => setInviting(false)} dismissible={!busy} title={tr('친구 초대')}>
      <View style={styles.sheet}>
        <ThemedText type="supporting" themeColor="textSecondary">{tr('친구가 수락하면 그때부터 같이 만들어요.')}</ThemedText>
        {!!error && <ThemedText type="supporting" accessibilityRole="alert">{error}</ThemedText>}
        {friends === null ? <ListLoading label={tr('친구 불러오는 중')} />
          : friends === 'failed' ? <ThemedText type="supporting">{tr('친구 목록을 불러오지 못했어요. 닫았다가 다시 열어 주세요.')}</ThemedText>
            : !choices.length ? <ThemedText type="supporting" themeColor="textSecondary">{tr('더 초대할 친구가 없어요.')}</ThemedText>
              : <ScrollView analyticsId="folder.member.scroll" style={styles.picker}><ListCard>{choices.map(friend => <ListRow key={friend.id} analyticsId="folder.member.invite" title={friend.nickname}
                leading={<InitialAvatar name={friend.nickname} />} label={tr('{0}님 초대', friend.nickname)}
                onPress={() => void act(() => inviteFolderMember(supabase, folder.id, friend.id), tr('초대하지 못했어요. 다시 시도해 주세요.'))} />)}</ListCard></ScrollView>}
      </View>
    </DragSheet>
  </View>;
}

// An editor picks one of their own saved places or businesses to put in the folder.
export function FolderAddSheet({ folder, visible, onClose, onAdded }: { folder: FolderDetail; visible: boolean; onClose: () => void; onAdded: () => void }) {
  const { tr } = useLanguage(), { play } = useInteractionFeedback();
  const [items, setItems] = useState<SavedItem[] | null | 'failed'>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    let active = true;
    void loadSavedItems(supabase, { filter: 'places' }).then(page => { if (active) setItems(page.items); }).catch(() => { if (active) setItems('failed'); });
    return () => { active = false; };
  }, [visible]);
  const inFolder = (item: SavedItem) => folder.places.some(place => item.target.kind === 'merchant' ? place.merchantId === item.target.id
    : place.placeKey === item.target.id && place.cityId === item.target.cityId);
  const choices = Array.isArray(items) ? items.filter(item => !inFolder(item)) : [];
  const add = async (item: SavedItem) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await setFolderPlace(supabase, folder.id, item.target, true); play('success'); onAdded(); onClose(); }
    catch (cause) { play('warning'); setError(cause instanceof Error && cause.message.includes('FOLDER_PLACE_LIMIT') ? tr('같이 만드는 폴더에는 300곳까지 넣을 수 있어요.') : tr('넣지 못했어요. 다시 시도해 주세요.')); }
    finally { setBusy(false); }
  };
  return <DragSheet visible={visible} onClose={onClose} dismissible={!busy} title={tr('장소 넣기')}>
    <View style={styles.sheet}>
      <ThemedText type="supporting" themeColor="textSecondary">{tr('내가 저장한 장소 중에서 골라요. 최근에 저장한 30곳이 보여요.')}</ThemedText>
      {!!error && <ThemedText type="supporting" accessibilityRole="alert">{error}</ThemedText>}
      {items === null ? <ListLoading label={tr('저장한 장소 불러오는 중')} />
        : items === 'failed' ? <ThemedText type="supporting">{tr('저장한 장소를 불러오지 못했어요. 닫았다가 다시 열어 주세요.')}</ThemedText>
          : !choices.length ? <ThemedText type="supporting" themeColor="textSecondary">{tr('더 넣을 장소가 없어요. 지도에서 장소를 저장하면 여기서 고를 수 있어요.')}</ThemedText>
            : <ScrollView analyticsId="folder.place.add.scroll" style={styles.picker}><ListCard>{choices.map(item => <ListRow key={item.key} analyticsId="folder.place.add" title={item.title}
              detail={item.address || item.subtitle || undefined} label={tr('{0} 넣기', item.title)} onPress={() => void add(item)} />)}</ListCard></ScrollView>}
    </View>
  </DragSheet>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  invite: { gap: Spacing.two, padding: Spacing.three },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sheet: { gap: Spacing.three, paddingBottom: Spacing.two },
  picker: { maxHeight: 420 },
});
