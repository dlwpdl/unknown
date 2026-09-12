import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { PersonalInfoFields, type PersonalInfoDraft } from '@/components/personal-info-fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PERSONAL_INFO_VERSION, validatePersonalInfo } from '@/lib/personal-info';
import { supabase } from '@/lib/supabase';

type PersonalInfo = { full_name: string | null; date_of_birth: string | null; age: number | null; consented_at: string | null; updated_at: string | null };

export function PersonalInfoCard({ userId }: { userId: string }) {
  const [retry, setRetry] = useState(0);
  return <PersonalInfoEditor key={`${userId}:${retry}`} userId={userId} onRetry={() => setRetry((value) => value + 1)} />;
}

function PersonalInfoEditor({ userId, onRetry }: { userId: string; onRetry: () => void }) {
  const theme = useTheme();
  const active = useRef(true);
  const saving = useRef(false);
  const [data, setData] = useState<PersonalInfo | null>(null);
  const [draft, setDraft] = useState<PersonalInfoDraft>({ fullName: '', dateOfBirth: '', accepted: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let current = true;
    active.current = true;
    void supabase.rpc('get_my_personal_info').then(({ data: result, error: failure }) => {
      if (!current) return;
      if (failure || !result) { setError('계정 정보를 불러오지 못했습니다. 다시 불러온 뒤 수정해주세요.'); return; }
      const info = result as PersonalInfo;
      setData(info);
      setDraft({ fullName: info.full_name ?? '', dateOfBirth: info.date_of_birth ?? '', accepted: false });
    }, () => { if (current) setError('계정 정보를 불러오지 못했습니다. 다시 불러온 뒤 수정해주세요.'); });
    return () => { current = false; active.current = false; };
  }, [userId]);

  const save = async (remove = false) => {
    if (!data || saving.current) return;
    const fullName = remove ? '' : draft.fullName.trim();
    const dateOfBirth = remove ? '' : draft.dateOfBirth.trim();
    const validation = validatePersonalInfo(fullName, dateOfBirth);
    if (validation) { setError(validation); return; }
    if (!remove && (!fullName || !dateOfBirth)) { setError('이름과 생년월일을 입력해주세요. 저장된 정보는 아래 삭제 버튼으로 지울 수 있어요.'); return; }
    if (!remove && !draft.accepted) { setError('이름·생년월일 수집·이용에 별도로 동의해주세요.'); return; }
    saving.current = true; setBusy(true); setError(null); setNotice(null);
    let savedSuccessfully = false;
    try {
      const saved = await supabase.rpc('save_my_personal_info', { p_full_name: fullName || null, p_date_of_birth: dateOfBirth || null, p_version: PERSONAL_INFO_VERSION, p_user_id: userId });
      if (saved.error) throw saved.error;
      savedSuccessfully = true;
      if (!active.current) return;
      setConfirmDelete(false);
      // A failed refresh must not turn retained server data into an empty editable form.
      setData(null);
      setDraft({ fullName: '', dateOfBirth: '', accepted: false });
      const result = await supabase.rpc('get_my_personal_info');
      if (!active.current) return;
      if (result.error || !result.data) { setError('저장은 완료했지만 최신 정보를 불러오지 못했습니다. 다시 불러와 확인해주세요.'); return; }
      const info = result.data as PersonalInfo;
      setData(info);
      setDraft({ fullName: info.full_name ?? '', dateOfBirth: info.date_of_birth ?? '', accepted: false });
      setNotice(remove ? '이름과 생년월일을 삭제했어요.' : '비공개 계정 정보를 저장했어요.');
    } catch { if (active.current) setError(savedSuccessfully ? '저장은 완료했지만 최신 정보를 불러오지 못했습니다. 다시 불러와 확인해주세요.' : '계정 정보를 저장하지 못했습니다. 입력 내용과 연결 상태를 확인해주세요.'); }
    finally { saving.current = false; if (active.current) setBusy(false); }
  };

  return <View style={[styles.card, { borderColor: theme.line, backgroundColor: theme.card }]}>
    {!data ? <>
      <ThemedText type="smallBold">비공개 계정 정보</ThemedText>
      <ThemedText accessibilityRole={error ? 'alert' : 'progressbar'} type="small" themeColor="textSecondary">{error ?? '계정 정보를 불러오는 중이에요.'}</ThemedText>
      {error && <Pressable onPress={onRetry} accessibilityRole="button" style={styles.button}><ThemedText type="smallBold">다시 불러오기</ThemedText></Pressable>}
    </> : <>
      <PersonalInfoFields value={draft} disabled={busy} onChange={(value) => { setDraft(value); setError(null); setNotice(null); setConfirmDelete(false); }} />
      {data.date_of_birth && <ThemedText type="small" themeColor="textSecondary">저장된 생년월일 {data.date_of_birth}{data.age != null ? ` · 만 ${data.age}세` : ''}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert" type="small" style={{ color: theme.accent }}>{error}</ThemedText>}
      {notice && <ThemedText accessibilityLiveRegion="polite" type="small">{notice}</ThemedText>}
      <Pressable disabled={busy} onPress={() => void save()} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} style={({ pressed }) => [styles.button, { backgroundColor: theme.accent, opacity: busy ? 0.55 : pressed ? 0.7 : 1 }]}>
        <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{busy ? '저장 중…' : '계정 정보 저장'}</ThemedText>
      </Pressable>
      {data.full_name && !confirmDelete && <Pressable disabled={busy} onPress={() => setConfirmDelete(true)} accessibilityRole="button" style={styles.button}><ThemedText type="smallBold" style={{ color: theme.accent }}>저장된 이름·생년월일 삭제</ThemedText></Pressable>}
      {confirmDelete && <View style={styles.confirm}>
        <ThemedText type="small">저장된 이름과 생년월일을 삭제할까요? 공개 프로필은 유지돼요.</ThemedText>
        <View style={styles.actions}>
          <Pressable disabled={busy} onPress={() => setConfirmDelete(false)} accessibilityRole="button" style={styles.button}><ThemedText type="smallBold">취소</ThemedText></Pressable>
          <Pressable disabled={busy} onPress={() => void save(true)} accessibilityRole="button" style={styles.button}><ThemedText type="smallBold" style={{ color: theme.accent }}>삭제 확인</ThemedText></Pressable>
        </View>
      </View>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, gap: Spacing.three, borderWidth: 1, borderRadius: 12 },
  button: { minHeight: 44, paddingHorizontal: Spacing.three, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
  confirm: { gap: Spacing.two }, actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: Spacing.two },
});
