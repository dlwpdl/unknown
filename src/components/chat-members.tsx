import { useLanguage } from '@/hooks/use-language';
import { Pressable, FlatList } from '@/components/analytics-controls';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Modal, Platform, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ChatMemberAvatar } from '@/components/chat-member-avatar';
import { MeetupBadgeChips, useMeetupBadges } from '@/components/meetup-loyalty';
import { IconSize } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { loadChatMembers, type ChatMember } from '@/lib/chat-details';
import { loadMeetupHistoryAccess, removeMeetupMember, setMeetupHistoryAccess } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

export function ChatMembers({ conversationId, groupPostId, currentUserId, onMembersChange, onOpenProfile }: { conversationId: string; groupPostId: string; currentUserId: string; onMembersChange?: (members: ChatMember[] | null) => void; onOpenProfile?: (id: string) => void }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { play } = useInteractionFeedback();
  const hidden = useContentVisibility();
  const scope = JSON.stringify([currentUserId, conversationId, groupPostId]);
  // history is loaded only for the host: which approved members may read messages from before they joined.
  const [snapshot, setSnapshot] = useState<{ scope: string; rows: ChatMember[] | null; history?: Map<string, boolean> | null }>({ scope: '', rows: null });
  const members = snapshot.scope === scope ? snapshot.rows : null;
  const history = snapshot.scope === scope ? snapshot.history ?? null : null;
  const isHost = !!members?.some(member => member.is_host && member.id === currentUserId);
  const [managing, setManaging] = useState<{ scope: string; id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewable, setViewable] = useState<{ scope: string; ids: Set<string> }>({ scope: '', ids: new Set() });
  const [viewability] = useState(() => ({ itemVisiblePercentThreshold: 1 }));
  const trackVisibleMembers = useCallback(({ viewableItems }: { viewableItems: { item: ChatMember; isViewable: boolean }[] }) => {
    const ids = new Set(viewableItems.filter(item => item.isViewable).map(item => item.item.id));
    setViewable(previous => previous.scope === scope && previous.ids.size === ids.size && [...ids].every(id => previous.ids.has(id))
      ? previous : { scope, ids });
  }, [scope]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++request.current;
    try {
      const rows = await loadChatMembers(supabase, groupPostId);
      const history = rows.some(member => member.is_host && member.id === currentUserId)
        ? await loadMeetupHistoryAccess(supabase, groupPostId).catch(() => null) : null;
      if (generation === request.current) { setSnapshot({ scope, rows, history }); onMembersChange?.(rows); setFailed(false); }
    } catch {
      if (generation === request.current) { setSnapshot({ scope, rows: null }); onMembersChange?.(null); setFailed(true); }
    }
  }, [currentUserId, groupPostId, onMembersChange, scope]);
  useEffect(() => {
    let active = true;
    const reload = () => { if (active) void refresh(); };
    void Promise.resolve().then(reload);
    const channel = supabase.channel(`members:${currentUserId}:${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetup_requests', filter: `post_id=eq.${groupPostId}` }, reload).subscribe();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') reload(); });
    const pendingRequest = request;
    return () => { active = false; pendingRequest.current++; subscription.remove(); void supabase.removeChannel(channel); };
  }, [conversationId, currentUserId, groupPostId, refresh]);
  const visible = members?.filter((member) => !hidden('user', member.id, member.id));
  const badges = useMeetupBadges(open && visible ? visible.map(member => member.id) : null);
  const managed = isHost && managing?.scope === scope ? visible?.find(member => member.id === managing.id && !member.is_host) : undefined;
  const shared = managed ? history?.get(managed.id) : undefined;
  const toggleHistory = async (member: ChatMember, share: boolean) => {
    if (saving) return;
    setSaving(true); setActionError(null);
    try { await setMeetupHistoryAccess(supabase, groupPostId, member.id, share); play('success'); await refresh(); }
    catch { play('warning'); setActionError(tr("변경하지 못했어요. 잠시 후 다시 시도해 주세요.")); }
    finally { setSaving(false); }
  };
  const remove = async (member: ChatMember) => {
    setSaving(true); setActionError(null);
    try { await removeMeetupMember(supabase, groupPostId, member.id); play('success'); setManaging(null); await refresh(); }
    catch { play('warning'); setActionError(tr("내보내지 못했어요. 잠시 후 다시 시도해 주세요.")); }
    finally { setSaving(false); }
  };
  const confirmRemove = (member: ChatMember) => {
    if (saving) return;
    play('selection');
    const title = tr("{0}님을 모임에서 내보낼까요?", member.nickname);
    const message = tr("이 대화방을 더 이상 볼 수 없게 돼요. 24시간이 지나면 다시 참여 신청할 수 있어요.");
    if (Platform.OS === 'web') { if (globalThis.confirm(`${title}\n${message}`)) void remove(member); return; }
    Alert.alert(title, message, [{ text: tr("돌아가기"), style: 'cancel' }, { text: tr("내보내기"), style: 'destructive', onPress: () => void remove(member) }]);
  };
  return <>
    <Pressable analyticsId="components_chat-members.pressable.1" accessibilityRole="button" accessibilityLabel={tr("대화 멤버 목록")} onPress={() => { play('selection'); setManaging(null); setActionError(null); setOpen(true); void refresh(); }} style={[styles.button, styles.roster]}>
      <View style={styles.portraits}>
        {visible?.slice(0, 4).map((member, index) => <ChatMemberAvatar key={member.id} viewerId={currentUserId} roomId={conversationId}
          path={member.avatar_path} active={!open} style={[styles.portrait, { marginLeft: index ? -7 : 0, borderColor: theme.card }]}
          accessibilityLabel={tr("{0} 모임 프로필", member.nickname)}
          fallback={<View accessibilityLabel={tr("{0} 프로필", (member.nickname))} style={[styles.portrait, { marginLeft: index ? -7 : 0, borderColor: theme.card, backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold" themeColor="accent">{member.nickname[0]}</ThemedText></View>} />)}
      </View>
      <ThemedText type="smallBold" themeColor="textSecondary">{visible ? tr("멤버 {0}명", (visible.length)) : tr("멤버 보기")} ›</ThemedText>
    </Pressable>
    <Modal visible={open} transparent animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}>
        <Pressable analyticsId="components_chat-members.pressable.2" accessibilityRole="button" accessibilityLabel={tr("멤버 목록 닫기")} style={StyleSheet.absoluteFill} onPress={() => { play('selection'); setOpen(false); }} />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
          {managed ? <>
            <View style={styles.header}><ThemedText type="subtitle" numberOfLines={2} style={styles.name}>{managed.nickname}</ThemedText><Pressable analyticsId="components_chat-members.pressable.3" accessibilityRole="button" accessibilityLabel={tr("멤버 목록")} onPress={() => { play('selection'); setManaging(null); setActionError(null); }} style={styles.button}><ThemedText type="smallBold">{tr("뒤로")}</ThemedText></Pressable></View>
            {shared !== undefined && <Pressable analyticsId="meetup.member.history" accessibilityRole="switch" accessibilityLabel={tr("이전 대화 보여주기")} accessibilityState={{ checked: shared, disabled: saving, busy: saving }}
              disabled={saving} onPress={() => void toggleHistory(managed, !shared)} style={styles.action}>
              <View style={[styles.actionIcon, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }} size={IconSize.inline} tintColor={theme.accent} /></View>
              <View style={styles.name}><ThemedText type="default">{tr("이전 대화 보여주기")}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{shared ? tr("참여하기 전의 대화도 볼 수 있어요.") : tr("참여한 뒤의 대화만 볼 수 있어요.")}</ThemedText></View>
              <ThemedText type="smallBold" themeColor={shared ? 'accent' : 'textSecondary'}>{shared ? tr("켜짐") : tr("꺼짐")}</ThemedText>
            </Pressable>}
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            <Pressable analyticsId="meetup.member.remove" accessibilityRole="button" accessibilityLabel={tr("모임에서 내보내기")} accessibilityState={{ disabled: saving, busy: saving }}
              disabled={saving} onPress={() => confirmRemove(managed)} style={styles.action}>
              <View style={[styles.actionIcon, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'person.badge.minus', android: 'person_remove', web: 'person_remove' }} size={IconSize.inline} tintColor={theme.danger} /></View>
              <View style={styles.name}><ThemedText type="default" themeColor="danger">{tr("모임에서 내보내기")}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{tr("대화방에서 나가게 되고 24시간 뒤에 다시 신청할 수 있어요.")}</ThemedText></View>
            </Pressable>
            {!!actionError && <ThemedText type="small" themeColor="danger" accessibilityRole="alert">{actionError}</ThemedText>}
          </> : <>
          <View style={styles.header}><ThemedText type="subtitle">{visible ? tr("멤버 {0}명", (visible.length)) : tr("대화 멤버")}</ThemedText><Pressable analyticsId="components_chat-members.pressable.3" accessibilityRole="button" onPress={() => { play('selection'); setOpen(false); }} style={styles.button}><ThemedText type="smallBold">{tr("닫기")}</ThemedText></Pressable></View>
          {failed ? <View style={styles.error}><ThemedText type="small" accessibilityRole="alert">{tr("멤버를 불러오지 못했어요.")}</ThemedText><Pressable analyticsId="components_chat-members.pressable.4" accessibilityRole="button" style={styles.button} onPress={() => { play('selection'); void refresh(); }}><ThemedText type="smallBold" themeColor="accent">{tr("다시 시도")}</ThemedText></Pressable></View>
            : <FlatList key={scope} analyticsId="components_chat-members.flatlist.1" data={visible ?? []} keyExtractor={(member) => member.id}
              initialNumToRender={10} maxToRenderPerBatch={10} windowSize={5} onViewableItemsChanged={trackVisibleMembers} viewabilityConfig={viewability}
              ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary">{members ? tr("표시할 멤버가 없어요.") : tr("멤버를 불러오는 중이에요.")}</ThemedText>} renderItem={({ item }) => { const manageable = isHost && !item.is_host; const row = <Pressable analyticsId="meetup.member-profile" accessibilityRole="button" accessibilityLabel={tr("{0} 모임 프로필", item.nickname)} disabled={!onOpenProfile} onPress={() => { play('selection'); setOpen(false); onOpenProfile?.(item.id); }} style={[styles.member, manageable && styles.name]}>
              <ChatMemberAvatar viewerId={currentUserId} roomId={conversationId} path={item.avatar_path}
                active={open && viewable.scope === scope && viewable.ids.has(item.id)} style={styles.avatar}
                fallback={<View style={[styles.avatar, { backgroundColor: theme.backgroundElement, borderColor: theme.line, borderWidth: 1 }]}><ThemedText type="smallBold" themeColor="accent">{item.nickname[0]}</ThemedText></View>} />
              <View style={styles.name}><ThemedText type="smallBold">{item.nickname}{item.id === currentUserId ? tr(" (나)") : ''}</ThemedText><MeetupBadgeChips levels={badges[item.id]} /></View>
              {item.is_host && <ThemedText type="small" themeColor="accent">{tr("호스트")}</ThemedText>}
            </Pressable>;
              return manageable ? <View style={styles.memberRow}>{row}<Pressable analyticsId="chat.meetup-manage" accessibilityRole="button" accessibilityLabel={tr("{0} 멤버 관리", item.nickname)}
                onPress={() => { play('selection'); setActionError(null); setManaging({ scope, id: item.id }); }} style={styles.button}>
                <SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={IconSize.toolbar} tintColor={theme.textSecondary} />
              </Pressable></View> : row; }} />}
          </>}
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: Spacing.two },
  roster: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  portraits: { flexDirection: 'row', alignItems: 'center' },
  portrait: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '80%', padding: Spacing.three, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.two },
  member: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  action: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 64, paddingHorizontal: Spacing.two },
  actionIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
  error: { gap: Spacing.two },
});
