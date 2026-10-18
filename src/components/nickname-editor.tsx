import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { nicknameError, normalizeNickname } from '@/lib/nickname';

export function NicknameEditor({ nickname, onSave, admin = false }: {
  nickname: string; onSave: (value: string, expectedNickname: string) => Promise<void>; admin?: boolean;
}) {
  const appTheme = useTheme(), theme = admin ? Colors.admin : appTheme;
  const { tr } = useLanguage(), { play } = useInteractionFeedback();
  const [draft, setDraft] = useState<{ value: string; expected: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const active = useRef(true), pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function save() {
    if (!draft || pending.current) return;
    let value: string;
    try { value = normalizeNickname(draft.value); } catch (e) { setError(nicknameError(e)); play('warning'); return; }
    pending.current = true; setBusy(true); setError(''); setNotice(''); play('selection');
    try {
      await onSave(value, draft.expected);
      if (active.current) { setDraft(null); setNotice('닉네임을 변경했어요.'); play('success'); }
    } catch (e) { if (active.current) { setError(nicknameError(e)); play('warning'); } }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  return <View style={styles.editor}>
    <View style={styles.row}><View style={styles.identity}><ThemedText type="small" style={{ color: theme.textSecondary }}>{tr('닉네임')}</ThemedText><ThemedText type="smallBold" style={{ color: theme.text }}>{nickname}</ThemedText></View>
      {!draft && <Pressable analyticsId="profile.nickname.edit" accessibilityRole="button" accessibilityLabel={tr('닉네임 변경')} onPress={() => { play('selection'); setDraft({ value: nickname, expected: nickname }); setError(''); setNotice(''); }} style={[styles.button, { borderColor: theme.line }]}><ThemedText type="smallBold" style={{ color: theme.accent }}>{tr('변경')}</ThemedText></Pressable>}
    </View>
    {draft && <>
      <TextInput accessibilityLabel={tr('새 닉네임')} value={draft.value} editable={!busy} maxLength={40} autoCapitalize="none" autoCorrect={false}
        onFocus={() => play('selection')} onChangeText={value => { setDraft({ ...draft, value }); setError(''); }} onSubmitEditing={() => { void save(); }}
        style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
      <ThemedText type="small" style={{ color: theme.textSecondary }}>{tr('2~20자 · 다른 사람이 사용 중인 이름은 쓸 수 없어요.')}</ThemedText>
      <View style={styles.actions}>
        <Pressable analyticsId="profile.nickname.cancel" accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => { play('selection'); setDraft(null); setError(''); }} style={[styles.button, { borderColor: theme.line }]}><ThemedText type="smallBold" style={{ color: theme.text }}>{tr('취소')}</ThemedText></Pressable>
        <Pressable analyticsId="profile.nickname.save" accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy, busy }} onPress={() => { void save(); }} style={[styles.button, { backgroundColor: theme.accent, borderColor: theme.accent, opacity: busy ? 0.55 : 1 }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr(busy ? '저장 중…' : '닉네임 저장')}</ThemedText></Pressable>
      </View>
    </>}
    {!!error && <ThemedText accessibilityRole="alert" type="small" style={{ color: admin ? Colors.admin.danger : appTheme.accent }}>{tr(error)}</ThemedText>}
    {!!notice && <ThemedText accessibilityLiveRegion="polite" type="small" style={{ color: theme.text }}>{tr(notice)}</ThemedText>}
  </View>;
}
const styles = StyleSheet.create({
  editor: { gap: Spacing.two }, row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three }, identity: { flex: 1, gap: Spacing.one },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: Spacing.three, fontSize: 16 },
  button: { minHeight: 44, paddingHorizontal: Spacing.three, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderRadius: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: Spacing.two },
});
