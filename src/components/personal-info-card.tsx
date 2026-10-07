import { Pressable } from '@/components/analytics-controls';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { PersonalInfoFields, type PersonalInfoDraft } from '@/components/personal-info-fields';
import { ThemedText } from '@/components/themed-text';
import { Depth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { PERSONAL_INFO_VERSION, validatePersonalInfo } from '@/lib/personal-info';
import { supabase } from '@/lib/supabase';

type PersonalInfo = { full_name: string | null; date_of_birth: string | null; gender: string | null; age: number | null; consented_at: string | null; updated_at: string | null };

export function PersonalInfoCard({ userId, nickname }: { userId: string; nickname: string }) {
  const [retry, setRetry] = useState(0);
  return <PersonalInfoEditor key={`${userId}:${retry}`} userId={userId} nickname={nickname} onRetry={() => setRetry((value) => value + 1)} />;
}

function PersonalInfoEditor({ userId, nickname, onRetry }: { userId: string; nickname: string; onRetry: () => void }) {
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const active = useRef(true);
  const saving = useRef(false);
  const [data, setData] = useState<PersonalInfo | null>(null);
  const [draft, setDraft] = useState<PersonalInfoDraft>({ fullName: '', dateOfBirth: '', accepted: false, gender: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let current = true;
    active.current = true;
    void supabase.rpc('get_my_personal_info').then(({ data: result, error: failure }) => {
      if (!current) return;
      if (failure || !result) { setError('계정 정보를 불러오지 못했습니다. 다시 불러온 뒤 수정해주세요.'); return; }
      const info = result as PersonalInfo;
      setData(info);
      setDraft({ fullName: info.full_name ?? '', dateOfBirth: info.date_of_birth ?? '', accepted: false, gender: info.gender ?? '' });
    }, () => { if (current) setError('계정 정보를 불러오지 못했습니다. 다시 불러온 뒤 수정해주세요.'); });
    return () => { current = false; active.current = false; };
  }, [userId]);

  const save = async (remove = false) => {
    play('selection');
    if (!data || saving.current) return;
    const fullName = remove ? '' : draft.fullName.trim();
    const dateOfBirth = remove ? '' : draft.dateOfBirth.trim();
    const gender = remove ? '' : draft.gender;
    const validation = validatePersonalInfo(fullName, dateOfBirth, gender);
    if (validation) { setError(validation); return; }
    if (!remove && (!fullName || !dateOfBirth)) { setError('이름과 생년월일을 입력해주세요. 저장된 정보는 아래 삭제 버튼으로 지울 수 있어요.'); return; }
    if (!remove && !draft.accepted) { setError('이름·생년월일·성별 수집·이용에 별도로 동의해주세요.'); return; }
    saving.current = true; setBusy(true); setError(null); setNotice(null);
    let savedSuccessfully = false;
    try {
      const saved = await supabase.rpc('save_my_personal_info', { p_full_name: fullName || null, p_date_of_birth: dateOfBirth || null, p_version: PERSONAL_INFO_VERSION, p_user_id: userId, p_gender: gender || null });
      if (saved.error) throw saved.error;
      savedSuccessfully = true;
      if (!active.current) return;
      setConfirmDelete(false);
      // A failed refresh must not turn retained server data into an empty editable form.
      setData(null);
      setDraft({ fullName: '', dateOfBirth: '', accepted: false, gender: '' });
      const result = await supabase.rpc('get_my_personal_info');
      if (!active.current) return;
      if (result.error || !result.data) { setError('저장은 완료했지만 최신 정보를 불러오지 못했습니다. 다시 불러와 확인해주세요.'); return; }
      const info = result.data as PersonalInfo;
      setData(info);
      setDraft({ fullName: info.full_name ?? '', dateOfBirth: info.date_of_birth ?? '', accepted: false, gender: info.gender ?? '' });
      setEditing(false);
      setNotice(remove ? '이름과 생년월일, 성별을 삭제했어요.' : '비공개 계정 정보를 저장했어요.');
      play(remove ? 'warning' : 'success');
    } catch { if (active.current) { play('warning'); setError(savedSuccessfully ? '저장은 완료했지만 최신 정보를 불러오지 못했습니다. 다시 불러와 확인해주세요.' : '계정 정보를 저장하지 못했습니다. 입력 내용과 연결 상태를 확인해주세요.'); } }
    finally { saving.current = false; if (active.current) setBusy(false); }
  };

  return <View style={[styles.card, { borderColor: theme.line, backgroundColor: theme.card }]}>
    <View style={styles.summaryRow}>
      <ThemedText type="small" themeColor="textSecondary">닉네임</ThemedText>
      <ThemedText type="smallBold" style={styles.summaryValue}>{nickname}</ThemedText>
    </View>
    <View style={[styles.divider, { backgroundColor: theme.line }]} />
    {!data ? <>
      <ThemedText accessibilityRole={error ? 'alert' : 'progressbar'} type="small" themeColor="textSecondary">{error ?? '계정 정보를 불러오는 중이에요.'}</ThemedText>
      {error && <Pressable analyticsId="components_personal-info-card.pressable.1" onPress={() => { play('selection'); onRetry(); }} accessibilityRole="button" style={styles.button}><ThemedText type="smallBold">다시 불러오기</ThemedText></Pressable>}
    </> : <>
      <View style={styles.summaryRow}>
        <View style={styles.summaryLabel}><ThemedText type="small">생년월일</ThemedText><ThemedText type="small" themeColor="textSecondary">비공개 · 본인 입력 · 생년월일 미인증</ThemedText></View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.summaryValue}>{data.date_of_birth ?? '미등록'}</ThemedText>
      </View>
      {notice && <ThemedText accessibilityLiveRegion="polite" type="small">{notice}</ThemedText>}
      <View style={[styles.divider, { backgroundColor: theme.line }]} />
      <Pressable analyticsId="components_personal-info-card.pressable.6" accessibilityRole="button" accessibilityState={{ expanded: editing, disabled: busy }} disabled={busy}
        onPress={() => { play('selection'); setEditing(value => !value); }} style={styles.editRow}>
        <ThemedText type="smallBold" style={{ color: theme.accent }}>{editing ? '계정 정보 닫기' : data.full_name ? '비공개 계정 정보 수정' : '비공개 계정 정보 입력'}</ThemedText>
        <ThemedText themeColor="textSecondary">{editing ? '⌃' : '›'}</ThemedText>
      </Pressable>
      {editing && <View style={styles.editor}>
        <PersonalInfoFields value={draft} disabled={busy} onChange={(value) => { setDraft(value); setError(null); setNotice(null); setConfirmDelete(false); }} />
        {error && <ThemedText accessibilityRole="alert" type="small" style={{ color: theme.accent }}>{error}</ThemedText>}
        <Pressable analyticsId="components_personal-info-card.pressable.2" disabled={busy} onPress={() => void save()} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} style={({ pressed }) => [styles.button, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, borderBottomWidth: 3, opacity: busy ? 0.55 : 1, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
          <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{busy ? '저장 중…' : '계정 정보 저장'}</ThemedText>
        </Pressable>
        {data.full_name && !confirmDelete && <Pressable analyticsId="components_personal-info-card.pressable.3" disabled={busy} onPress={() => { play('selection'); setConfirmDelete(true); }} accessibilityRole="button" style={styles.button}><ThemedText type="smallBold" style={{ color: theme.accent }}>저장된 이름·생년월일 삭제</ThemedText></Pressable>}
        {confirmDelete && <View style={styles.confirm}>
          <ThemedText type="small">저장된 이름과 생년월일을 삭제할까요? 공개 프로필은 유지돼요.</ThemedText>
          <View style={styles.actions}>
            <Pressable analyticsId="components_personal-info-card.pressable.4" disabled={busy} onPress={() => { play('selection'); setConfirmDelete(false); }} accessibilityRole="button" style={styles.button}><ThemedText type="smallBold">취소</ThemedText></Pressable>
            <Pressable analyticsId="components_personal-info-card.pressable.5" disabled={busy} onPress={() => void save(true)} accessibilityRole="button" style={styles.button}><ThemedText type="smallBold" style={{ color: theme.accent }}>삭제 확인</ThemedText></Pressable>
          </View>
        </View>}
      </View>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, gap: Spacing.three, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  summaryRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  summaryLabel: { flex: 1, gap: Spacing.one },
  summaryValue: { flexShrink: 1, textAlign: 'right' },
  divider: { height: StyleSheet.hairlineWidth },
  editRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editor: { gap: Spacing.three },
  button: { minHeight: 44, paddingHorizontal: Spacing.three, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
  confirm: { gap: Spacing.two }, actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: Spacing.two },
});
