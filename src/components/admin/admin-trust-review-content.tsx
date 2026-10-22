import { useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadAdminTrustContent, reviewAdminTrustTarget } from '@/lib/admin-trust-reviews';
import type { TrustContent, TrustTarget } from '@/lib/meetup-reviews';
import { supabase } from '@/lib/supabase';

export const isTrustTarget = (type: string): type is TrustTarget => ['meetup_review', 'manner_review', 'meetup_attendance'].includes(type);
export function AdminTrustReviewContent(props: { targetType: TrustTarget; targetId: string; localPreview?: boolean; onUser: (id: string) => void }) {
  const { me } = useAuth();
  return <Content key={`${me.id}:${props.targetType}:${props.targetId}`} {...props} />;
}
function Content({ targetType, targetId, localPreview = false, onUser }: { targetType: TrustTarget; targetId: string; localPreview?: boolean; onUser: (id: string) => void }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [content, setContent] = useState<TrustContent | null>(null), [note, setNote] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), pending = useRef(false);
  const attendance = targetType === 'meetup_attendance';
  async function load() {
    if (localPreview || pending.current) return;
    pending.current = true; setBusy(true); setContent(null); setNotice(''); play('selection');
    try { setContent(await loadAdminTrustContent(supabase, targetType, targetId)); }
    catch { setNotice('원문을 읽지 못했습니다. 현재 관리자 역할·2차 인증·세션을 확인해주세요.'); play('warning'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function review(decision: 'published' | 'removed') {
    if (!content || pending.current || localPreview || note.trim().length < 5) return;
    pending.current = true; setBusy(true); setNotice(''); play('selection');
    try {
      await reviewAdminTrustTarget(supabase, targetType, targetId, decision, note, content.updatedAt);
      const next = await loadAdminTrustContent(supabase, targetType, targetId);
      const expected = attendance ? decision === 'published' ? 'verified' : 'rejected' : decision;
      if (next.status !== expected) throw new Error('DECISION_NOT_VERIFIED');
      setContent(next); setNote(''); setNotice('현재 저장된 검토 결과를 다시 확인했습니다.'); play('success');
    } catch { setNotice('결과를 확인하지 못했습니다. 메모는 유지했습니다. 최신 원문을 다시 읽어주세요.'); play('warning'); }
    finally { pending.current = false; setBusy(false); }
  }
  const button = { minHeight: 44, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, borderRadius: 8, padding: 12, justifyContent: 'center' as const };
  const disabled = busy || localPreview || !content || note.trim().length < 5 || (attendance && content.status !== 'pending');
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" disabled={busy || localPreview} accessibilityState={{ disabled: busy || localPreview }} onPress={() => void load()} style={button}><ThemedText type="smallBold">{busy ? '처리 중…' : attendance ? '비공개 참석 이의제기 읽기' : '후기·비공개 행동 평가 읽기'}</ThemedText></Pressable>
    {!!notice && <ThemedText type="small" accessibilityLiveRegion="polite">{notice}</ThemedText>}
    {content && <>
      <ThemedText type="small" selectable>{content.text}</ThemedText>
      <ThemedText type="small">현재 상태 · {content.status}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{attendance ? '진술만으로 인증하지 마세요. 회차·참가 이력과 독립 증거를 대조하고 확인한 근거를 기록해주세요.' : 'AI는 판단 근거가 아닙니다. 실제 관계·행동·반복 계정·보복 가능성과 당사자 맥락을 검토해주세요. 합의한 관계 목적 자체는 위반이 아닙니다.'} 원문 조회와 판단은 모두 감사 기록에 남습니다.</ThemedText>
      <TextInput accessibilityLabel="후기·참석 판단 근거" value={note} editable={!busy} onChangeText={setNote} onFocus={() => play('selection')} multiline maxLength={1000} placeholder="검토한 증거와 판단 근거 · 5자 이상" placeholderTextColor={theme.textSecondary} style={{ minHeight: 80, padding: 12, borderWidth: 1, borderRadius: 8, borderColor: theme.line, color: theme.text, textAlignVertical: 'top' }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['published', 'removed'] as const).map(decision => <Pressable key={decision} accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={() => void review(decision)} style={[button, disabled && { opacity: 0.5 }]}><ThemedText type="smallBold">{decision === 'published' ? attendance ? '참석 증빙 확인' : '검토 후 반영' : attendance ? '확인 거절' : '반영 제외'}</ThemedText></Pressable>)}</View>
      <Pressable accessibilityRole="button" onPress={() => { play('selection'); onUser(content.authorId); }} style={button}><ThemedText type="small">작성자 실제 활동·세션 이력 확인</ThemedText></Pressable>
    </>}
  </View>;
}
