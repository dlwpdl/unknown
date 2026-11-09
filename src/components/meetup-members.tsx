import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Share, StyleSheet, View } from 'react-native';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { DragSheet } from '@/components/drag-sheet';
import { GlingLoader } from '@/components/gling-loader';
import { InitialAvatar, ListCard, ListRow, Tag } from '@/components/list-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { SymbolView } from '@/components/symbol-view';
import { ThemedText } from '@/components/themed-text';
import { IconSize, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { getChillingError, getMeetupInviteToken, inviteMeetupFriends, loadMeetupPublicRoster, type MeetupRosterPerson } from '@/lib/chilling-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMyFriends, type FriendPerson } from '@/lib/profile-friends';
import { meetupInviteMessage } from '@/lib/sharing';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

// Shown inline before the rest moves to a sheet; most meetups stay under this.
const INLINE_PEOPLE = 8;

/** '누가 와요' for a public meetup (20261108120000). null: this viewer may not see it, so nothing is shown. */
export function useMeetupRoster(postId: string, enabled: boolean) {
  const [roster, setRoster] = useState<MeetupRosterPerson[] | null | undefined>(undefined), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void loadMeetupPublicRoster(supabase, postId).then(value => { if (active) { setRoster(value); setError(''); } }, e => { if (active) { setRoster(undefined); setError(getChillingError(e)); } });
    return () => { active = false; };
  }, [enabled, postId, retry]);
  const reload = useCallback(() => { setError(''); setRetry(value => value + 1); }, []);
  return { roster: enabled ? roster : null, error: enabled ? error : '', reload };
}

function Person({ person }: { person: MeetupRosterPerson }) {
  const { tr } = useLanguage();
  const name = person.displayName || tr(person.isHost ? '호스트' : '모임 멤버');
  return <View accessible accessibilityLabel={[name, person.isHost ? tr('호스트') : '', person.intro, person.interests.join(', ')].filter(Boolean).join(', ')} style={styles.person}>
    <InitialAvatar name={name} />
    <View style={styles.personText}>
      <View style={styles.nameRow}>
        <ThemedText style={[Typography.label, styles.shrink]}>{name}</ThemedText>
        {person.isHost && <Tag label={tr('호스트')} />}
      </View>
      {!!person.intro && <ThemedText style={Typography.supporting} themeColor="textSecondary">{person.intro}</ThemedText>}
      {person.interests.length > 0 && <View style={styles.interests}>{person.interests.map(interest => <Tag key={interest} label={interest} tone="quiet" />)}</View>}
    </View>
  </View>;
}

export function MeetupWhoSheet({ people, visible, onClose }: { people: MeetupRosterPerson[]; visible: boolean; onClose: () => void }) {
  const { tr } = useLanguage();
  return <DragSheet visible={visible} onClose={onClose} title={tr('누가 와요')}>
    {/* shortcut: a plain list; a meetup near the 5,000-person cap would want a virtualized one. */}
    <ScrollView analyticsId="meetup.who.sheet" contentContainerStyle={styles.sheet}>
      <ListCard>{people.map(person => <Person key={person.userId} person={person} />)}</ListCard>
      <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr('확정된 멤버만 보여요. 사진은 빼고 이름과 소개만 나와요.')}</ThemedText>
    </ScrollView>
  </DragSheet>;
}

