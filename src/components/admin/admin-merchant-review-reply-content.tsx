import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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
    reading.current = true; setBusy(true); setError(''); setContent(null); play('selection');
    try {
      const next = await loadAdminMerchantReviewReplyContent(supabase, targetId);
      if (!mounted.current) return;
      setContent(next);
      if (!next) { setError('업체 답변을 찾을 수 없습니다.'); play('warning'); }
    } catch {
      if (mounted.current) { setError('업체 답변 원문을 불러오지 못했습니다. 관리자 권한과 연결 상태를 확인해주세요.'); play('warning'); }
    } finally { reading.current = false; if (mounted.current) setBusy(false); }
  }
  const actionStyle = [styles.action, { borderColor: theme.line, backgroundColor: theme.card }];
  return <View style={styles.content}>
    <Pressable accessibilityRole="button" accessibilityLabel="업체 답변 원문 보기" disabled={localPreview || busy}
      accessibilityState={{ disabled: localPreview || busy, busy }} onPress={() => load()} style={[actionStyle, (localPreview || busy) && styles.disabled]}>
      <ThemedText type="smallBold">{busy ? '업체 답변 불러오는 중…' : '업체 답변 원문 보기'}</ThemedText>
    </Pressable>
    {error ? <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText> : null}
    {content && <>
      <ThemedText type="small" selectable>{content.text}</ThemedText>
      <ThemedText type="small" style={{ color: theme.textSecondary }}>업체 답변 · {content.status === 'removed' ? '숨김' : '게시 중'}</ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel="답변 작성자 이력 보기" onPress={() => { play('selection'); onUser(content.authorId); }} style={actionStyle}>
        <ThemedText type="smallBold">답변 작성자 이력 보기</ThemedText>
      </Pressable>
    </>}
  </View>;
}
const styles = StyleSheet.create({
  content: { gap: Spacing.two },
  action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8 },
  disabled: { opacity: 0.5 },
});
