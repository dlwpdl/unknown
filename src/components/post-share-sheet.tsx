import { useLanguage } from '@/hooks/use-language';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Share, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { StateCard } from '@/components/state-card';
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
  const { tr, locale: appLocale } = useLanguage();
  const theme = useTheme(), { me, isAuthed } = useAuth(), { play } = useInteractionFeedback(), router = useRouter();
  const insets = useSafeAreaInsets();
  const [inbox, setInbox] = useState<ConversationPage | null>(null), [notice, setNotice] = useState<string | { conversationTitle: string }>('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [sent, setSent] = useState<string[]>([]), [uncertain, setUncertain] = useState<string[]>([]);
  const pending = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!visible || !isAuthed) return;
    let live = true;
    void loadConversations(supabase, me.id).then(page => { if (live) setInbox(page); })
      .catch(() => { if (live) setNotice("대화 목록을 불러오지 못했어요. 다시 확인해주세요."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [visible, isAuthed, me.id, retry]);
  const url = buildSharedPostUrl(post.id), image = getPostImageSource(post, me.id);
  const invite = Boolean(post.room), label = invite ? me.id === post.author.id ? '내 모임에 초대하기' : '모임 같이 가요' : post.tag.slug === 'festival' ? '페스티벌 같이 가요' : '게시물 공유';
  const control = [styles.button, { backgroundColor: theme.backgroundElement, borderColor: theme.line }];
  const requesting = busy || Boolean(loading && inbox);
  const dismiss = () => { if (!pending.current) { play('selection'); onClose(); } };
  async function external(copy = false) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice(''); play('selection');
    try {
      if (Platform.OS === 'web') {
        if (!copy && navigator.share) await navigator.share({ title: post.title, text: invite ? '같이 가요!' : undefined, url });
        else { await navigator.clipboard.writeText(url); if (active.current) setNotice("링크를 복사했어요."); }
      } else {
        const result = await Share.share({ title: post.title, message: sharedPostMessage(post), url });
        if (result.action !== Share.sharedAction) return;
      }
      if (active.current) { onShared(); play('message'); }
    } catch (error) {
      if (active.current && !(error instanceof Error && error.name === 'AbortError')) { setNotice("공유하지 못했어요. 다시 눌러주세요."); play('warning'); }
    } finally { pending.current = false; if (active.current) setBusy(false); }
  }
  async function send(conversation: ConversationPreview) {
    if (pending.current || sent.includes(conversation.id) || uncertain.includes(conversation.id)) return;
    pending.current = true; setBusy(true); setNotice(''); play('selection');
    try {
      const id = await sendDirectMessage(supabase, conversation.id, sharedPostMessage(post));
      if (!id) throw new Error('MESSAGE_SAVE_NOT_VERIFIED');
      if (active.current) { setSent(values => [...values, conversation.id]); setNotice({ conversationTitle: conversation.title }); onShared(); play('message'); }
    } catch {
      if (active.current) {
        setUncertain(values => [...values, conversation.id]);
        setNotice("전송 결과를 확인하지 못했어요. 같은 대화로 다시 보내기 전에 대화 내용을 확인해주세요."); play('warning');
      }
    } finally { pending.current = false; if (active.current) setBusy(false); }
  }
  async function more() {
    if (pending.current || !inbox?.cursor) return;
    pending.current = true; setLoading(true); play('selection');
    try {
      const page = await loadConversations(supabase, me.id, 'all', inbox.cursor);
      if (active.current) setInbox(previous => previous && { ...page, conversations: appendUniquePosts(previous.conversations, page.conversations) });
    } catch { if (active.current) { setNotice("다음 대화를 불러오지 못했어요. 다시 눌러주세요."); play('warning'); } }
    finally { pending.current = false; if (active.current) setLoading(false); }
  }
  return <Modal visible={visible && isAuthed} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={dismiss}>
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.page}>
      <View accessibilityViewIsModal onAccessibilityEscape={dismiss} style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.line, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View accessible={false} style={[styles.handle, { backgroundColor: theme.line }]} />
        <View style={styles.header}><ThemedText type="smallBold" style={styles.heading}>{tr(label)}</ThemedText>
          <Pressable analyticsId="post.share.close" accessibilityRole="button" accessibilityLabel={tr("공유 닫기")} disabled={requesting} accessibilityState={{ disabled: requesting }}
            onPress={dismiss} style={[styles.close, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} tintColor={theme.text} accessible={false} /></Pressable>
        </View>
        <ScrollView analyticsId="post.share.sheet" style={styles.scroll} contentContainerStyle={styles.content}>
          <View style={[styles.preview, { borderColor: theme.line }]}>
            {image ? <Image source={image} style={styles.cover} contentFit="cover" accessible={false} /> : <View style={[styles.cover, styles.placeholder, { backgroundColor: theme.backgroundElement }]}>
              <SymbolView name={invite ? { ios: 'person.2', android: 'groups', web: 'groups' } : { ios: 'doc.text', android: 'description', web: 'description' }} size={24} tintColor={theme.textSecondary} accessible={false} />
            </View>}
            <View style={styles.previewText}><ThemedText type="small" themeColor="accent">{tr(invite ? tr("모임 초대") : post.tag.label)}</ThemedText>
              <ThemedText type="smallBold" style={styles.previewTitle} numberOfLines={2}>{post.title}</ThemedText>
              {post.room && <ThemedText type="small" themeColor="textSecondary">{chillingSchedule(post.room, appLocale)}{tr(post.room.closed ? tr(" · 모집 마감") : '')}</ThemedText>}
            </View>
          </View>
          <View style={styles.conversationHeader}><ThemedText type="smallBold" style={styles.sectionTitle}>{tr("글링 대화로 보내기")}</ThemedText>
            {inbox?.cursor && <Pressable analyticsId="post.share.more" accessibilityRole="button" disabled={loading || busy} accessibilityState={{ disabled: loading || busy }} onPress={() => void more()} style={styles.more}><ThemedText type="small" themeColor="textSecondary" style={styles.moreLabel}>{tr("다른 대화 더 보기")}</ThemedText></Pressable>}
          </View>
          <ThemedText type="small" themeColor="textSecondary">{tr("대화를 누르면 바로 보내요.")}</ThemedText>
          {loading && <StateCard kind="pending" title={tr("대화를 불러오는 중…")} body={tr("잠시만 기다려주세요.")} />}
          {!loading && inbox && !inbox.conversations.some(c => c.status === 'active') && <StateCard kind="empty" title={tr("진행 중인 대화가 없어요")} body={tr(Platform.OS === 'web' ? '다른 앱으로 공유하거나 링크를 복사해보세요.' : '아래 버튼으로 다른 앱에 공유해보세요.')} />}
          {!inbox && !loading && <><StateCard kind="error" title={tr("대화를 불러오지 못했어요")} body={tr("공유 링크는 다른 앱으로 보낼 수 있어요.")} />
            <Pressable analyticsId="post.share.retry" accessibilityRole="button" disabled={requesting} accessibilityState={{ disabled: requesting }} onPress={() => { play('selection'); setLoading(true); setRetry(value => value + 1); }} style={control}><ThemedText type="smallBold">{tr("대화 목록 다시 확인")}</ThemedText></Pressable>
          </>}
          {inbox?.conversations.filter(c => c.status === 'active').map(conversation => {
            const done = sent.includes(conversation.id), unconfirmed = uncertain.includes(conversation.id), disabled = requesting || done || unconfirmed;
            return <Pressable key={conversation.id} analyticsId="post.share.conversation" accessibilityRole="button"
              accessibilityLabel={tr("{0} {1}", conversation.title, tr(done ? '전송 완료' : unconfirmed ? '전송 확인 필요' : '대화로 보내기'))} disabled={disabled} accessibilityState={{ disabled }}
              onPress={() => void send(conversation)} style={({ pressed }) => [styles.conversation, { backgroundColor: pressed ? theme.backgroundElement : 'transparent', opacity: requesting ? 0.6 : 1 }]}>
              <View accessible={false} style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>{conversation.kind === 'group'
                ? <SymbolView name={{ ios: 'person.2', android: 'groups', web: 'groups' }} size={20} tintColor={theme.textSecondary} accessible={false} />
                : <ThemedText type="smallBold" themeColor="navy">{Array.from(conversation.title.trim())[0] || '?'}</ThemedText>}</View>
              <View style={styles.conversationText}><ThemedText type="smallBold" style={styles.conversationTitle} numberOfLines={2}>{conversation.title}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr(conversation.kind === 'group' ? tr("모임 대화") : tr("1:1 대화"))}</ThemedText></View>
              <View style={[styles.sendMarker, { backgroundColor: done || unconfirmed ? 'transparent' : theme.backgroundElement }]}><ThemedText type="small" themeColor={done ? 'accent' : 'textSecondary'}>{tr(done ? tr("✓ 보냈어요") : unconfirmed ? tr("확인 필요") : tr("보내기"))}</ThemedText></View>
            </Pressable>;
          })}
          {uncertain.map(id => <Pressable key={id} analyticsId="post.share.verify-chat" accessibilityRole="button" accessibilityLabel={tr("전송 결과를 대화에서 확인")} disabled={requesting} accessibilityState={{ disabled: requesting }}
            onPress={() => { if (pending.current) return; play('selection'); onClose(); router.push({ pathname: '/chat', params: { conversationId: id } }); }} style={control}><ThemedText type="smallBold">{tr("대화를 열어 전송 결과 확인")}</ThemedText></Pressable>)}
        </ScrollView>
        <View style={[styles.footer, { borderColor: theme.line }]}>
          {!!notice && <ThemedText type="small" accessibilityLiveRegion="polite" themeColor="textSecondary">{typeof notice === 'string' ? tr(notice) : tr('{0} 대화로 보냈어요.', notice.conversationTitle)}</ThemedText>}
          <ThemedText type="small" themeColor="textSecondary">{tr(invite ? tr("초대받은 사람도 로그인 후 참여 신청과 모임장 승인이 필요해요. 상세 집결 정보는 승인된 모임 대화에서만 확인해요.") : tr("글링에서 로그인 후 전체 내용을 확인해요."))}</ThemedText>
          <Pressable analyticsId="post.share.external" accessibilityRole="button" accessibilityLabel={tr(invite ? tr("초대 링크 공유") : tr("다른 앱으로 공유"))} disabled={requesting} accessibilityState={{ disabled: requesting }} onPress={() => void external()}
            style={[styles.button, styles.external, { backgroundColor: theme.accent, borderColor: theme.accent }]}><SymbolView name={{ ios: 'square.and.arrow.up', android: 'ios_share', web: 'ios_share' }} size={20} tintColor={theme.accentInk} accessible={false} /><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr(invite ? tr("초대 링크 공유") : tr("다른 앱으로 공유"))}</ThemedText></Pressable>
          {Platform.OS === 'web' && <Pressable analyticsId="post.share.copy" accessibilityRole="button" disabled={requesting} accessibilityState={{ disabled: requesting }} onPress={() => void external(true)} style={control}><ThemedText type="smallBold">{tr("링크 복사")}</ThemedText></Pressable>}
        </View>
      </View>
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.64)' },
  sheet: { width: '100%', maxWidth: 620, maxHeight: '90%', borderTopWidth: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  handle: { width: 36, height: 4, borderRadius: 4, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  header: { paddingHorizontal: 20, minHeight: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  heading: { flex: 1, fontSize: 20, lineHeight: 28 }, close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0, flexShrink: 1 }, content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 8 },
  button: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  preview: { borderRadius: 16, borderWidth: 1, padding: 12, gap: 12, flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  previewText: { flex: 1, gap: 4 }, previewTitle: { fontSize: 15, lineHeight: 21 }, cover: { width: 64, height: 72, borderRadius: 8 }, placeholder: { alignItems: 'center', justifyContent: 'center' },
  conversationHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, sectionTitle: { flex: 1, fontSize: 14 },
  more: { minHeight: 44, minWidth: 44, justifyContent: 'center' }, moreLabel: { fontSize: 12, textDecorationLine: 'underline' },
  conversation: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, paddingVertical: 8 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  conversationText: { flex: 1, gap: 2 }, conversationTitle: { fontSize: 14, lineHeight: 20 }, sendMarker: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  footer: { flexShrink: 0, marginHorizontal: 20, paddingTop: 12, borderTopWidth: 1, gap: 12 }, external: { minHeight: 48, flexDirection: 'row', gap: 8 },
});