/** Host and approved members, without photos, area or answers. */
export function MeetupWhoCard({ roster, error, onRetry }: { roster: MeetupRosterPerson[] | null | undefined; error: string; onRetry: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [all, setAll] = useState(false);
  if (roster === null) return null;
  return <View style={styles.who}>
    <View style={styles.whoHead}>
      <ThemedText accessibilityRole="header" style={[Typography.menu, styles.shrink]}>{tr('누가 와요')}</ThemedText>
      {!!roster && <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr('호스트 포함 {0}명', roster.length)}</ThemedText>}
    </View>
    {error ? <View style={styles.retry}>
      <ThemedText style={[Typography.supporting, styles.shrink]} themeColor="textSecondary" accessibilityRole="alert">{tr(error)}</ThemedText>
      <Pressable analyticsId="meetup.who.retry" accessibilityRole="button" onPress={() => { play('selection'); onRetry(); }} style={styles.retryButton}>
        <ThemedText type="smallBold" themeColor="accent">{tr('다시 불러오기')}</ThemedText>
      </Pressable>
    </View> : !roster ? <GlingLoader color={theme.accent} accessibilityLabel={tr('멤버 불러오는 중')} /> : <>
      <ListCard>
        {roster.slice(0, INLINE_PEOPLE).map(person => <Person key={person.userId} person={person} />)}
        {roster.length > INLINE_PEOPLE && <ListRow analyticsId="meetup.who.all" title={tr('{0}명 모두 보기', roster.length)} onPress={() => setAll(true)} />}
      </ListCard>
      {roster.length === 1 && <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr('아직 호스트 혼자예요.')}</ThemedText>}
      <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr('확정된 멤버만 보여요. 사진은 빼고 이름과 소개만 나와요.')}</ThemedText>
      {roster.length > INLINE_PEOPLE && <MeetupWhoSheet people={roster} visible={all} onClose={() => setAll(false)} />}
    </>}
  </View>;
}

/** Members and outsiders of an invite meetup: one line instead of the member list. */
export function MeetupInviteNote() {
  const { tr } = useLanguage();
  const theme = useTheme();
  return <View style={styles.who}>
    <View style={[styles.lock, { backgroundColor: theme.backgroundElement }]}>
      <SymbolView name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }} size={IconSize.inline} tintColor={theme.textSecondary} />
      <ThemedText style={[Typography.supporting, styles.shrink]}>{tr('초대받은 사람만 들어오는 모임이라 멤버는 안 보여요.')}</ThemedText>
    </View>
    <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr('링크를 받은 사람만 볼 수 있는 모임이에요.')}</ThemedText>
  </View>;
}

/** The host's invite tools: send the link, invite app friends, or replace the link. */
export function MeetupInviteHost({ post }: { post: Post }) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [busy, setBusy] = useState(false), [picking, setPicking] = useState(false);
  const share = async (renew: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const token = await getMeetupInviteToken(supabase, post.id, renew);
      if (renew) play('success');
      await Share.share({ message: meetupInviteMessage(post.title, token) });
    } catch (e) { play('warning'); Alert.alert(tr('초대 링크를 만들지 못했어요'), getChillingError(e)); }
    finally { setBusy(false); }
  };
  // ListRow plays its own selection feedback.
  const renew = () => {
    const title = tr('새 링크를 만들까요?'), body = tr('지금 링크는 바로 막혀요. 그 링크로 들어왔지만 아직 신청하지 않은 사람은 새 링크를 받아야 해요.');
    if (Platform.OS === 'web') { if (globalThis.confirm(`${title}\n${body}`)) void share(true); return; }
    Alert.alert(title, body, [{ text: tr('취소'), style: 'cancel' }, { text: tr('새 링크 만들기'), onPress: () => void share(true) }]);
  };
  return <View style={[styles.inviteCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText accessibilityRole="header" style={Typography.label} themeColor="accent">{tr('초대용 모임')}</ThemedText>
    <RaisedActionButton analyticsId="meetup.invite.share" tone="secondary" busy={busy} label={tr('초대 링크 보내기')} onPress={() => { play('selection'); void share(false); }} />
    <RaisedActionButton analyticsId="meetup.invite.friends" tone="secondary" disabled={busy} label={tr('앱 친구 초대하기')} onPress={() => { play('selection'); setPicking(true); }} />
    <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr('링크를 받은 사람은 누구나 신청할 수 있어요. 새 링크를 만들면 예전 링크는 바로 막혀요.')}</ThemedText>
    <View style={[styles.renew, { borderTopColor: theme.line }]}>
      <ListRow analyticsId="meetup.invite.renew" title={tr('새 링크 만들기')} onPress={renew} />
    </View>
    <FriendInviteSheet postId={post.id} visible={picking} onClose={() => setPicking(false)} />
  </View>;
}

