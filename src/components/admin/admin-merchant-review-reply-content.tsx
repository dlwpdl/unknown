import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AdminButton } from '@/components/admin/admin-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { loadAdminMerchantReviewReplyContent, type AdminMerchantReviewReplyContent as Reply } from '@/lib/admin-data';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

type Props = { targetId: string; localPreview?: boolean; onUser: (id: string) => void };
export function AdminMerchantReviewReplyContent(props: Props) {
  const { me } = useAuth();
  return <ReplyContent key={`${me.id}:${props.targetId}`} {...props} />;
}
function ReplyContent({ targetId, localPreview = false, onUser }: Props) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [content, setContent] = useState<Reply | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const mounted = useRef(true), reading = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function load() {
    if (localPreview || reading.current) return;
    reading.current = true; setBusy(true); setError(''); setContent(null);
    try {
      const next = await loadAdminMerchantReviewReplyContent(supabase, targetId);
      if (!mounted.current) return;
      setContent(next);
      if (!next) { setError('비즈니스 답변을 찾을 수 없어요.'); play('warning'); }
    } catch {
      if (mounted.current) { setError('비즈니스 답변 원문을 불러오지 못했어요. 관리자 권한과 연결 상태를 확인해 주세요.'); play('warning'); }
    } finally { reading.current = false; if (mounted.current) setBusy(false); }
  }
  return <View style={styles.content}>
    <AdminButton label={busy ? '비즈니스 답변 불러오는 중…' : '비즈니스 답변 원문 보기'} accessibilityLabel="비즈니스 답변 원문 보기" disabled={localPreview || busy} onPress={() => load()} />
    {error ? <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText> : null}
    {content && <>
      <ThemedText type="small" selectable>{content.text}</ThemedText>
      <ThemedText type="small" style={{ color: theme.textSecondary }}>비즈니스 답변 · {content.status === 'removed' ? '숨김' : '게시 중'}</ThemedText>
      <AdminButton kind="text" label="답변 작성자 이력 보기 →" accessibilityLabel="답변 작성자 이력 보기" onPress={() => onUser(content.authorId)} />
    </>}
  </View>;
}
const styles = StyleSheet.create({
  content: { gap: Spacing.two, alignItems: 'flex-start' },
});
