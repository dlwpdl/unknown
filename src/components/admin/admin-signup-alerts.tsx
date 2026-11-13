import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { firstPostStatus } from '@/lib/admin-labels';
import { markNotificationsRead } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { buildSharedPostUrl } from '@/lib/sharing';
import { supabase } from '@/lib/supabase';

type SignupAlert = { id: string; kind: string; body: string; target_id: string; created_at: string; replies?: number };
const FIRST_POST = 'admin_first_post';
const LIMIT = 20;

// Comments by anyone but the author on each first post. Every commenter counts here: the band asks "did someone answer".
async function countReplies(postIds: string[]) {
  const [posts, comments] = await Promise.all([
    supabase.from('posts').select('id,author_id').in('id', postIds),
    supabase.from('comments').select('post_id,author_id').in('post_id', postIds).is('deleted_at', null),
  ]);
  if (posts.error || comments.error) throw posts.error ?? comments.error;
  const authors = new Map((posts.data ?? []).map(post => [post.id as string, post.author_id as string]));
  const replies = new Map<string, number>();
  for (const comment of comments.data ?? []) {
    if (comment.author_id !== authors.get(comment.post_id)) replies.set(comment.post_id, (replies.get(comment.post_id) ?? 0) + 1);
  }
  return replies;
}

export function AdminSignupAlerts({ userId, onUser }: { userId: string; onUser: (id: string) => void }) {
  const [alerts, setAlerts] = useState<SignupAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useRef(false);
  const revision = useRef(0);
  const confirming = useRef(false);
  const { play } = useInteractionFeedback();

  useEffect(() => {
    alive.current = true;
    let active = true;
    const refresh = async () => {
      const version = ++revision.current;
      try {
        // One query per kind, so twenty unread signups can never push a waiting first post out of the list.
        const unread = (kind: string) => supabase.from('user_notifications').select('id,kind,body,target_id,created_at')
          .eq('user_id', userId).eq('kind', kind).is('read_at', null).order('created_at', { ascending: false }).limit(LIMIT);
        const [posts, signups] = await Promise.all([unread(FIRST_POST), unread('admin_signup')]);
        if (posts.error || signups.error) throw posts.error ?? signups.error;
        const firstPosts = (posts.data ?? []) as SignupAlert[];
        // A failed comment lookup only hides the reply line; the alert itself still shows.
        const replies = firstPosts.length ? await countReplies(firstPosts.map(alert => alert.target_id)).catch(() => null) : null;
        if (!active || version !== revision.current) return;
        setAlerts([...firstPosts.map(alert => ({ ...alert, replies: replies ? replies.get(alert.target_id) ?? 0 : undefined })), ...(signups.data ?? []) as SignupAlert[]]);
        setError(null);
      } catch {
        if (active && version === revision.current) setError('알림을 불러오지 못했어요. 연결되면 다시 확인합니다.');
      }
    };
    const channel = supabase.channel(`admin-signups:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => void refresh())
      .subscribe();
    const timer = setInterval(() => void refresh(), 30_000);
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    const focus = () => void refresh();
    if (Platform.OS === 'web') window.addEventListener('focus', focus);
    void refresh();
    return () => {
      active = alive.current = false;
      revision.current += 1;
      clearInterval(timer);
      foreground.remove();
      if (Platform.OS === 'web') window.removeEventListener('focus', focus);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const confirm = async (id: string) => {
    if (confirming.current) return;
    confirming.current = true;
    revision.current += 1;
    setBusy(id);
    play('selection');
    try {
      await markNotificationsRead(supabase, [id]);
      if (!alive.current) return;
      revision.current += 1;
      setAlerts(current => current.filter(alert => alert.id !== id));
      setError(null);
    } catch {
      if (alive.current) setError('알림을 확인 처리하지 못했어요. 다시 시도해 주세요.');
    } finally {
      confirming.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const firstPosts = alerts.filter(alert => alert.kind === FIRST_POST);
  const signups = alerts.filter(alert => alert.kind !== FIRST_POST);
  const post = firstPosts[0], signup = signups[0];
  if (!post && !signup && !error) return null;
  const total = (list: SignupAlert[]) => `${list.length}${list.length === LIMIT ? '+' : ''}`;
  const openPost = (id: string) => {
    play('selection');
    Linking.openURL(buildSharedPostUrl(id)).catch(() => { if (alive.current) setError('글을 열지 못했어요. 다시 눌러 주세요.'); });
  };
  const confirmButton = (alert: SignupAlert, label: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy: busy === alert.id, disabled: !!busy }} disabled={!!busy} onPress={() => confirm(alert.id)} style={({ pressed }) => [styles.button, (pressed || !!busy) && styles.pressed]}>
      <ThemedText type="smallBold">{busy === alert.id ? '확인 중…' : '확인'}</ThemedText>
    </Pressable>
  );
  return (
    <View accessibilityLiveRegion="polite" style={styles.stack}>
      {/* A newcomer's first post waits for a reply, so it gets its own count and the same red as the to-do tiles. */}
      {!!post && <View style={[styles.banner, styles.urgent]}>
        <ThemedText type="smallBold" style={styles.urgentTitle}>새 회원 첫 글 · {total(firstPosts)}건 미확인</ThemedText>
        <ThemedText>{post.body}</ThemedText>
        <ThemedText type="small" style={styles.muted}>{firstPostStatus(post.created_at, post.replies)}</ThemedText>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="첫 글 새 창에서 보기" onPress={() => openPost(post.target_id)} style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}>
            <ThemedText type="smallBold" style={styles.primaryText}>글 보기 ↗</ThemedText>
          </Pressable>
          {confirmButton(post, '첫 글 알림 확인')}
        </View>
      </View>}
      {!!signup && <View style={styles.banner}>
        <ThemedText type="smallBold">가입 알림 · {total(signups)}건 미확인</ThemedText>
        <ThemedText>{signup.body}</ThemedText>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="가입 회원 보기" onPress={() => { play('selection'); onUser(signup.target_id); }} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <ThemedText type="smallBold">회원 보기</ThemedText>
          </Pressable>
          {confirmButton(signup, '가입 알림 확인')}
        </View>
      </View>}
      {!!error && <View style={!post && !signup && styles.banner}>
        <ThemedText accessibilityRole="alert" type="small" style={styles.error}>{error}</ThemedText>
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { marginBottom: Spacing.three, gap: Spacing.two },
  banner: { padding: Spacing.three, gap: Spacing.two, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 12, backgroundColor: Colors.admin.card },
  // Same tint as the overview's urgent to-do tile (admin-section metricUrgent).
  urgent: { borderColor: '#EED3D9', backgroundColor: Colors.admin.dangerBackground },
  urgentTitle: { color: Colors.admin.danger },
  muted: { color: Colors.admin.textSecondary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8 },
  primary: { borderColor: Colors.admin.accent, backgroundColor: Colors.admin.accent },
  primaryText: { color: Colors.admin.accentInk },
  pressed: { opacity: 0.6 },
  error: { color: Colors.admin.danger },
});
