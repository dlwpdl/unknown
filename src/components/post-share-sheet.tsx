import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Share, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadConversations, sendDirectMessage, type ConversationPage, type ConversationPreview } from '@/lib/community-data';
import { appendUniquePosts, getPostImageSource } from '@/lib/feed-data';
import { chillingSchedule } from '@/lib/chilling';
import { buildSharedPostUrl, sharedPostMessage } from '@/lib/sharing';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

type ShareSheetProps = { post: Post; visible: boolean; onClose: () => void; onShared: () => void };
export function PostShareSheet(props: ShareSheetProps) {
  const { me, isAuthed } = useAuth();
  return isAuthed ? <ShareSheetContent key={`${props.post.id}:${me.id}`} {...props} /> : null;
}
function ShareSheetContent({ post, visible, onClose, onShared }: ShareSheetProps) {
  const theme = useTheme(), { me, isAuthed } = useAuth(), { play } = useInteractionFeedback(), router = useRouter();
  const [inbox, setInbox] = useState<ConversationPage | null>(null), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [sent, setSent] = useState<string[]>([]), [uncertain, setUncertain] = useState<string[]>([]);
  const pending = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!visible || !isAuthed) return;
    let live = true;
    void loadConversations(supabase, me.id).then(page => { if (live) setInbox(page); })
      .catch(() => { if (live) setNotice('대화 목록을 불러오지 못했어요. 다시 확인해주세요.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [visible, isAuthed, me.id, retry]);
  const url = buildSharedPostUrl(post.id), image = getPostImageSource(post, me.id);
  const invite = Boolean(post.room), label = invite ? me.id === post.author.id ? '내 모임에 초대하기' : '모임 같이 가요' : post.tag.slug === 'festival' ? '페스티벌 같이 가요' : '게시물 공유';
  const control = [styles.button, { backgroundColor: theme.backgroundElement, borderColor: theme.line }];
  async function external(copy = false) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice(''); play('selection');
    try {
      if (Platform.OS === 'web') {
        if (!copy && navigator.share) await navigator.share({ title: post.title, text: invite ? '같이 가요!' : undefined, url });
        else { await navigator.clipboard.writeText(url); if (active.current) setNotice('링크를 복사했어요.'); }
      } else {
        const result = await Share.share({ title: post.title, message: sharedPostMessage(post), url });
        if (result.action !== Share.sharedAction) return;
      }
      if (active.current) { onShared(); play('message'); }
    } catch (error) {
      if (active.current && !(error instanceof Error && error.name === 'AbortError')) { setNotice('공유하지 못했어요. 다시 눌러주세요.'); play('warning'); }
    } finally { pending.current = false; if (active.current) setBusy(false); }
  }
  async function send(conversation: ConversationPreview) {
    if (pending.current || sent.includes(conversation.id) || uncertain.includes(conversation.id)) return;
    pending.current = true; setBusy(true); setNotice(''); play('selection');
    try {
      const id = await sendDirectMessage(supabase, conversation.id, sharedPostMessage(post));
      if (!id) throw new Error('MESSAGE_SAVE_NOT_VERIFIED');
      if (active.current) { setSent(values => [...values, conversation.id]); setNotice(`${conversation.title} 대화로 보냈어요.`); onShared(); play('message'); }
    } catch {
      if (active.current) {
        setUncertain(values => [...values, conversation.id]);
        setNotice('전송 결과를 확인하지 못했어요. 같은 대화로 다시 보내기 전에 대화 내용을 확인해주세요.'); play('warning');
      }
    } finally { pending.current = false; if (active.current) setBusy(false); }
  }
  async function more() {
    if (pending.current || !inbox?.cursor) return;
    pending.current = true; setLoading(true); play('selection');
    try {
      const page = await loadConversations(supabase, me.id, 'all', inbox.cursor);
      if (active.current) setInbox(previous => previous && { ...page, conversations: appendUniquePosts(previous.conversations, page.conversations) });
    } catch { if (active.current) { setNotice('다음 대화를 불러오지 못했어요. 다시 눌러주세요.'); play('warning'); } }
    finally { pending.current = false; if (active.current) setLoading(false); }
  }
  return <Modal visible={visible && isAuthed} animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}>
      <View style={styles.header}><ThemedText type="subtitle">{label}</ThemedText>
        <Pressable analyticsId="post.share.close" accessibilityRole="button" accessibilityLabel="공유 닫기" disabled={busy} accessibilityState={{ disabled: busy }}
          onPress={() => { play('selection'); onClose(); }} style={control}><ThemedText>닫기</ThemedText></Pressable>
      </View>
      <ScrollView analyticsId="post.share.sheet" contentContainerStyle={styles.content}>
        <View style={[styles.preview, { borderColor: theme.line, backgroundColor: theme.card }]}>
          {image && <Image source={image} style={styles.cover} contentFit="cover" accessible={false} />}
          <View style={styles.previewText}><ThemedText type="smallBold" themeColor="accent">{invite ? '모임 초대' : post.tag.label}</ThemedText>
            <ThemedText type="subtitle">{post.title}</ThemedText>
            {post.room && <ThemedText type="small" themeColor="textSecondary">{chillingSchedule(post.room)}{post.room.closed ? ' · 모집 마감' : ''}</ThemedText>}
            <ThemedText type="small" themeColor="textSecondary">글링에서 로그인 후 {invite ? '모임을 확인하고 참여를 신청해요.' : '전체 내용을 확인해요.'}</ThemedText>
          </View>
        </View>
        <Pressable analyticsId="post.share.external" accessibilityRole="button" accessibilityLabel={invite ? '초대 링크 공유' : '링크 공유'} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void external()}
          style={[styles.button, { backgroundColor: theme.accent, borderColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{invite ? '초대 링크 공유' : '링크 공유'}</ThemedText></Pressable>
        {Platform.OS === 'web' && <Pressable analyticsId="post.share.copy" accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void external(true)} style={control}><ThemedText type="smallBold">링크 복사</ThemedText></Pressable>}
        {invite && <ThemedText type="small" themeColor="textSecondary">초대받은 사람도 참여 신청과 모임장 승인이 필요해요. 상세 집결 정보는 승인된 모임 대화에서만 확인해요.</ThemedText>}
        <ThemedText type="subtitle">글링 대화로 보내기</ThemedText>
        {loading && <ThemedText type="small">대화를 불러오는 중…</ThemedText>}
        {inbox && !inbox.conversations.some(c => c.status === 'active') && <ThemedText type="small" themeColor="textSecondary">진행 중인 대화가 없어요. 외부 공유나 링크 복사를 이용해주세요.</ThemedText>}
        {inbox?.conversations.filter(c => c.status === 'active').map(conversation => <Pressable key={conversation.id} analyticsId="post.share.conversation" accessibilityRole="button"
          disabled={busy || sent.includes(conversation.id) || uncertain.includes(conversation.id)} accessibilityState={{ disabled: busy || sent.includes(conversation.id) || uncertain.includes(conversation.id) }}
          onPress={() => void send(conversation)} style={control}><ThemedText type="smallBold">{conversation.title} {sent.includes(conversation.id) ? '· 전송 완료' : uncertain.includes(conversation.id) ? '· 대화에서 확인 필요' : '· 보내기'}</ThemedText></Pressable>)}
        {uncertain.map(id => <Pressable key={id} analyticsId="post.share.verify-chat" accessibilityRole="button" accessibilityLabel="전송 결과를 대화에서 확인"
          onPress={() => { play('selection'); onClose(); router.push({ pathname: '/chat', params: { conversationId: id } }); }} style={control}><ThemedText type="smallBold">대화를 열어 전송 결과 확인</ThemedText></Pressable>)}
        {inbox?.cursor && <Pressable analyticsId="post.share.more" accessibilityRole="button" disabled={loading || busy} accessibilityState={{ disabled: loading || busy }} onPress={() => void more()} style={control}><ThemedText>다른 대화 더 보기</ThemedText></Pressable>}
        {!inbox && !loading && <Pressable analyticsId="post.share.retry" accessibilityRole="button" onPress={() => { play('selection'); setLoading(true); setRetry(value => value + 1); }} style={control}><ThemedText>대화 목록 다시 확인</ThemedText></Pressable>}
        {!!notice && <ThemedText type="small" accessibilityLiveRegion="polite">{notice}</ThemedText>}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({ page: { flex: 1 }, header: { padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  content: { padding: 16, gap: 16, maxWidth: 620, width: '100%', alignSelf: 'center' }, button: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center' },
  preview: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' }, previewText: { padding: 16, gap: 8 }, cover: { width: '100%', aspectRatio: 16 / 9 } });