function FriendInviteSheet({ postId, visible, onClose }: { postId: string; visible: boolean; onClose: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [friends, setFriends] = useState<FriendPerson[] | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [picked, setPicked] = useState<string[]>([]), [sending, setSending] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    void loadMyFriends(supabase).then(value => { if (active) { setFriends(value.friends); setError(''); } }, e => { if (active) setError(getChillingError(e)); });
    return () => { active = false; };
  }, [visible, retry]);
  // A reopened sheet starts with nobody picked.
  const close = () => { setPicked([]); onClose(); };
  const send = async () => {
    if (sending || !picked.length) return;
    setSending(true);
    try {
      const sent = await inviteMeetupFriends(supabase, postId, picked);
      play('success');
      close();
      Alert.alert(tr('초대를 보냈어요'), sent < picked.length ? tr('이미 초대했거나 신청한 친구에게는 다시 보내지 않았어요.') : undefined);
    } catch (e) { play('warning'); Alert.alert(tr('초대를 보내지 못했어요'), getChillingError(e)); }
    finally { setSending(false); }
  };
  return <DragSheet visible={visible} onClose={close} dismissible={!sending} title={tr('앱 친구 초대')}>
    <ScrollView analyticsId="meetup.invite.friends.sheet" contentContainerStyle={styles.sheet}>
      {error ? <View style={styles.retry}>
        <ThemedText style={[Typography.supporting, styles.shrink]} themeColor="textSecondary" accessibilityRole="alert">{tr(error)}</ThemedText>
        <Pressable analyticsId="meetup.invite.friends.retry" accessibilityRole="button" onPress={() => { play('selection'); setError(''); setRetry(value => value + 1); }} style={styles.retryButton}>
          <ThemedText type="smallBold" themeColor="accent">{tr('다시 불러오기')}</ThemedText>
        </Pressable>
      </View> : !friends ? <GlingLoader color={theme.accent} accessibilityLabel={tr('친구 불러오는 중')} />
        : !friends.length ? <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr('초대할 친구가 아직 없어요. 서로 친구가 되면 여기에 보여요.')}</ThemedText>
          : <ListCard>{friends.map(friend => {
            const on = picked.includes(friend.id);
            return <Pressable key={friend.id} analyticsId="meetup.invite.friends.pick" accessibilityRole="checkbox" accessibilityLabel={friend.nickname} accessibilityState={{ checked: on, disabled: sending }} disabled={sending}
              onPress={() => { play('selection'); setPicked(current => on ? current.filter(id => id !== friend.id) : [...current, friend.id]); }}
              style={({ pressed }) => [styles.person, styles.pick, pressed && { backgroundColor: theme.backgroundSelected }]}>
              <InitialAvatar name={friend.nickname} />
              <ThemedText style={[Typography.body, styles.personText]}>{friend.nickname}</ThemedText>
              <SymbolView name={on ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' } : { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' }} size={IconSize.toolbar} tintColor={on ? theme.accent : theme.textSecondary} />
            </Pressable>;
          })}</ListCard>}
      {!!friends?.length && <RaisedActionButton analyticsId="meetup.invite.friends.send" busy={sending} disabled={!picked.length} label={picked.length ? tr('{0}명에게 초대 보내기', picked.length) : tr('친구를 골라 주세요')} onPress={() => { play('selection'); void send(); }} />}
    </ScrollView>
  </DragSheet>;
}

const styles = StyleSheet.create({
  who: { gap: Spacing.two },
  whoHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: Spacing.two },
  person: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + Spacing.half },
  pick: { alignItems: 'center', minHeight: 56 },
  personText: { flex: 1, minWidth: 0, gap: Spacing.half },
  nameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one },
  interests: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.half },
  shrink: { flexShrink: 1 },
  retry: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.two },
  retryButton: { minHeight: 44, justifyContent: 'center' },
  lock: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12, padding: Spacing.three },
  inviteCard: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two, overflow: 'hidden' },
  renew: { borderTopWidth: StyleSheet.hairlineWidth, marginHorizontal: -Spacing.three, marginBottom: -Spacing.three },
  sheet: { gap: Spacing.three, paddingBottom: Spacing.two },
});
