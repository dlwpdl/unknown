import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { loadChatMembers, type ChatMember } from '@/lib/chat-details';
import { supabase } from '@/lib/supabase';

export function ChatMembers({ conversationId, groupPostId, currentUserId }: { conversationId: string; groupPostId: string; currentUserId: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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
    <Pressable accessibilityRole="button" accessibilityLabel="대화 멤버 목록" onPress={() => { setOpen(true); void refresh(); }} style={styles.button}>
      <ThemedText type="smallBold" themeColor="textSecondary">{visible ? `멤버 ${visible.length}명` : '멤버 보기'} ›</ThemedText>
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="멤버 목록 닫기" style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
          <View style={styles.header}><ThemedText type="subtitle">{visible ? `멤버 ${visible.length}명` : '대화 멤버'}</ThemedText><Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.button}><ThemedText type="smallBold">닫기</ThemedText></Pressable></View>
          {failed ? <View style={styles.error}><ThemedText type="small" accessibilityRole="alert">멤버를 불러오지 못했어요.</ThemedText><Pressable accessibilityRole="button" style={styles.button} onPress={() => void refresh()}><ThemedText type="smallBold" themeColor="accent">다시 시도</ThemedText></Pressable></View>
            : <FlatList data={visible ?? []} keyExtractor={(member) => member.id} ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary">{members ? '표시할 멤버가 없어요.' : '멤버를 불러오는 중이에요.'}</ThemedText>} renderItem={({ item }) => <View style={styles.member}>
              {item.avatarUrl ? <Image source={{ uri: item.avatarUrl, cacheKey: `avatar:${currentUserId}:${item.avatar_path}` }} recyclingKey={item.id} style={styles.avatar} contentFit="cover" accessibilityIgnoresInvertColors /> : <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold">{item.nickname[0]}</ThemedText></View>}
              <ThemedText type="smallBold" style={styles.name}>{item.nickname}{item.id === currentUserId ? ' (나)' : ''}</ThemedText>
              {item.is_host && <ThemedText type="small" themeColor="accent">호스트</ThemedText>}
            </View>} />}
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: Spacing.two },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '80%', padding: Spacing.three, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.two },
  member: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1 },
  error: { gap: Spacing.two },
});
