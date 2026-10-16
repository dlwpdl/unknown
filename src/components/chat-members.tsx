import { useLanguage } from '@/hooks/use-language';
import { Pressable, FlatList } from '@/components/analytics-controls';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { loadChatMembers, type ChatMember } from '@/lib/chat-details';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

export function ChatMembers({ conversationId, groupPostId, currentUserId }: { conversationId: string; groupPostId: string; currentUserId: string }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { play } = useInteractionFeedback();
  const hidden = useContentVisibility();
  const [members, setMembers] = useState<ChatMember[] | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++request.current;
    try {
      const rows = await loadChatMembers(supabase, conversationId);
      if (generation === request.current) { setMembers(rows); setFailed(false); }
    } catch {
      if (generation === request.current) { setMembers(null); setFailed(true); }
    }
  }, [conversationId]);
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
  return <>
    <Pressable analyticsId="components_chat-members.pressable.1" accessibilityRole="button" accessibilityLabel={tr("대화 멤버 목록")} onPress={() => { play('selection'); setOpen(true); void refresh(); }} style={[styles.button, styles.roster]}>
      <View style={styles.portraits}>
        {visible?.slice(0, 4).map((member, index) => member.avatarUrl
          ? <Image key={member.id} source={{ uri: member.avatarUrl, cacheKey: `avatar:${currentUserId}:${member.avatar_path}` }} style={[styles.portrait, { marginLeft: index ? -7 : 0, borderColor: theme.card }]} contentFit="cover" accessibilityLabel={tr("{0} 프로필", (member.nickname))} accessibilityIgnoresInvertColors />
          : <View key={member.id} accessibilityLabel={tr("{0} 프로필", (member.nickname))} style={[styles.portrait, { marginLeft: index ? -7 : 0, borderColor: theme.card, backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold">{member.nickname[0]}</ThemedText></View>)}
      </View>
      <ThemedText type="smallBold" themeColor="textSecondary">{visible ? tr("멤버 {0}명", (visible.length)) : tr("멤버 보기")} ›</ThemedText>
    </Pressable>
    <Modal visible={open} transparent animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}>
        <Pressable analyticsId="components_chat-members.pressable.2" accessibilityRole="button" accessibilityLabel={tr("멤버 목록 닫기")} style={StyleSheet.absoluteFill} onPress={() => { play('selection'); setOpen(false); }} />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
          <View style={styles.header}><ThemedText type="subtitle">{visible ? tr("멤버 {0}명", (visible.length)) : tr("대화 멤버")}</ThemedText><Pressable analyticsId="components_chat-members.pressable.3" accessibilityRole="button" onPress={() => { play('selection'); setOpen(false); }} style={styles.button}><ThemedText type="smallBold">{tr("닫기")}</ThemedText></Pressable></View>
          {failed ? <View style={styles.error}><ThemedText type="small" accessibilityRole="alert">{tr("멤버를 불러오지 못했어요.")}</ThemedText><Pressable analyticsId="components_chat-members.pressable.4" accessibilityRole="button" style={styles.button} onPress={() => { play('selection'); void refresh(); }}><ThemedText type="smallBold" themeColor="accent">{tr("다시 시도")}</ThemedText></Pressable></View>
            : <FlatList analyticsId="components_chat-members.flatlist.1" data={visible ?? []} keyExtractor={(member) => member.id} ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary">{members ? tr("표시할 멤버가 없어요.") : tr("멤버를 불러오는 중이에요.")}</ThemedText>} renderItem={({ item }) => <View style={styles.member}>
              {item.avatarUrl ? <Image source={{ uri: item.avatarUrl, cacheKey: `avatar:${currentUserId}:${item.avatar_path}` }} recyclingKey={item.id} style={styles.avatar} contentFit="cover" accessibilityIgnoresInvertColors /> : <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold">{item.nickname[0]}</ThemedText></View>}
              <ThemedText type="smallBold" style={styles.name}>{item.nickname}{item.id === currentUserId ? tr(" (나)") : ''}</ThemedText>
              {item.is_host && <ThemedText type="small" themeColor="accent">{tr("호스트")}</ThemedText>}
            </View>} />}
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
  error: { gap: Spacing.two },
});
