import { useLayoutEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { PostDetail } from '@/components/post-detail';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import type { MerchantPost } from '@/lib/admin-merchants';
import { loadPublicPost } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { getMyMerchantAccess, loadMerchantWorkspace } from '@/lib/merchant-workspace';
import { editMerchantPost, removeMerchantPost } from '@/lib/merchant-posts';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export function MerchantWebPosts({ merchantId, posts, onChanged }: { merchantId: string; posts: MerchantPost[]; onChanged?: () => void }) {
  const { isAuthed, me } = useAuth(), theme = useTheme(), { play } = useInteractionFeedback();
  const owner = isAuthed ? `${me.id}:${merchantId}` : '';
  const currentOwner = useRef(owner);
  useLayoutEffect(() => { currentOwner.current = owner; return () => { currentOwner.current = ''; }; }, [owner]);
  const [selected, setSelected] = useState<{ owner: string; post: Post; verifiedOwner: boolean } | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({}), [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const opening = useRef(false), changed = useRef(false);
  const post = selected?.owner === owner && owner ? selected.post : null;
  async function open(postId: string) {
    play('selection');
    if (!isAuthed || opening.current) return;
    const requestOwner = owner;
    opening.current = true; setBusy(true); setError('');
    try {
      const session = await supabase.auth.getSession();
      if (session.data.session?.user.id !== me.id || !await getMyMerchantAccess(supabase)) throw new Error('MERCHANT_ACCESS_REQUIRED');
      const workspace = await loadMerchantWorkspace(supabase, merchantId);
      if (!workspace.posts.some(row => row.post_id === postId)) throw new Error('MERCHANT_POST_NOT_LINKED');
      const saved = await loadPublicPost(supabase, postId);
      if (!saved) throw new Error('MERCHANT_POST_UNAVAILABLE');
      if (currentOwner.current === requestOwner) setSelected({ owner: requestOwner, post: saved,
        verifiedOwner: workspace.can_edit_content ?? (workspace.merchant.owner_id === me.id && !!workspace.merchant.owner_verified_at) });
    } catch (e) {
      if (currentOwner.current === requestOwner) {
        play('warning'); setError(e instanceof Error && e.message === 'MERCHANT_POST_UNAVAILABLE'
          ? '삭제되었거나 공개되지 않은 글이에요.' : '글을 열지 못했어요. 현재 계정의 업체 권한과 연결 상태를 확인해 주세요.');
      }
    } finally { opening.current = false; if (currentOwner.current === requestOwner) setBusy(false); }
  }
  const close = () => {
    play('selection');
    setSelected(null);
    if (changed.current) { changed.current = false; onChanged?.(); }
  };
  const saved = (next: Post) => {
    if (selected?.owner !== currentOwner.current) return;
    changed.current = true; setSelected({ owner, post: next, verifiedOwner: selected.verifiedOwner }); setTitles(value => ({ ...value, [next.id]: next.title }));
  };
  if (!isAuthed) return null;
  return <View style={styles.list}>
    <ThemedText type="subtitle" accessibilityRole="header">업체의 글과 사진</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">연결된 글을 열어서 수정·삭제할 수 있어요. 사진을 추가하거나 순서를 바꾸면 첫 사진이 대표 사진이 돼요. 업체에서 관리하려면 소유 확인을 먼저 완료해 주세요.</ThemedText>
    {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    {busy && <GlingLoader accessibilityLabel="저장된 업체 글과 사진을 여는 중" />}
    {posts.filter(row => !removed.includes(row.post_id)).map(row => <Pressable key={row.post_id} analyticsId="merchant-web.post.open" accessibilityRole="button"
      accessibilityLabel={`${titles[row.post_id] ?? row.title} · 글과 사진 열기`} accessibilityState={{ disabled: busy }} disabled={busy}
      onPress={() => open(row.post_id)} style={({ pressed }) => [styles.row, { borderColor: theme.line, backgroundColor: pressed ? theme.backgroundSelected : theme.card, opacity: busy ? 0.6 : 1 }]}>
      <View style={styles.rowText}><ThemedText type="smallBold" numberOfLines={2}>{titles[row.post_id] ?? row.title}</ThemedText><ThemedText type="small" themeColor="textSecondary">누적 표시 조회 {row.displayed_views}회</ThemedText></View>
      <ThemedText type="smallBold" themeColor="accent">열기</ThemedText>
    </Pressable>)}
    {posts.length === 0 && <ThemedText themeColor="textSecondary">아직 연결된 글이 없어요. 초안을 저장하고 글링에 게시하면 여기에 보여요.</ThemedText>}
    <Modal visible={!!post} animationType="fade" onRequestClose={close}>
      <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]}>
        {post && <View style={styles.detail}>
          {post.author.id !== me.id && !selected?.verifiedOwner && <ThemedText type="small" themeColor="textSecondary" style={styles.note}>업체 소유 확인이 끝나면 이 소개글과 사진도 관리할 수 있어요.</ThemedText>}
          <PostDetail post={post} onClose={close} onPostChanged={saved} onPostRemoved={id => {
            if (selected?.owner !== currentOwner.current) return;
            changed.current = true; setRemoved(value => [...value, id]);
          }} management={selected?.verifiedOwner ? {
            edit: (postId, patch, replacement) => editMerchantPost(supabase, merchantId, postId, patch, replacement),
            remove: postId => removeMerchantPost(supabase, merchantId, postId),
          } : undefined} />
        </View>}
      </SafeAreaView>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({ list: { gap: 12 }, row: { minHeight: 72, borderWidth: 1, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }, rowText: { flex: 1, minWidth: 0, gap: 4 }, modal: { flex: 1 }, detail: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }, note: { paddingHorizontal: 16, paddingVertical: 12 } });
